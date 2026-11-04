// Live Azure DevOps querying through the Azure DevOps connector adapter
// (src/connectors/azureDevOps.ts).
// Pipeline: WIQL (backlog items under the target area paths) -> work-item ids ->
// GetWorkItemDetails per id (concurrency-limited) -> defensive field mapping
// into the board's WorkItem shape. Nothing here fabricates data: missing fields
// map to empty/unknown, and failures surface to the caller as thrown errors.

import { appConfig } from "@/config";
import { connectors, type AdoWorkItemBody } from "@/connectors";
import {
  AREAS,
  OTHER_AREA_CODE,
  compareByStackRank,
  hasExactTag,
  type WorkItem,
} from "./work-items-data";

export interface AdoConfig {
  organization: string; // Azure DevOps organization (the connector "account")
  project: string; // Azure DevOps project
  areaRoot: string; // parent area path; the query fetches ALL descendants under it
  wiql: string; // optional custom WIQL override (takes precedence when set)
}

export interface AdoProjectMember {
  name: string;
  email: string;
}

// Connection defaults from the environment (VITE_ADO_ORG, VITE_ADO_PROJECT,
// VITE_ADO_AREA_PATH). They are empty until configured; the app then shows a
// first-run setup screen. When no area path is set the project root is used.
export const DEFAULT_ADO_CONFIG: AdoConfig = {
  organization: appConfig.ado.organization,
  project: appConfig.ado.project,
  areaRoot: appConfig.ado.areaPath || appConfig.ado.project,
  wiql: "",
};

/** The area root to query: the configured path, else the project root. */
function effectiveAreaRoot(areaRoot: string, project?: string): string {
  return (
    normalizeAreaPath(areaRoot.trim()) ||
    DEFAULT_ADO_CONFIG.areaRoot ||
    (project ?? "").trim()
  );
}

// Azure DevOps caps a WIQL response at 20,000 work-item references. If we ever
// come back with exactly that, the id list itself was truncated upstream —
// surface it rather than pretend the board is complete.
export const WIQL_ID_CAP = 20000;

// The batch hydration endpoint (ListWorkItems) takes a comma-separated id list
// capped at ~200 ids per request, so the full id list is chunked and EVERY
// chunk is hydrated — nothing is dropped.
export const HYDRATE_CHUNK = 200;

// Safety bound on WIQL keyset pages (see fetchAllWiqlIds). Even a 50-per-page
// cap drains the 20,000-ref ceiling in 400 pages, so 500 is a runaway guard,
// not a functional limit — hitting it is treated as a truncated result.
export const MAX_WIQL_PAGES = 500;

/**
 * Azure DevOps identities available to the project. The generated connector
 * returns the same identity records used by its build-requester picker, which
 * include the ADO-resolvable unique name needed for [System.AssignedTo].
 */
export async function fetchProjectMembers(
  cfg: AdoConfig,
): Promise<AdoProjectMember[]> {
  const organization = cfg.organization.trim();
  const project = cfg.project.trim();
  if (!organization || !project) {
    throw new Error(
      "An Azure DevOps organization and project are needed to load team members.",
    );
  }

  const result = await connectors().azureDevOps.listProjectMembers(
    organization,
    project,
  );
  if (!result.success || !result.data) {
    throw toError(
      result.error,
      "Azure DevOps wouldn't return the project team members.",
    );
  }

  const rows = result.data.value;
  if (!Array.isArray(rows)) {
    throw new Error("Azure DevOps returned an unexpected team-member list.");
  }

  const members = new Map<string, AdoProjectMember>();
  for (const row of rows) {
    const name = row.displayName?.trim() ?? "";
    const email = row.uniqueName?.trim() ?? "";
    if (!name || !email.includes("@")) continue;
    const key = email.toLowerCase();
    if (!members.has(key)) members.set(key, { name, email });
  }
  return [...members.values()];
}

export interface FetchLiveResult {
  items: WorkItem[];
  idCount: number; // ids returned by the (paginated) WIQL query in total
  hydrated: number; // work items successfully hydrated from those ids
  capped: boolean; // true when the id set hit the API cap / page-safety bound
  pages: number; // WIQL pages drained to collect every id (>=1)
  durationMs: number; // wall-clock time of the whole refresh (query + hydrate)
  fetchedAt: number; // epoch ms when this refresh completed
  // How the work items were hydrated, and whether StackRank actually arrived.
  // "batch-rest" is the field-selecting REST path that CAN return StackRank;
  // "list-fallback" is the typed ListWorkItems operation, whose fixed field set
  // does NOT include StackRank (see HYDRATE_FIELDS). `ranked` counts items that
  // came back with a real rank — 0 means the board is NOT in backlog order and
  // the UI says so instead of pretending otherwise.
  hydrateMode: "batch-rest" | "list-fallback";
  ranked: number;
  rankNote: string | null; // why the REST path was abandoned, when it was
}

// Completed work is filtered out in the QUERY itself (not client-side) so
// Closed/Removed items are never fetched, hydrated, or counted — the id count
// in the refresh status line therefore already reflects the filtered set.
export const EXCLUDED_STATES: readonly string[] = appConfig.ado.excludedStates;
const EXCLUDE_STATES_CLAUSE = EXCLUDED_STATES.length
  ? `[System.State] NOT IN (${EXCLUDED_STATES.map((s) => `'${escapeWiql(s)}'`).join(",")})`
  : "[System.Id] > 0";

// The COMPLETED view (the "Completed" tab) uses the same recursive
// area scope as the board, but only genuinely COMPLETED work: [System.State] =
// 'Closed'. Removed items are abandoned rather than completed, so they are NOT
// listed here (they stay excluded from the board query too — see
// EXCLUDED_STATES — and are therefore simply not shown in either view).
// It is a SEPARATE query — the main board query still filters Closed/Removed
// out server-side and is not relaxed in any way.
export const COMPLETED_STATES: readonly string[] = appConfig.ado.completedStates;
const COMPLETED_STATES_CLAUSE = `[System.State] IN (${COMPLETED_STATES.map(
  (s) => `'${escapeWiql(s)}'`,
).join(",")})`;

/** How far back the Completed tab looks. */
export const COMPLETED_WINDOW_MONTHS = 6;

/**
 * The date field the completion window is filtered on.
 *
 * [System.ChangedDate] is the only completion-ish date the connector can be
 * relied on for: the generated client's work-item response types declare
 * `System.ChangedDate` but have NO ClosedDate member at all, and some closed
 * items carry no [Microsoft.VSTS.Common.ClosedDate] value in the first
 * place. So the WIQL window is applied to [System.ChangedDate] — "closed AND
 * touched in the last N months" — while the richer
 * [Microsoft.VSTS.Common.ClosedDate] is requested through the REST hydration
 * (which does accept an explicit field list) and used for display/sorting
 * whenever ADO actually returns it. No date is ever invented.
 */
export const COMPLETED_WINDOW_FIELD = "System.ChangedDate";
export const COMPLETED_DATE_FIELD = "Microsoft.VSTS.Common.ClosedDate";

function escapeWiql(v: string): string {
  return v.replace(/'/g, "''");
}

/** Start of the completion window, as the `yyyy-MM-dd` literal WIQL expects. */
export function completedWindowStart(
  monthsBack = COMPLETED_WINDOW_MONTHS,
  from = new Date(),
): Date {
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() - monthsBack);
  return d;
}

function wiqlDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Normalize an ADO area path: forward slashes -> backslashes, no trailing sep.
export function normalizeAreaPath(p: string): string {
  return p.replace(/\//g, "\\").replace(/[\\]+$/, "");
}

export const ADO_BOARD_WORK_ITEM_TYPES: readonly string[] = appConfig.ado.boardWorkItemTypes;
const BOARD_WORK_ITEM_TYPES_CLAUSE = `[System.WorkItemType] IN (${ADO_BOARD_WORK_ITEM_TYPES.map(
  (type) => `'${escapeWiql(type)}'`,
).join(",")})`;

// Fetch all supported portfolio/backlog items under the parent area path
// (recursive). A single
// `UNDER` clause pulls in every descendant area under the configured root, so
// nothing under the tree is missed.
//
// Ordered by [System.Id] ASC (not ChangedDate) so the result can be
// keyset-paginated by id: the WIQL REST endpoint returns work-item references
// with NO continuation token, and the connector can cap a single response
// (the classic "only 50 returned" symptom), so we page by a moving id cursor
// in fetchAllWiqlIds. The board buckets items by engineer/area and does not
// rely on WIQL row order, so the ascending sort has no visible effect.
export function defaultWiql(areaRoot: string): string {
  const root = effectiveAreaRoot(areaRoot);
  return (
    "SELECT [System.Id] FROM WorkItems " +
    `WHERE ${BOARD_WORK_ITEM_TYPES_CLAUSE} ` +
    `AND [System.AreaPath] UNDER '${escapeWiql(root)}' ` +
    `AND ${EXCLUDE_STATES_CLAUSE} ` +
    "ORDER BY [System.Id] ASC"
  );
}

// The default query with a keyset cursor: only ids strictly greater than
// `afterId`, still ordered ascending. Because WIQL applies ORDER BY before any
// server-side/connector top, each capped page is the next contiguous ascending
// block of ids above the cursor — so advancing the cursor to a page's max id
// never skips a work item. `afterId` is numeric, so it is injected directly.
function pagedDefaultWiql(areaRoot: string, afterId: number): string {
  const root = effectiveAreaRoot(areaRoot);
  return (
    "SELECT [System.Id] FROM WorkItems " +
    `WHERE ${BOARD_WORK_ITEM_TYPES_CLAUSE} ` +
    `AND [System.AreaPath] UNDER '${escapeWiql(root)}' ` +
    `AND ${EXCLUDE_STATES_CLAUSE} ` +
    `AND [System.Id] > ${afterId} ` +
    "ORDER BY [System.Id] ASC"
  );
}

/**
 * The COMPLETED query, keyset-paginated exactly like the board query: same
 * recursive `UNDER` area scope and same ascending-id cursor (so it drains
 * through the very same pagination helper), but restricted to Closed work
 * items changed on or after the start of the completion window.
 */
function pagedCompletedWiql(
  areaRoot: string,
  since: Date,
  afterId: number,
): string {
  const root = effectiveAreaRoot(areaRoot);
  return (
    "SELECT [System.Id] FROM WorkItems " +
    `WHERE [System.WorkItemType] = '${escapeWiql(ADO_WORK_ITEM_TYPE)}' ` +
    `AND [System.AreaPath] UNDER '${escapeWiql(root)}' ` +
    `AND ${COMPLETED_STATES_CLAUSE} ` +
    `AND [${COMPLETED_WINDOW_FIELD}] >= '${wiqlDate(since)}' ` +
    `AND [System.Id] > ${afterId} ` +
    "ORDER BY [System.Id] ASC"
  );
}

/**
 * One keyset page for a Trackers view.
 *
 * Unlike the board this intentionally includes terminal states, so stakeholder-facing
 * trackers retain resolved, done, completed, and closed work. Removed items are
 * excluded because they are abandoned rather than delivered. WIQL's tag
 * `CONTAINS` narrows the payload; exact whole-tag matching runs again after
 * hydration so similarly named tags cannot leak into a tracker.
 */
function pagedTrackerWiql(
  areaRoot: string,
  tags: readonly string[],
  afterId: number,
): string {
  const root = effectiveAreaRoot(areaRoot);
  const tagClause = tags
    .map((tag) => `[System.Tags] CONTAINS '${escapeWiql(tag)}'`)
    .join(" OR ");
  return (
    "SELECT [System.Id] FROM WorkItems " +
    `WHERE ${BOARD_WORK_ITEM_TYPES_CLAUSE} ` +
    `AND [System.AreaPath] UNDER '${escapeWiql(root)}' ` +
    "AND [System.State] <> 'Removed' " +
    `AND (${tagClause}) ` +
    `AND [System.Id] > ${afterId} ` +
    "ORDER BY [System.Id] ASC"
  );
}

// Route a work item to a backlog category from its full ADO area path. The query
// spans the whole configured subtree, so an item lives under one of the
// configured areas (VITE_ADO_AREAS), under some other sub-area, or directly on
// the root. Bucket by the immediate segment beneath `areaRoot`:
//   ...\Root\Frontend\X -> "Frontend" (configured column)
//   ...\Root\Research\Y -> "Research" (surfaced as its own column)
//   ...\Root             -> OTHER_AREA_CODE (uncategorized)
// Unknown areas are NEVER forced into a known column or silently dropped.
export function areaCategoryCode(
  path: string | undefined,
  areaRoot: string,
): string {
  if (!path) return OTHER_AREA_CODE;
  const root = effectiveAreaRoot(areaRoot);
  const full = normalizeAreaPath(path);
  const rootLower = root.toLowerCase();
  const fullLower = full.toLowerCase();

  let sub: string;
  if (fullLower === rootLower) {
    sub = ""; // sits directly on the parent root
  } else if (fullLower.startsWith(rootLower + "\\")) {
    sub = full.slice(root.length + 1).split("\\")[0] ?? "";
  } else {
    // Not under the configured root (custom WIQL / moved item): use the leaf so
    // it still surfaces somewhere instead of vanishing.
    sub = full.split("\\").pop() ?? "";
  }
  if (!sub) return OTHER_AREA_CODE;

  const match = AREAS.find((a) => a.code.toLowerCase() === sub.toLowerCase());
  return match ? match.code : sub;
}

// The configured ownership categories, by code.
export const KNOWN_AREA_CODES: string[] = AREAS.map((a) => a.code);

export function isKnownAreaCode(code: string): boolean {
  return KNOWN_AREA_CODES.includes(code);
}

// Full ADO area path for a category, derived from the CONFIGURED area root so a
// reroute always targets the same tree the board is querying.
export function categoryAreaPath(code: string, areaRoot: string): string {
  const root = effectiveAreaRoot(areaRoot);
  return `${root}\\${code}`;
}

// Numeric ADO id from a board id ("#12345" -> 12345).
export function adoNumericId(boardId: string): number | null {
  const n = Number(boardId.replace(/^#/, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Canonical Azure DevOps URL for a work item, built from the CONFIGURED
 * organization/project and the item's REAL ADO id:
 *   https://dev.azure.com/{org}/{project}/_workitems/edit/{id}
 *
 * Returns null when the org/project aren't configured or the board id has no
 * usable numeric ADO id, so the caller can omit the link rather than render a
 * URL that would 404.
 */
export function workItemUrl(cfg: AdoConfig, boardId: string): string | null {
  const org = cfg.organization.trim();
  const project = cfg.project.trim();
  const numericId = adoNumericId(boardId);
  if (!org || !project || numericId === null) return null;
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(
    project,
  )}/_workitems/edit/${numericId}`;
}

/**
 * THE WRITE PATH — what the bound connector can actually change.
 *
 * The generated client exposes exactly ONE work-item update operation:
 *
 *   connectors().azureDevOps.updateWorkItem(account, id, workItem, project, type)
 *
 * whose body declares these first-class fields:
 * `title`, `description`, `priority`, `iteration`, `area`, and the link
 * triplet — plus `userEnteredFields`, documented as "Other work item fields,
 * including custom fields. 'Key' is field name and 'Value' is field value",
 * which is how any remaining System.* field is set through the same call.
 *
 * Mapped onto this board, every edit surface is genuinely writable:
 *   Title       -> `title`                                  (first-class)
 *   Description -> `description`                            (first-class)
 *   Area path   -> `area`                                   (first-class)
 *   State       -> userEnteredFields["System.State"]
 *   Assignee    -> userEnteredFields["System.AssignedTo"]
 *   Tags        -> userEnteredFields["System.Tags"]
 *
 * Tags are NOT a first-class field on the update body (it declares only
 * the fields listed above), so they ride the same `userEnteredFields` escape
 * hatch as State and AssignedTo — verified against the generated client, not
 * assumed. ADO stores [System.Tags] as ONE semicolon-separated string, so a
 * write must send the item's WHOLE tag list, not a delta: callers pass the
 * complete resulting set and it is joined here.
 *
 * Nothing is faked: every value rides the real operation, and a rejection is
 * re-thrown carrying the connector's own message so the caller can revert its
 * optimistic UI rather than show a change Azure DevOps didn't accept.
 */
export const ADO_TITLE_FIELD = "System.Title";
export const ADO_DESCRIPTION_FIELD = "System.Description";
export const ADO_AREA_PATH_FIELD = "System.AreaPath";
export const ADO_STATE_FIELD = "System.State";
export const ADO_ASSIGNED_TO_FIELD = "System.AssignedTo";
export const ADO_TAGS_FIELD = "System.Tags";
export const ADO_STACK_RANK_FIELD = "Microsoft.VSTS.Common.StackRank";
export const ADO_TARGET_DATE_FIELD = "Microsoft.VSTS.Scheduling.TargetDate";

/** Fields Azure DevOps echoes back after a successful update. */
export interface WorkItemEcho {
  areaPath?: string;
  title?: string;
  description?: string;
  state?: string;
  assignedTo?: string;
  /** Only ever populated by the JSON-Patch path (the one that writes ranks). */
  stackRank?: number;
  targetDate?: string;
}

export interface WorkItemWrite {
  title?: string;
  description?: string;
  state?: string;
  /** Full ADO area path (not a category code). */
  areaPath?: string;
  /**
   * Leave undefined to keep the current owner. `{ name: null, email: null }`
   * clears the assignment (ADO treats an empty System.AssignedTo as unassigned).
   */
  assignee?: { name: string | null; email: string | null };
  /**
   * The COMPLETE resulting tag list for the item (not a delta) — ADO stores
   * [System.Tags] as one semicolon-separated string, so any write replaces the
   * whole field. An empty array clears every tag. Leave undefined to keep the
   * item's current tags untouched.
   */
  tags?: string[];
  /**
   * Whether a tag was added or removed to produce `tags`. A non-empty removal
   * must use JSON Patch `replace`; ADO accepts `add` but can leave the old tag
   * string unchanged. Additions keep `add` so the field may be created.
   */
  tagChange?: "add" | "remove";
  /**
   * [Microsoft.VSTS.Common.StackRank] — the backlog ordering number the board
   * sorts every list by. Set when a card is dragged to a new POSITION within a
   * list; leave undefined to keep the item's current rank.
   *
   * Always written through the explicit JSON-Patch passthrough below (see
   * `updateWorkItemFields`): that is the path this field was verified on
   * against a real work item, fractional values included, and the connector's
   * own typed operation doesn't carry StackRank at all.
   */
  stackRank?: number;
  /**
   * Date-only Target Date (`YYYY-MM-DD`). Null clears the ADO field; undefined
   * leaves it unchanged.
   */
  targetDate?: string | null;
}

/**
 * Add or remove a tag, returning the item's COMPLETE new tag list.
 *
 * Matching is an EXACT whole-tag comparison, case-insensitive and whitespace
 * trimmed — the same rule hasExactTag() uses, so "urgent-later" is never
 * mistaken for "urgent". Every OTHER tag is preserved with its original
 * casing and its original position, because this returns the existing array
 * filtered/appended rather than a rebuilt one: toggling a tag must never
 * rewrite or reorder tags the user didn't touch.
 *
 * Returns null when the toggle would be a no-op, so callers can skip a
 * pointless round trip to ADO.
 */
export function toggleTag(
  current: readonly string[],
  tag: string,
): { tags: string[]; added: boolean } | null {
  const target = tag.trim().toLowerCase();
  if (!target) return null;

  const has = current.some((t) => t.trim().toLowerCase() === target);
  if (has) {
    return {
      tags: current.filter((t) => t.trim().toLowerCase() !== target),
      added: false,
    };
  }
  return { tags: [...current, tag], added: true };
}

// Resolve + validate the connector coordinates for a write. Throws (rather than
// silently no-op-ing) so a caller can never treat a skipped write as a success.
function writeTarget(
  cfg: AdoConfig,
  boardId: string,
): { org: string; project: string; id: string } {
  const org = cfg.organization.trim();
  const project = cfg.project.trim();
  if (!org || !project) {
    throw new Error("Azure DevOps organization and project are not configured.");
  }
  const numericId = adoNumericId(boardId);
  if (numericId === null) {
    throw new Error(`Work item ${boardId} has no usable Azure DevOps id.`);
  }
  return { org, project, id: String(numericId) };
}

/**
 * Apply a set of field changes to a work item in Azure DevOps.
 *
 * Returns whatever ADO echoed back for the changed fields — the caller should
 * still refetch, because the echo is a confirmation, not the whole item.
 */
export async function updateWorkItemFields(
  cfg: AdoConfig,
  boardId: string,
  write: WorkItemWrite,
): Promise<WorkItemEcho> {
  const { org, project, id } = writeTarget(cfg, boardId);

  // Every changed field, keyed by its ADO reference name. This mirrors `body`
  // exactly (first-class props included) and is what the JSON-Patch fallback
  // below sends when a value is blank.
  const patchFields: Record<string, unknown> = {};

  const body: AdoWorkItemBody = {};
  if (write.title !== undefined) {
    body.title = write.title;
    patchFields[ADO_TITLE_FIELD] = write.title;
  }
  if (write.description !== undefined) {
    body.description = write.description;
    patchFields[ADO_DESCRIPTION_FIELD] = write.description;
  }
  if (write.areaPath !== undefined) {
    body.area = write.areaPath;
    patchFields[ADO_AREA_PATH_FIELD] = write.areaPath;
  }

  const extra: Record<string, unknown> = {};
  if (write.state !== undefined) extra[ADO_STATE_FIELD] = write.state;
  if (write.assignee !== undefined) {
    // THE IDENTITY RULE — [System.AssignedTo] is only ever written with an
    // identity Azure DevOps itself gave us (see resolveAssigneeIdentity).
    //
    // This used to fall back to `write.assignee.name` when no address was
    // known, which sent a DISPLAY NAME as the identity value. ADO answers that
    // with a 400 ("... is an unknown identity", errorCode 600171), so the
    // fallback could only ever produce a failed write dressed up as an
    // attempt. A name is not an identity, and guessing an address from one
    // (first.last@…) would be fabricating a person, so an unresolvable owner
    // now fails HERE, before the request, naming who couldn't be resolved.
    //
    // "" still means CLEAR: a blank routes through the JSON-Patch path below,
    // which clears the field with a "remove" op (the only op ADO applies).
    const identity = (write.assignee.email ?? "").trim();
    if (!identity && write.assignee.name) {
      throw new Error(
        `Azure DevOps has no known identity for ${write.assignee.name}. ` +
          "Assignments are written with the account address Azure DevOps " +
          "returned for a person, and this board has never seen one for them " +
          "— assign the item in Azure DevOps once and it will be available here.",
      );
    }
    extra[ADO_ASSIGNED_TO_FIELD] = identity;
  }
  if (write.tags !== undefined) {
    // Back to ADO's own storage format: one semicolon-separated string. Blanks
    // are dropped so a cleared list writes "" — which the JSON-Patch path below
    // turns into a "remove" op that genuinely clears the field — rather than a
    // string of stray separators.
    extra[ADO_TAGS_FIELD] = write.tags
      .map((t) => t.trim())
      .filter(Boolean)
      .join("; ");
  }
  if (Object.keys(extra).length > 0) body.userEnteredFields = extra;
  Object.assign(patchFields, extra);

  // STACK RANK — always sent as an explicit JSON-Patch document.
  //
  // The connector's generated client has no notion of
  // [Microsoft.VSTS.Common.StackRank] (the string doesn't appear in it at all,
  // which is the same reason hydration has to go through the REST passthrough),
  // so there is no typed field to set. The passthrough IS verified for this
  // field: an "add" of 16644818.5 to a real work item returned 200, bumped
  // `rev` and echoed the fractional value back. A rank must never be smuggled
  // through the typed operation and silently dropped, so its presence forces
  // the patch path for the WHOLE change set — which keeps a combined
  // "reassign AND reposition" drag atomic in one request.
  const writesRank = write.stackRank !== undefined;
  if (writesRank) patchFields[ADO_STACK_RANK_FIELD] = write.stackRank;
  const writesTargetDate = write.targetDate !== undefined;
  if (writesTargetDate) {
    patchFields[ADO_TARGET_DATE_FIELD] = write.targetDate
      ? `${write.targetDate}T00:00:00.000Z`
      : null;
  }

  /**
   * TAGS ALWAYS TAKE THE EXPLICIT JSON-PATCH PATH — same rule as StackRank
   * above, for the same reason, after tag REMOVAL was reported as silently not
   * working twice.
   *
   * What the code showed. Clearing the LAST tag produces a blank value, which
   * already forced the patch path below, and that path has a no-op guard that
   * re-reads the echoed item and throws if the field is still set — so that
   * case can only succeed or fail loudly. Removing ONE tag while others remain
   * produces a NON-blank value, which took the typed `userEnteredFields`
   * operation instead — and that branch reads back only title, description,
   * area, state and assignedTo. It never looks at [System.Tags] at all, so a
   * connector answering 200 without applying the field was indistinguishable
   * from a success: the optimistic update stuck, the refetch quietly restored
   * the old tags, and the user saw the tag "persist" with no error anywhere.
   * That is exactly the reported symptom, and it is the one branch that had
   * never been exercised against real Azure DevOps.
   *
   * Routing tags through the passthrough puts BOTH cases on the path that was
   * verified live against a real work item, and under the verification added
   * below. It also sidesteps a second wrinkle in the typed call: it passes the
   * configured story work item type, which is simply wrong for the
   * nested Tasks and the Bugs this same menu writes tags to.
   *
   * NOTE this is a code-path fix reasoned from the source, NOT a reproduction:
   * the connector's behaviour for [System.Tags] inside `userEnteredFields`
   * could not be observed from here. If the typed path was in fact applying
   * tags correctly, this change is still safe — it moves the write onto the
   * verified path and adds a check that would now REPORT any failure instead
   * of hiding it.
   */
  const writesTags = write.tags !== undefined;

  if (Object.keys(body).length === 0 && !writesRank && !writesTargetDate) {
    throw new Error("No changes to write to Azure DevOps.");
  }

  // THE EMPTY-VALUE ESCAPE HATCH (see updateWorkItemFieldsViaJsonPatch).
  // The connector turns this body into a JSON-Patch document server-side and
  // DROPS blank values, so any write whose only changes are "clear this field"
  // would arrive as a zero-operation document and be rejected by ADO with
  // "At least one operation is required for Apply". When ANY value in this
  // change set is blank we therefore send the WHOLE change set as an explicit
  // patch document instead, so the write stays atomic (never half typed / half
  // passthrough) and clearing genuinely clears.
  if (writesRank || writesTags || writesTargetDate || hasBlankValue(patchFields)) {
    return updateWorkItemFieldsViaJsonPatch(
      org,
      project,
      id,
      boardId,
      patchFields,
      writesTags ? write.tags : undefined,
      writesTargetDate ? write.targetDate : undefined,
      write.tagChange === "remove",
    );
  }

  const res = await connectors().azureDevOps.updateWorkItem(
    org,
    id,
    body,
    project,
    ADO_WORK_ITEM_TYPE,
  );
  if (!res.success) {
    throw toError(
      res.error,
      `Azure DevOps rejected the update for work item ${boardId}.`,
    );
  }

  const f = res.data?.fields;
  return {
    areaPath: typeof f?.System_AreaPath === "string" ? f.System_AreaPath : undefined,
    title: typeof f?.System_Title === "string" ? f.System_Title : undefined,
    description:
      typeof f?.System_Description === "string" ? f.System_Description : undefined,
    state: typeof f?.System_State === "string" ? f.System_State : undefined,
    assignedTo:
      typeof f?.System_AssignedTo === "string" ? f.System_AssignedTo : undefined,
  };
}

/**
 * True when a value means "clear this field" — null, undefined, or a string
 * that is empty once trimmed. The ONE definition of blank, shared by the
 * decision to take the JSON-Patch path and by the choice of patch op, so the
 * two can never disagree about which fields are being cleared.
 */
function isBlankValue(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** True when any field in the change set is being set to a blank value. */
function hasBlankValue(fields: Record<string, unknown>): boolean {
  return Object.values(fields).some(isBlankValue);
}

/**
 * True when a field Azure DevOps echoed back still holds a real value.
 *
 * Used to catch a silent no-op: a cleared field must come back ABSENT (ADO
 * drops removed fields from the response) or blank. [System.AssignedTo] echoes
 * as an identity object rather than a string, so identities are read through
 * the same displayName() the board uses everywhere else.
 */
function fieldStillSet(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "string") return raw.trim() !== "";
  if (typeof raw === "object") return displayName(raw) !== null;
  return true;
}

/**
 * CLEARING A FIELD — why this exists.
 *
 * Removing an item's LAST tag means writing [System.Tags] = "". Sent through
 * the typed `UpdateWorkItem` operation that value never reached Azure DevOps:
 * the connector builds the JSON-Patch document itself from the request body and
 * OMITS blank values, so a write whose only change was "clear the tags" arrived
 * as a document with ZERO operations and ADO answered:
 *
 *   400 — "At least one operation is required for Apply."
 *
 * That is ADO complaining about an EMPTY patch document, not about the empty
 * value: adding a tag worked purely because the value was non-empty. The same
 * latent bug applied to any other clear-to-empty write (e.g. unassigning an
 * item, which sends [System.AssignedTo] = "").
 *
 * The fix is to stop letting the connector build the document when a blank is
 * involved, and send an explicit JSON-Patch document ourselves through the
 * connector's documented REST passthrough (`HttpRequest`) — the same mechanism
 * the board already uses for `_apis/wit/workitemsbatch` hydration.
 *
 * WHICH OP CLEARS A FIELD — verified live, not reasoned from documentation.
 * An earlier attempt at this sent an empty-string "add":
 *
 *   [{ "op": "add", "path": "/fields/System.Tags", "value": "" }]
 *
 * and that is WRONG. Tested against a work item with a single tag,
 * it returned HTTP 200 with `rev` UNCHANGED and [System.Tags]
 * still set: ADO accepts an empty-string "add" and silently does nothing. The
 * write looked like it succeeded while the tag never went away — the worst
 * possible failure mode. The op that actually applies is "remove":
 *
 *   [{ "op": "remove", "path": "/fields/System.Tags" }]
 *
 * which on the same item returned 200, incremented `rev`, and dropped the
 * field from the response entirely. So: blank value -> "remove" on the field.
 * A later live failure established the other removal case too: when one tag
 * remains, ADO can accept an `add` without replacing the existing tag string,
 * so a non-empty tag removal uses `replace`. Tag additions keep `add`, including
 * the first tag where the field does not exist yet. Other non-blank fields also
 * keep `add`. This remains field-agnostic for clears, so unassigning (clearing
 * [System.AssignedTo]) is fixed by exactly the same blank-value rule.
 *
 * A "remove" targets a field that HAS a value — every caller already skips a
 * write that wouldn't change anything (toggleTag() returns null on a no-op,
 * and unassign/backlog-drop only write when the item has an owner), so a
 * clear is only ever sent for a field that is actually set.
 *
 * Nothing is faked: a rejection is re-thrown with the connector's own message
 * so the caller still rolls its optimistic update back, and a 200 that didn't
 * actually change the field is treated as a FAILURE (see below) rather than
 * being reported as success.
 */
/** Tags as a comparable set: whole tags, trimmed, case-folded, order-free. */
function tagSet(value: unknown): Set<string> {
  const raw =
    typeof value === "string"
      ? value.split(";")
      : Array.isArray(value)
        ? value.map((v) => String(v))
        : [];
  return new Set(
    raw.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0),
  );
}

async function updateWorkItemFieldsViaJsonPatch(
  org: string,
  project: string,
  id: string,
  boardId: string,
  fields: Record<string, unknown>,
  /**
   * The exact tag list this write is trying to store, when it writes tags.
   * Present only so the result can be VERIFIED against what Azure DevOps
   * echoed back — see the tag check below.
   */
  expectTags?: readonly string[],
  /** Date-only Target Date expected after the write; null means cleared. */
  expectTargetDate?: string | null,
  /** A non-empty tag removal replaces the existing [System.Tags] field. */
  replaceTags = false,
): Promise<WorkItemEcho> {
  // Blank -> "remove" (the op that genuinely clears); anything else -> "add".
  const cleared: string[] = [];
  const ops = Object.entries(fields).map(([name, value]) => {
    if (isBlankValue(value)) {
      cleared.push(name);
      return { op: "remove", path: `/fields/${name}` };
    }
    if (replaceTags && name === ADO_TAGS_FIELD) {
      return { op: "replace", path: `/fields/${name}`, value };
    }
    return { op: "add", path: `/fields/${name}`, value };
  });
  if (ops.length === 0) {
    throw new Error("No changes to write to Azure DevOps.");
  }

  const res = await connectors().azureDevOps.httpRequest(org, {
    Method: "PATCH",
    Uri: `${encodeURIComponent(project)}/_apis/wit/workitems/${encodeURIComponent(
      id,
    )}?api-version=7.0`,
    Headers: { "Content-Type": "application/json-patch+json" },
    Body: JSON.stringify(ops),
  });
  if (!res.success) {
    const err = toError(
      res.error,
      `Azure DevOps rejected the update for work item ${boardId}.`,
    );
    // Belt and braces: if the explicit document ALSO comes back as "no
    // operations", the request never reached ADO intact. Say so in plain
    // language instead of surfacing a bare 400 the user can't act on — the
    // connector's own text is kept after it, never replaced or hidden.
    if (/at least one operation is required/i.test(err.message)) {
      throw new Error(
        `Azure DevOps didn't receive the field change for work item ${boardId}, ` +
          `so clearing it couldn't be applied. Original response: ${err.message}`,
      );
    }
    throw err;
  }

  // The raw REST response is `{ id, rev, fields: { "System.Title": ... } }` —
  // dotted reference-name keys, unlike the typed operation's System_Title shape.
  const data = res.data as
    | { rev?: unknown; fields?: Record<string, unknown> }
    | undefined;
  const f = data?.fields ?? {};

  // THE SILENT NO-OP GUARD.
  //
  // This is the failure this whole function exists to prevent: Azure DevOps
  // answering 200 while changing nothing (which is exactly what the old
  // empty-string "add" did). A 200 is therefore not trusted on its own — the
  // echoed work item is checked, and a field we asked to clear that came back
  // STILL SET means the write did not apply. That is raised as an error so the
  // caller rolls its optimistic update back and the user sees a real failure
  // instead of a tag or an assignee that reappears on the next refresh.
  if (cleared.length > 0) {
    if (!data || typeof data.fields !== "object" || data.fields === null) {
      // No echoed item at all: the clear cannot be confirmed, and an
      // unconfirmed clear must never be reported as a success.
      throw new Error(
        `Azure DevOps accepted the update for work item ${boardId} but didn't ` +
          `confirm it, so clearing ${cleared.join(", ")} could not be verified.`,
      );
    }
    const unchanged = cleared.filter((name) => fieldStillSet(f[name]));
    if (unchanged.length > 0) {
      throw new Error(
        `Azure DevOps reported success but did not clear ${unchanged.join(", ")} ` +
          `on work item ${boardId} — the field still has its previous value, so ` +
          `the change was not applied.`,
      );
    }
  }
  /* THE SAME NO-OP GUARD, FOR TAGS THAT ARE BEING SET RATHER THAN CLEARED.
   *
   * The `cleared` check above only covers fields emptied to nothing. Removing
   * ONE tag from several leaves a non-blank value, which that check ignores —
   * and an unapplied write there is invisible, because the work item still has
   * tags, just the wrong ones. That is the shape of the bug this addresses, so
   * the echoed [System.Tags] is compared against exactly what was asked for.
   *
   * Compared as SETS of whole tags, trimmed and case-folded, because Azure
   * DevOps re-serialises the field ("a; b") and does not promise the order or
   * spacing it was given. Only a genuine difference in WHICH tags are present
   * counts as a failure, so this can't fire on cosmetic renormalisation.
   */
  if (expectTags !== undefined) {
    if (!data || typeof data.fields !== "object" || data.fields === null) {
      throw new Error(
        `Azure DevOps accepted the tag change for work item ${boardId} but ` +
          `didn't confirm it, so the new tags could not be verified.`,
      );
    }
    const want = tagSet(expectTags.join(";"));
    const got = tagSet(f[ADO_TAGS_FIELD]);
    const missing = [...want].filter((t) => !got.has(t));
    const leftover = [...got].filter((t) => !want.has(t));
    if (missing.length > 0 || leftover.length > 0) {
      throw new Error(
        `Azure DevOps reported success but the tags on work item ${boardId} ` +
          `are not what was requested — expected [${[...want].join(", ") || "none"}], ` +
          `Azure DevOps returned [${[...got].join(", ") || "none"}]` +
          (leftover.length > 0
            ? `; ${leftover.join(", ")} was not removed.`
            : `; ${missing.join(", ")} was not added.`),
      );
    }
  }
  if (expectTargetDate !== undefined) {
    if (!data || typeof data.fields !== "object" || data.fields === null) {
      throw new Error(
        `Azure DevOps accepted the Target Date change for work item ${boardId} ` +
          "but didn't confirm it.",
      );
    }
    const got = toDateOnly(f[ADO_TARGET_DATE_FIELD]);
    if (got !== expectTargetDate) {
      throw new Error(
        `Azure DevOps reported success but Target Date on work item ${boardId} ` +
          `is ${got ?? "empty"} instead of ${expectTargetDate}.`,
      );
    }
  }

  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;
  const rank = toRank(f[ADO_STACK_RANK_FIELD]);
  return {
    areaPath: str(f[ADO_AREA_PATH_FIELD]),
    title: str(f[ADO_TITLE_FIELD]),
    description: str(f[ADO_DESCRIPTION_FIELD]),
    state: str(f[ADO_STATE_FIELD]),
    assignedTo: displayName(f[ADO_ASSIGNED_TO_FIELD]) ?? undefined,
    stackRank: rank ?? undefined,
    targetDate: toDateOnly(f[ADO_TARGET_DATE_FIELD]) ?? undefined,
  };
}

/**
 * Reroute a work item to a category by writing its new area path (the Triage
 * tab's operation). Thin wrapper over updateWorkItemFields so every write in
 * the app goes through the same real connector call.
 */
export async function updateWorkItemArea(
  cfg: AdoConfig,
  boardId: string,
  targetCode: string,
): Promise<string> {
  const areaPath = categoryAreaPath(targetCode, cfg.areaRoot);
  const echo = await updateWorkItemFields(cfg, boardId, { areaPath });
  // Trust the value ADO echoes back when it sends one; otherwise report the
  // path we asked for.
  return echo.areaPath || areaPath;
}

/** Work item type every item on this board is created as. */
export const ADO_WORK_ITEM_TYPE = appConfig.ado.storyWorkItemType;
export const MY_BUG_WORK_ITEM_TYPE = appConfig.ado.bugWorkItemType;
export const TOP_LEVEL_WORK_ITEM_TYPES = [
  ADO_WORK_ITEM_TYPE,
  MY_BUG_WORK_ITEM_TYPE,
] as const;
export type TopLevelWorkItemType = (typeof TOP_LEVEL_WORK_ITEM_TYPES)[number];

export interface CreatedWorkItem {
  /** Numeric ADO id, when the create response returned one. */
  id: number | null;
  /** Area path ADO echoed back (falls back to the path we requested). */
  areaPath: string;
  title: string;
  workItemType: TopLevelWorkItemType;
  /** Tags the caller asked for at creation. Empty when none were requested. */
  requestedTags: string[];
  /**
   * True ONLY when Azure DevOps confirmed the tags are on the item — i.e. the
   * verified tag write below returned without throwing. Never inferred from a
   * 2xx, and false whenever nothing was requested.
   */
  tagged: boolean;
  /** True only when ADO echoed a creator assignment after the follow-up write. */
  assignedToCreator: boolean;
  /**
   * Why the requested repair setup was not applied. Null when no follow-up was
   * requested, or when every requested field was applied and verified.
   *
   * When this is set the work item STILL EXISTS. The caller must say so with
   * the id rather than report either a clean success or a failed creation.
   */
  followUpError: string | null;
}

/**
 * Create a NEW User Story in Azure DevOps under one of the configured category area
 * paths.
 *
 * Uses the generated connector operation
 * `CreateWorkItem(account, project, type, workItem, shouldReturnAllFields?)`
 * with a create body body ({ title, description?, area? }) — the
 * real connector operation signature, nothing
 * invented. A rejection throws with the connector's own message so the caller
 * can surface the actual failure instead of claiming a success.
 *
 * REPAIR SETUP IS APPLIED AS A SECOND, VERIFIED WRITE — NOT IN THE CREATE CALL.
 *
 * create body does carry a `userEnteredFields` bag, and putting
 * [System.Tags] in it is the obvious one-round-trip answer. It is not the one
 * taken here, for the reason already established for UPDATES (see the long note
 * on tags in updateWorkItemFields): `userEnteredFields` is exactly the untyped
 * path where a connector can answer 200 without applying the field, and the
 * failure is then invisible.
 *
 * What makes it worse at CREATE than at update is that it could not be checked
 * even in principle from the response: the create call's echo is typed as
 * `WorkItemFields`, which declares AreaPath, IterationPath, WorkItemType,
 * State, Reason, CreatedDate/By, ChangedDate/By, Title, Priority, Severity,
 * ValueArea and Description — and NO Tags field at all (verified against
 * generated/models/AzureDevOpsModel.ts, not assumed). So a create-time tag
 * would have to be confirmed by a second round trip regardless, which is
 * precisely what the second write below already is.
 *
 * Going through updateWorkItemFields instead means the tag rides the explicit
 * JSON-Patch path that was verified live, under its `expectTags` check, which
 * compares what Azure DevOps echoed against what was asked for and throws if
 * they differ. So `tagged: true` means Azure DevOps SAID the tag is there.
 *
 * The create is never rolled back if tagging fails: the work item exists, and
 * quietly deleting a real work item to tidy up a tag would be far worse than
 * reporting an untagged item. The failure is returned, with the id, for the
 * caller to surface — the same contract createChildWorkItem uses for a nested
 * item that was created but could not be parented.
 */
export async function createWorkItem(
  cfg: AdoConfig,
  input: {
    title: string;
    description?: string;
    categoryCode: string;
    workItemType?: TopLevelWorkItemType;
    /** Whole tags to put on the new item, e.g. a configured follow-up tag. */
    tags?: readonly string[];
    /** ADO-compatible identity to assign after creation. */
    assigneeIdentity?: string;
  },
): Promise<CreatedWorkItem> {
  const org = cfg.organization.trim();
  const project = cfg.project.trim();
  if (!org || !project) {
    throw new Error("Azure DevOps organization and project are not configured.");
  }

  const title = input.title.trim();
  if (!title) throw new Error("A work item title is required.");
  const workItemType = input.workItemType ?? ADO_WORK_ITEM_TYPE;
  if (!isKnownAreaCode(input.categoryCode)) {
    throw new Error(`Unknown category "${input.categoryCode}".`);
  }
  const areaPath = categoryAreaPath(input.categoryCode, cfg.areaRoot);

  const body: AdoWorkItemBody & { title: string } = { title, area: areaPath };
  const description = input.description?.trim();
  if (description) body.description = description;

  const res = await connectors().azureDevOps.createWorkItem(
    org,
    project,
    workItemType,
    body,
  );
  if (!res.success) {
    throw toError(
      res.error,
      `Azure DevOps rejected the new ${workItemType.toLowerCase()}.`,
    );
  }

  const f = res.data?.fields;
  const rawId = res.data?.id;
  const wantTags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const wantAssignee = input.assigneeIdentity?.trim() || null;
  const result: CreatedWorkItem = {
    id: typeof rawId === "number" && Number.isFinite(rawId) ? rawId : null,
    areaPath:
      typeof f?.System_AreaPath === "string" ? f.System_AreaPath : areaPath,
    title: typeof f?.System_Title === "string" ? f.System_Title : title,
    workItemType,
    requestedTags: wantTags,
    tagged: false,
    assignedToCreator: false,
    followUpError: null,
  };

  // Nothing asked for -> nothing claimed. The item is created as-is, and that
  // is a complete success.
  if (wantTags.length === 0 && !wantAssignee) return result;

  // No id means there is nothing to apply the follow-up fields TO, and nothing
  // to verify against. Say that rather than implying the setup succeeded.
  if (result.id === null) {
    result.followUpError =
      `Azure DevOps created the work item but didn't return its id, so ` +
      `its requested follow-up fields could not be applied or confirmed.`;
    return result;
  }

  try {
    // Tags force the explicit JSON-Patch path, so the repair marker and creator
    // assignment land atomically. The tag check and assignment echo below keep
    // a successful result tied to what Azure DevOps actually stored.
    const echo = await updateWorkItemFields(cfg, String(result.id), {
      ...(wantTags.length > 0 ? { tags: wantTags } : {}),
      ...(wantAssignee
        ? { assignee: { name: null, email: wantAssignee } }
        : {}),
    });
    const assignedToCreator = wantAssignee ? Boolean(echo.assignedTo) : false;
    if (wantAssignee && !assignedToCreator) {
      throw new Error("Azure DevOps did not confirm the creator assignment.");
    }
    result.tagged = wantTags.length > 0;
    result.assignedToCreator = assignedToCreator;
  } catch (err) {
    result.followUpError =
      err instanceof Error
        ? err.message
        : `Couldn't apply the requested fields to work item ${result.id}.`;
  }
  return result;
}

/* ==========================================================================
 * NESTED TASKS — create a Task UNDERNEATH an existing story.
 *
 * ADO's own model is that the CHILD carries the link: a work item's
 * [System.LinkTypes.Hierarchy-Reverse] relation points at its parent (the
 * mirror of CHILD_LINK_REL, which is how the nested lists are read below). So
 * a nested Task can be created and parented in ONE round trip: the connector's
 * create body declares `linkUrl` + `linkType`, and `Hierarchy-
 * reverse` with the PARENT's absolute API URL is exactly that relation.
 *
 * The link is never ASSUMED to have taken, though. After the create, the new
 * item is read back and its real relations are inspected; only ADO saying so
 * makes `parented` true. If the single call didn't parent it, the documented
 * `AddWorkItemLinkAsync` operation is tried as a second pass and the item is
 * read again. An item that exists but could not be linked is reported as
 * exactly that, WITH its id — an orphan the user doesn't know about is worse
 * than a visible failure.
 * ======================================================================== */

export const ADO_NESTED_WORK_ITEM_TYPES = [
  appConfig.ado.taskWorkItemType,
  appConfig.ado.storyWorkItemType,
] as const;
export type NestedWorkItemCreateType =
  (typeof ADO_NESTED_WORK_ITEM_TYPES)[number];

/** ADO's child -> parent hierarchy link (the mirror of CHILD_LINK_REL). */
const PARENT_LINK_REL = "System.LinkTypes.Hierarchy-Reverse";

/**
 * Absolute REST URL of a work item — the form a relation's `linkUrl` /
 * `targetUrl` requires (the `_workitems/edit/…` browser URL from
 * `workItemUrl` is NOT a valid link target).
 */
export function workItemApiUrl(cfg: AdoConfig, boardId: string): string | null {
  const org = cfg.organization.trim();
  const numericId = adoNumericId(boardId);
  if (!org || numericId === null) return null;
  return `https://dev.azure.com/${encodeURIComponent(
    org,
  )}/_apis/wit/workItems/${numericId}`;
}

/** Where a work item sits: its area path and its iteration path. */
export interface WorkItemPlacement {
  areaPath: string | null;
  iterationPath: string | null;
}

/**
 * Read a work item's area AND iteration path.
 *
 * The board hydrates [System.AreaPath] but not [System.IterationPath], so a new
 * nested Task can only inherit its parent's iteration if that one field is
 * fetched. Null means Azure DevOps didn't return the field — the caller then
 * omits it and lets ADO apply the project default rather than guessing a sprint.
 */
export async function fetchWorkItemPlacement(
  cfg: AdoConfig,
  boardId: string,
): Promise<WorkItemPlacement> {
  const { org, project, id } = writeTarget(cfg, boardId);
  const res = await connectors().azureDevOps.httpRequest(org, {
    Method: "POST",
    Uri: `${encodeURIComponent(project)}/_apis/wit/workitemsbatch?api-version=7.0`,
    Headers: { "Content-Type": "application/json" },
    Body: JSON.stringify({
      ids: [Number(id)],
      fields: ["System.AreaPath", "System.IterationPath"],
      errorPolicy: "omit",
    }),
  });
  if (!res.success || !res.data) {
    throw toError(
      res.error,
      `Couldn't read the area and iteration of work item ${boardId}.`,
    );
  }
  const payload = res.data as {
    value?: Array<{ fields?: Record<string, unknown> }>;
  };
  const fields = payload.value?.[0]?.fields ?? {};
  const text = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  return {
    areaPath: text(fields["System.AreaPath"]),
    iterationPath: text(fields["System.IterationPath"]),
  };
}

/** What Azure DevOps ACTUALLY holds for a work item, read back after a write. */
interface WorkItemLiveState {
  /** Ids on this item's Hierarchy-Reverse relations — i.e. its parent(s). */
  parentIds: number[];
  assignee: string | null;
  assigneeEmail: string | null;
  areaPath: string | null;
  iterationPath: string | null;
}

/**
 * One GET that returns BOTH the item's fields and its relations.
 *
 * The `workitemsbatch` endpoint used everywhere else can't do this — an
 * explicit `fields` list and `$expand` are mutually exclusive there — but the
 * single-item endpoint takes `$expand=relations` and still returns the fields,
 * so one call confirms the parent link AND the assignee that were just written.
 */
async function readWorkItemState(
  org: string,
  project: string,
  id: number,
): Promise<WorkItemLiveState> {
  const res = await connectors().azureDevOps.httpRequest(org, {
    Method: "GET",
    Uri: `${encodeURIComponent(
      project,
    )}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.0`,
    Headers: { "Content-Type": "application/json" },
  });
  if (!res.success || !res.data) {
    throw toError(
      res.error,
      `Azure DevOps wouldn't return work item ${id} for verification.`,
    );
  }
  const payload = res.data as {
    fields?: Record<string, unknown>;
    relations?: Array<{ rel?: unknown; url?: unknown }>;
  };
  const fields = payload.fields ?? {};
  const parentIds: number[] = [];
  for (const rel of payload.relations ?? []) {
    if (rel?.rel !== PARENT_LINK_REL) continue;
    const parentId = relationChildId(rel.url);
    if (parentId !== null && !parentIds.includes(parentId)) parentIds.push(parentId);
  }
  const text = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  return {
    parentIds,
    assignee: displayName(fields["System.AssignedTo"]),
    assigneeEmail: identityEmail(fields["System.AssignedTo"]),
    areaPath: text(fields["System.AreaPath"]),
    iterationPath: text(fields["System.IterationPath"]),
  };
}

export interface CreateChildWorkItemInput {
  /** Board id of the work item the new item goes under ("#123"). */
  parentBoardId: string;
  workItemType: NestedWorkItemCreateType;
  title: string;
  description?: string;
  /**
   * Identity (email/UPN) to assign the new Task to. Null/undefined leaves it
   * unassigned — a new item has no owner, so nothing needs clearing.
   */
  assigneeEmail?: string | null;
  /** Display name for the chosen identity, used only in messages. */
  assigneeName?: string | null;
  /** Area path inherited from the parent. Omitted -> ADO's own default. */
  areaPath?: string | null;
  /** Iteration path inherited from the parent, when it could be read. */
  iterationPath?: string | null;
}

export interface CreatedChildWorkItem {
  /** ADO's id for the new work item, when the create response carried one. */
  id: number | null;
  workItemType: NestedWorkItemCreateType;
  title: string;
  /** TRUE only when Azure DevOps' own relations confirm the parent link. */
  parented: boolean;
  /** How the link actually happened — the single create, or the fallback. */
  linkedVia: "create" | "add-link" | null;
  /** Real error text when the Task EXISTS but could not be parented. */
  linkError: string | null;
  /** Set when the verification read itself failed (outcome unconfirmed). */
  verifyError: string | null;
  /** What ADO stored for the new Task (never what we asked for). */
  areaPath: string | null;
  iterationPath: string | null;
  /** TRUE only when ADO confirms the requested identity is the owner. */
  assigned: boolean;
  /** Whether the owner rode the create call or a follow-up field write. */
  assignedVia: "create" | "update" | null;
  /** Real error text when the Task exists but the assignment didn't stick. */
  assignError: string | null;
}

/**
 * Create a Task or User Story nested under an existing work item, for real.
 *
 * Throws only when the work item could not be CREATED (the connector's own message
 * is preserved). Everything after that — the parent link, the assignee — is
 * reported in the result rather than thrown, because the work item exists by
 * then and the caller must be able to tell the user precisely what did and
 * didn't happen instead of showing a blanket success or a blanket failure.
 */
export async function createChildWorkItem(
  cfg: AdoConfig,
  input: CreateChildWorkItemInput,
): Promise<CreatedChildWorkItem> {
  const { org, project } = writeTarget(cfg, input.parentBoardId);
  const parentId = adoNumericId(input.parentBoardId);
  if (parentId === null) {
    throw new Error(`Work item ${input.parentBoardId} has no usable Azure DevOps id.`);
  }
  const parentUrl = workItemApiUrl(cfg, input.parentBoardId);
  if (!parentUrl) {
    throw new Error(
      `Couldn't build the Azure DevOps link target for work item ${input.parentBoardId}.`,
    );
  }

  const title = input.title.trim();
  if (!title) throw new Error(`A ${input.workItemType} title is required.`);

  // ONE call: the item, its placement, its owner AND its parent link.
  const body: AdoWorkItemBody & { title: string } = {
    title,
    linkUrl: parentUrl,
    linkType: "Hierarchy-reverse",
  };
  const description = input.description?.trim();
  if (description) body.description = description;
  const areaPath = input.areaPath?.trim();
  if (areaPath) body.area = areaPath;
  const iterationPath = input.iterationPath?.trim();
  if (iterationPath) body.iteration = iterationPath;
  const wantedEmail = normalizeAssigneeIdentity(input.assigneeEmail);
  if (wantedEmail) {
    // Same escape hatch every other System.* write in this file uses.
    body.userEnteredFields = { [ADO_ASSIGNED_TO_FIELD]: wantedEmail };
  }

  const res = await connectors().azureDevOps.createWorkItem(
    org,
    project,
    input.workItemType,
    body,
  );
  if (!res.success) {
    throw toError(
      res.error,
      `Azure DevOps rejected the new ${input.workItemType.toLowerCase()}.`,
    );
  }

  const rawId = res.data?.id;
  const id = typeof rawId === "number" && Number.isFinite(rawId) ? rawId : null;
  const echoed = res.data?.fields;
  const result: CreatedChildWorkItem = {
    id,
    workItemType: input.workItemType,
    title: typeof echoed?.System_Title === "string" ? echoed.System_Title : title,
    parented: false,
    linkedVia: null,
    linkError: null,
    verifyError: null,
    areaPath: typeof echoed?.System_AreaPath === "string" ? echoed.System_AreaPath : null,
    iterationPath:
      typeof echoed?.System_IterationPath === "string"
        ? echoed.System_IterationPath
        : null,
    assigned: false,
    assignedVia: null,
    assignError: null,
  };

  // Without an id there is nothing to verify against and nothing to repair —
  // say so rather than implying the link worked.
  if (id === null) {
    result.verifyError =
      `Azure DevOps didn't return an id for the new ${input.workItemType.toLowerCase()}, so its parent link couldn't be confirmed.`;
    return result;
  }

  let state: WorkItemLiveState | null = null;
  try {
    state = await readWorkItemState(org, project, id);
  } catch (err) {
    result.verifyError =
      err instanceof Error
        ? err.message
        : `Couldn't read work item ${id} back from Azure DevOps.`;
  }

  if (state) {
    result.areaPath = state.areaPath ?? result.areaPath;
    result.iterationPath = state.iterationPath ?? result.iterationPath;
    result.parented = state.parentIds.includes(parentId);
    if (result.parented) result.linkedVia = "create";
  }

  // FALLBACK: the create didn't parent it (or we couldn't tell) — add the
  // relation explicitly through the connector's own link operation.
  if (!result.parented && state) {
    try {
      const link = await connectors().azureDevOps.addWorkItemLink(
        org,
        project,
        input.workItemType,
        id,
        { linkType: PARENT_LINK_REL, targetUrl: parentUrl },
      );
      if (!link.success) {
        throw toError(link.error, "Azure DevOps rejected the parent link.");
      }
      const after = await readWorkItemState(org, project, id);
      result.parented = after.parentIds.includes(parentId);
      if (result.parented) {
        result.linkedVia = "add-link";
      } else {
        result.linkError =
          `Azure DevOps accepted the link request but the ${input.workItemType.toLowerCase()} still has no parent link.`;
      }
    } catch (err) {
      result.linkError =
        err instanceof Error
          ? err.message
          : `Azure DevOps rejected the parent link for the new ${input.workItemType.toLowerCase()}.`;
    }
  }

  // ASSIGNEE — set on the create above; only written again if it didn't stick.
  if (wantedEmail) {
    const got = state ? normalizeAssigneeIdentity(state.assigneeEmail) : null;
    if (got && got === wantedEmail) {
      result.assigned = true;
      result.assignedVia = "create";
    } else {
      try {
        await updateWorkItemFields(cfg, String(id), {
          assignee: {
            name: input.assigneeName ?? null,
            email: input.assigneeEmail ?? null,
          },
        });
        result.assigned = true;
        result.assignedVia = "update";
      } catch (err) {
        result.assignError =
          err instanceof Error
            ? err.message
            : `Azure DevOps rejected the assignment for the new ${input.workItemType.toLowerCase()}.`;
      }
    }
  }

  return result;
}

/** Trimmed, lower-cased identity, or null when there isn't a usable one. */
function normalizeAssigneeIdentity(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  return value ? value : null;
}

/* ==========================================================================
 * DELETING A WORK ITEM (recycle bin, never destroy)
 *
 * The connector has NO delete operation — its 44 operations cover create,
 * update and links, but nothing removes a work item. So this goes through the
 * same documented REST passthrough the rest of this file uses:
 *
 *   DELETE {project}/_apis/wit/workitems/{id}?api-version=7.0
 *
 * which moves the item to the project's RECYCLE BIN, where an Azure DevOps
 * administrator can restore it. `?destroy=true` (the permanent, unrecoverable
 * purge) is deliberately NOT used and must never be added here.
 *
 * A 2xx is not taken as proof. This module's standing rule is that a write is
 * confirmed by READING ADO back (the same reason the silent-no-op guard exists
 * on field writes), so the item is looked for afterwards: `workitemsbatch` with
 * `errorPolicy: "omit"` simply doesn't return an id it can no longer resolve,
 * which makes "is it gone?" a truthful yes/no rather than an assumption.
 *
 * ITS OWN CHILDREN are handled by OBSERVATION, not by belief: their ids are
 * read before the delete and looked for again afterwards, so the caller can
 * report what actually happened to them instead of claiming ADO cascades (or
 * doesn't). Nothing here guesses.
 * ======================================================================== */

/** Of the given ids, the ones Azure DevOps still returns a work item for. */
async function existingWorkItemIds(
  org: string,
  project: string,
  ids: number[],
): Promise<number[]> {
  if (ids.length === 0) return [];
  const res = await connectors().azureDevOps.httpRequest(org, {
    Method: "POST",
    Uri: `${encodeURIComponent(project)}/_apis/wit/workitemsbatch?api-version=7.0`,
    Headers: { "Content-Type": "application/json" },
    // `omit` is what makes this a presence test: a deleted / unresolvable id is
    // left out of the response instead of failing the whole request.
    Body: JSON.stringify({
      ids,
      fields: ["System.Id"],
      errorPolicy: "omit",
    }),
  });
  if (!res.success || !res.data) {
    throw toError(
      res.error,
      "Azure DevOps wouldn't confirm whether the work item still exists.",
    );
  }
  const payload = res.data as {
    value?: Array<{ id?: number; fields?: Record<string, unknown> }>;
  };
  if (!Array.isArray(payload.value)) {
    throw new Error(
      "Azure DevOps returned an unexpected shape while confirming the delete.",
    );
  }
  const found: number[] = [];
  for (const row of payload.value) {
    const raw = row.id ?? (row.fields ?? {})["System.Id"];
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n) && n > 0) found.push(n);
  }
  return found;
}

export interface DeleteWorkItemResult {
  id: number;
  /** TRUE only when Azure DevOps confirms the item is no longer retrievable. */
  deleted: boolean;
  /**
   * Set when the delete was ACCEPTED but the item is still there afterwards —
   * the delete equivalent of this module's silent-no-op guard.
   */
  stillPresent: boolean;
  /** Set when the outcome couldn't be confirmed either way. */
  verifyError: string | null;
  /** The item's OWN children, read immediately before the delete. */
  childIds: number[];
  /** Of those, the ones that still exist afterwards — observed, not assumed. */
  survivingChildIds: number[];
  /** Set when the children couldn't be read before or checked after. */
  childCheckError: string | null;
}

/**
 * Move a work item to the Azure DevOps recycle bin, and verify that it went.
 *
 * Throws only when Azure DevOps REFUSES the delete (permissions are the common
 * case), carrying the connector's own message. Everything else is reported in
 * the result so the caller can tell the user exactly what is true.
 */
export async function deleteWorkItem(
  cfg: AdoConfig,
  boardId: string,
): Promise<DeleteWorkItemResult> {
  const { org, project, id } = writeTarget(cfg, boardId);
  const numericId = Number(id);

  const result: DeleteWorkItemResult = {
    id: numericId,
    deleted: false,
    stillPresent: false,
    verifyError: null,
    childIds: [],
    survivingChildIds: [],
    childCheckError: null,
  };

  // BEFORE: what hangs off this item, so its fate can be checked afterwards.
  // A failure here must not block the delete — it only costs the follow-up
  // report, which then says the check couldn't be made.
  try {
    const before = await childIdsForChunk(org, project, [numericId]);
    result.childIds = before.get(numericId) ?? [];
  } catch (err) {
    result.childCheckError =
      err instanceof Error
        ? err.message
        : "Couldn't read this work item's nested items before deleting it.";
  }

  // THE DELETE. No `destroy` parameter: this is the recoverable recycle-bin
  // delete, and it must stay that way.
  const res = await connectors().azureDevOps.httpRequest(org, {
    Method: "DELETE",
    Uri: `${encodeURIComponent(
      project,
    )}/_apis/wit/workitems/${numericId}?api-version=7.0`,
    Headers: { "Content-Type": "application/json" },
  });
  if (!res.success) {
    throw toError(
      res.error,
      `Azure DevOps rejected the delete for work item ${boardId}.`,
    );
  }

  // AFTER: confirm it really is gone rather than trusting the response.
  try {
    const stillThere = await existingWorkItemIds(org, project, [numericId]);
    result.deleted = !stillThere.includes(numericId);
    result.stillPresent = !result.deleted;
  } catch (err) {
    result.verifyError =
      err instanceof Error
        ? err.message
        : `Couldn't confirm whether work item ${boardId} was deleted.`;
  }

  // What became of its own children — observed, so the caller never has to
  // claim a cascade behaviour that wasn't witnessed.
  if (result.childIds.length > 0) {
    try {
      result.survivingChildIds = await existingWorkItemIds(
        org,
        project,
        result.childIds,
      );
    } catch (err) {
      result.childCheckError =
        err instanceof Error
          ? err.message
          : "Couldn't check what happened to this work item's nested items.";
    }
  }

  return result;
}

/**
 * Fields explicitly requested from the ADO REST batch endpoint.
 *
 * WHY THIS EXISTS (the StackRank bug): the connector's typed `ListWorkItems`
 * operation takes NO field-selection parameter and its response type
 * (`ListWorkItemResponse`) declares a CLOSED set of 15 System.* fields —
 * [Microsoft.VSTS.Common.StackRank] is not one of them, and the string
 * "StackRank" appears nowhere in the generated connector client at all. So the
 * rank was never in the payload: `stackRank` mapped to null for EVERY item, the
 * comparator fell through to its id tie-break, and the board rendered in id
 * order while looking like a sort had been applied.
 *
 * The fix is to hydrate through the connector's documented REST passthrough
 * (`HttpRequest`) against `_apis/wit/workitemsbatch`, which accepts an explicit
 * `fields` list and therefore CAN return StackRank. Same 200-id batching.
 */
export const HYDRATE_FIELDS = [
  "System.Id",
  "System.WorkItemType",
  "System.Title",
  "System.Description",
  "System.State",
  "System.AreaPath",
  "System.AssignedTo",
  "System.CreatedDate",
  "System.CreatedBy",
  "System.Tags",
  ADO_TARGET_DATE_FIELD,
  "Microsoft.VSTS.Common.StackRank",
] as const;

/**
 * Field list for the COMPLETED tab: everything the board hydrates, plus the two
 * real date fields that view needs — [Microsoft.VSTS.Common.ClosedDate] (the
 * completion date proper) and [System.ChangedDate] (its fallback, and the field
 * the 6-month window is filtered on). Kept as a SEPARATE list so the board's
 * hydration is byte-for-byte unchanged.
 */
export const COMPLETED_HYDRATE_FIELDS = [
  ...HYDRATE_FIELDS,
  COMPLETED_DATE_FIELD,
  COMPLETED_WINDOW_FIELD,
] as const;

// AssignedTo may arrive as a plain "Name <email>" string or an identity object.
function displayName(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const lt = raw.indexOf("<");
    const name = (lt > 0 ? raw.slice(0, lt) : raw).trim();
    return name || null;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return (
      (typeof o.displayName === "string" && o.displayName) ||
      (typeof o.uniqueName === "string" && o.uniqueName) ||
      null
    );
  }
  return null;
}

// THE ADO-KNOWN IDENTITY for a work item person field (AssignedTo, CreatedBy).
//
// This is not just photo-lookup data: it is the value written BACK to
// [System.AssignedTo], so which key wins here decides whether an assignment
// succeeds. `uniqueName` is checked FIRST and deliberately — it is the address
// Azure DevOps itself uses for the identity (normally the UPN), and it can
// differ from the person's Office 365 `mail` address.
// Writing the wrong one comes back as:
//
//   400 — The identity value '…' for field 'Assigned To' is an unknown
//         identity. (WorkItemFieldInvalidException, errorCode 600171)
//
// Round-tripping ADO's own `uniqueName` is what keeps a write to this field
// resolvable, so the ordering below must not be rearranged. (The identity
// object also carries an `id` GUID and a `descriptor`; those are unambiguous
// too, but this board has only ever verified `uniqueName` against the real
// org, so that is what is used rather than an unproven form.)
//
// Handles "Name <email>" strings and identity objects. Returns null when no
// plausible address is present — never guesses an address from a display name.
function identityEmail(raw: unknown): string | null {
  const pick = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s.includes("@") ? s : null;
  };
  if (!raw) return null;
  if (typeof raw === "string") {
    const m = raw.match(/<([^>]+)>/);
    return pick(m ? m[1] : raw);
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return (
      pick(o.uniqueName) ??
      pick(o.mail) ??
      pick(o.principalName) ??
      pick(o.emailAddress) ??
      pick(o.displayName)
    );
  }
  return null;
}

// Connector data is untrusted. Keep this plain-text projection for compact cards,
// filtering, and accessibility; mapRow separately preserves the raw description
// for the allowlisted SafeRichText renderer.
function toText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// [System.CreatedDate] arrives as an ISO-ish string from the connector. Keep the
// raw value only when it parses to a real date; anything unparseable becomes
// null so the UI shows "unknown" instead of an invented timestamp.
function toIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? raw : null;
}

function toDateOnly(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

// [Microsoft.VSTS.Common.StackRank] is the backlog ordering field. The connector
// returns it as a number (sometimes a numeric string), and omits it entirely for
// items that have never been ranked — those map to null and sort last rather
// than getting an invented rank.
function toRank(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// [System.Tags] arrives as ONE semicolon-separated string ("infra; spike"; the
// generated client types it as `System.Tags?: string`). Split it into the real
// individual tags, trimming ADO's padding and dropping empties/duplicates.
// Anything else (missing field, non-string) yields an empty list — tags are
// never invented.
function toTags(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(";")) {
    const tag = part.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function toError(err: unknown, fallback: string): Error {
  if (err instanceof Error) return err;
  if (err && typeof err === "object" && "message" in err) {
    return new Error(String((err as { message: unknown }).message) || fallback);
  }
  if (typeof err === "string" && err) return new Error(err);
  return new Error(fallback);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// Run a single WIQL query through the connector's allowed generic REST action.
// The target environment's connector policy excludes the typed RunWiqlQuery
// action, while allowing HttpRequest; both reach the same Azure DevOps endpoint.
async function runWiqlIds(
  org: string,
  project: string,
  wiql: string,
): Promise<number[]> {
  const queryResult = await connectors().azureDevOps.httpRequest(org, {
    Method: "POST",
    Uri: `${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
    Headers: { "Content-Type": "application/json" },
    Body: JSON.stringify({ query: wiql }),
  });
  if (!queryResult.success) {
    throw toError(queryResult.error, "Azure DevOps WIQL query failed.");
  }
  const payload = queryResult.data as unknown as {
    workItems?: Array<{ id?: number }>;
  };
  return (payload.workItems ?? [])
    .map((w) => w.id)
    .filter((id): id is number => typeof id === "number");
}

/**
 * Collect EVERY matching work-item id, paging past any per-response cap.
 *
 * The generated `RunWiqlQuery` exposes no `$top`/`maxResults`/paging parameter
 * and the WIQL REST endpoint has no continuation token, so a single call can be
 * silently capped by the connector (the reported "only 50 returned" bug). We
 * therefore keyset-paginate the default area scope by [System.Id]: keep
 * asking for ids strictly greater than the highest id collected so far, ordered
 * ascending, until a page adds nothing new. This drains the complete set
 * regardless of whether the per-response cap is 50, 200, or absent.
 *
 * A custom WIQL override is an advanced escape hatch — we can't safely inject a
 * keyset cursor into arbitrary SQL, so it runs as a single query.
 */
// A hydrated work-item row, flattened to dotted reference-name keys.
type HydratedRow = Record<string, unknown>;

/**
 * Hydrate one <=200-id chunk through the connector's REST passthrough, asking
 * for HYDRATE_FIELDS explicitly (this is the ONLY path that returns StackRank).
 *
 * `errorPolicy: "omit"` keeps a single deleted/inaccessible id from failing the
 * whole batch. The response is the raw ADO shape
 * `{ count, value: [{ id, fields: { "System.Title": ... } }] }`, so each row is
 * flattened to `{ ...fields, "System.Id": id }` — the same dotted-key shape the
 * field mapper below already reads.
 */
async function hydrateChunkViaRest(
  org: string,
  project: string,
  chunk: number[],
  fields: readonly string[] = HYDRATE_FIELDS,
): Promise<HydratedRow[]> {
  const res = await connectors().azureDevOps.httpRequest(org, {
    Method: "POST",
    Uri: `${encodeURIComponent(project)}/_apis/wit/workitemsbatch?api-version=7.0`,
    Headers: { "Content-Type": "application/json" },
    Body: JSON.stringify({
      ids: chunk,
      fields: [...fields],
      errorPolicy: "omit",
    }),
  });
  if (!res.success || !res.data) {
    throw toError(
      res.error,
      "Azure DevOps rejected the work-item batch request.",
    );
  }
  const payload = res.data as {
    value?: Array<{ id?: number; fields?: Record<string, unknown> }>;
  };
  if (!Array.isArray(payload.value)) {
    throw new Error("Azure DevOps returned an unexpected work-item batch shape.");
  }
  return payload.value.map((row) => ({
    ...(row.fields ?? {}),
    "System.Id": row.id ?? (row.fields ?? {})["System.Id"],
  }));
}

/**
 * Fallback hydration via the typed `ListWorkItems` operation. This keeps the
 * board loading if the REST passthrough is unavailable, but its field set
 * CANNOT include StackRank — so callers mark the result as unranked rather than
 * showing a silently mis-ordered board.
 */
async function hydrateChunkViaList(
  org: string,
  project: string,
  chunk: number[],
): Promise<HydratedRow[]> {
  const res = await connectors().azureDevOps.listWorkItems(
    org,
    project,
    chunk.join(","),
    ADO_WORK_ITEM_TYPE,
  );
  if (!res.success || !res.data) {
    throw toError(
      res.error,
      "Failed to load a batch of Azure DevOps work items.",
    );
  }
  return (res.data.value ?? []) as unknown as HydratedRow[];
}

/**
 * THE keyset-pagination engine, shared by every query in this module (the board
 * query and the Completed query both drain through it — the cursor logic exists
 * exactly once). `buildPage(afterId)` must return a WIQL statement selecting
 * ids strictly greater than `afterId`, ordered by [System.Id] ASC.
 */
async function drainKeysetIds(
  org: string,
  project: string,
  buildPage: (afterId: number) => string,
): Promise<{ ids: number[]; capped: boolean; pages: number }> {
  const ids: number[] = [];
  const seen = new Set<number>();
  let cursor = 0;
  let pages = 0;
  let capped = false;
  let drained = false;

  while (pages < MAX_WIQL_PAGES) {
    pages++;
    const pageIds = await runWiqlIds(org, project, buildPage(cursor));
    let maxThisPage = cursor;
    let fresh = 0;
    for (const id of pageIds) {
      if (id > cursor && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
        if (id > maxThisPage) maxThisPage = id;
        fresh++;
      }
    }
    // No new ids above the cursor -> the query is fully drained.
    if (fresh === 0) {
      drained = true;
      break;
    }
    cursor = maxThisPage; // advance past everything just collected
    if (ids.length >= WIQL_ID_CAP) {
      capped = true;
      break;
    }
  }

  // Exhausted the page-safety bound while still advancing: surface it as a
  // truncated result rather than silently claiming the board is complete.
  if (!drained && !capped && pages >= MAX_WIQL_PAGES) capped = true;

  return { ids, capped, pages };
}

async function fetchAllWiqlIds(
  org: string,
  project: string,
  cfg: AdoConfig,
): Promise<{ ids: number[]; capped: boolean; pages: number }> {
  const custom = cfg.wiql.trim();
  if (custom) {
    const ids = Array.from(new Set(await runWiqlIds(org, project, custom)));
    return { ids, capped: ids.length >= WIQL_ID_CAP, pages: 1 };
  }
  return drainKeysetIds(org, project, (afterId) =>
    pagedDefaultWiql(cfg.areaRoot, afterId),
  );
}

/**
 * Hydrate a full id list into raw rows, chunked at HYDRATE_CHUNK ids per
 * request. Shared by the board and the Completed tab: the REST passthrough is
 * probed on the first chunk (it is the only path that honours an explicit field
 * list) and, if it's unavailable, every chunk falls back to the typed
 * ListWorkItems operation with the reason recorded.
 */
async function hydrateIds(
  org: string,
  project: string,
  ids: number[],
  fields: readonly string[],
): Promise<{
  rows: HydratedRow[];
  hydrateMode: FetchLiveResult["hydrateMode"];
  note: string | null;
}> {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += HYDRATE_CHUNK) {
    chunks.push(ids.slice(i, i + HYDRATE_CHUNK));
  }

  let hydrateMode: FetchLiveResult["hydrateMode"] = "batch-rest";
  let note: string | null = null;
  let firstRows: HydratedRow[];
  try {
    firstRows = await hydrateChunkViaRest(org, project, chunks[0], fields);
  } catch (err) {
    hydrateMode = "list-fallback";
    note = toError(err, "Work-item batch request failed.").message;
    firstRows = await hydrateChunkViaList(org, project, chunks[0]);
  }

  const rest = await mapWithConcurrency(chunks.slice(1), 4, (chunk) =>
    // Surface a batch failure loudly rather than return a silently short list.
    hydrateMode === "batch-rest"
      ? hydrateChunkViaRest(org, project, chunk, fields)
      : hydrateChunkViaList(org, project, chunk),
  );

  return { rows: [firstRows, ...rest].flat(), hydrateMode, note };
}

/** Map one hydrated row onto the board's WorkItem shape. */
function mapRow(row: HydratedRow, cfg: AdoConfig): WorkItem {
  // Support both dotted ("System.Title") and underscored ("System_Title") keys.
  const r = row as unknown as Record<string, unknown>;
  const get = (key: string): unknown => r[key] ?? r[key.replace(/\./g, "_")];

  const idRaw = get("System.Id");
  const idNum = typeof idRaw === "number" ? idRaw : Number(idRaw);
  const idLabel = Number.isFinite(idNum) ? String(idNum) : "";
  const areaPath = (get("System.AreaPath") as string) ?? "";
  const rawDescription =
    typeof get("System.Description") === "string"
      ? (get("System.Description") as string)
      : "";

  return {
    id: `#${idLabel}`,
    workItemType: toText(get("System.WorkItemType")),
    title: toText(get("System.Title")) || `Work item ${idLabel}`.trim(),
    area: areaCategoryCode(areaPath, cfg.areaRoot),
    areaPath,
    assignee: displayName(get("System.AssignedTo")),
    assigneeEmail: identityEmail(get("System.AssignedTo")),
    description: toText(rawDescription),
    descriptionHtml: /<[a-z][\s\S]*>/i.test(rawDescription)
      ? rawDescription
      : undefined,
    state: (get("System.State") as string) ?? "",
    // Creation metadata comes straight from the hydrated work item — the
    // Triage "recently created" list shows only what ADO actually returned
    // (null when the connector omits the field), never a synthesized date
    // or author.
    createdDate: toIsoDate(get("System.CreatedDate")),
    createdBy: displayName(get("System.CreatedBy")),
    createdByEmail: identityEmail(get("System.CreatedBy")),
    // Real completion / last-changed dates, only present when the caller asked
    // for those fields AND Azure DevOps returned a parseable value.
    closedDate: toIsoDate(get(COMPLETED_DATE_FIELD)),
    changedDate: toIsoDate(get(COMPLETED_WINDOW_FIELD)),
    targetDate: toDateOnly(get(ADO_TARGET_DATE_FIELD)),
    // Real [System.Tags] from ADO, split into individual tags.
    tags: toTags(get("System.Tags")),
    // Backlog priority order straight from ADO (null when not returned).
    stackRank: toRank(get("Microsoft.VSTS.Common.StackRank")),
  };
}

/** Fetch one work item with the same fields and mapping used by the live board. */
export async function fetchWorkItem(
  cfg: AdoConfig,
  boardId: string,
): Promise<WorkItem> {
  const org = cfg.organization.trim();
  const project = cfg.project.trim();
  const numericId = adoNumericId(boardId);
  if (!org || !project) {
    throw new Error("Azure DevOps organization and project are not configured.");
  }
  if (numericId === null) {
    throw new Error(`Work item ${boardId} has no usable Azure DevOps id.`);
  }

  const rows = await hydrateChunkViaRest(
    org,
    project,
    [numericId],
    COMPLETED_HYDRATE_FIELDS,
  );
  const row = rows.find((candidate) => {
    const values = candidate as Record<string, unknown>;
    return Number(values["System.Id"] ?? values.System_Id) === numericId;
  });
  if (!row) {
    throw new Error(
      `Azure DevOps did not return work item ${boardId}. It may have been deleted or you may no longer have access.`,
    );
  }
  return mapRow(row, cfg);
}

/**
 * The real date a work item was completed: [Microsoft.VSTS.Common.ClosedDate]
 * when ADO returned one, otherwise [System.ChangedDate]. Returns null when
 * neither is available — the UI then says "date unavailable" rather than
 * showing an invented timestamp.
 */
export function completionDate(item: WorkItem): string | null {
  return item.closedDate ?? item.changedDate ?? null;
}

/** Most recently completed first; items with no usable date sort last. */
export function compareByCompletion(a: WorkItem, b: WorkItem): number {
  const ta = completionDate(a) ? Date.parse(completionDate(a) as string) : NaN;
  const tb = completionDate(b) ? Date.parse(completionDate(b) as string) : NaN;
  const va = Number.isFinite(ta) ? ta : null;
  const vb = Number.isFinite(tb) ? tb : null;
  if (va !== vb) {
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va; // newest first
  }
  return (adoNumericId(b.id) ?? 0) - (adoNumericId(a.id) ?? 0);
}

export interface FetchCompletedResult {
  items: WorkItem[];
  idCount: number;
  hydrated: number;
  capped: boolean;
  pages: number;
  durationMs: number;
  fetchedAt: number;
  hydrateMode: FetchLiveResult["hydrateMode"];
  /** Start of the window these results cover (real Date, not a label). */
  since: string;
  /** How many items came back with a true ClosedDate (vs the ChangedDate fallback). */
  withClosedDate: number;
  note: string | null;
}

/**
 * Query COMPLETED work (completed states only) from the SAME recursive area
 * scope as the board, limited to the last `monthsBack` months by
 * [System.ChangedDate]. Reuses the identical keyset pagination
 * (drainKeysetIds) and chunked hydration (hydrateIds) the board uses — the only
 * differences are the WHERE clause and the extra date fields requested.
 */
export async function fetchCompletedWorkItems(
  cfg: AdoConfig,
  monthsBack = COMPLETED_WINDOW_MONTHS,
): Promise<FetchCompletedResult> {
  const startedAt = Date.now();
  const org = cfg.organization.trim();
  const project = cfg.project.trim();
  if (!org || !project) {
    throw new Error(
      "Enter an Azure DevOps organization and project to load completed work items.",
    );
  }

  const since = completedWindowStart(monthsBack);
  const { ids, capped, pages } = await drainKeysetIds(org, project, (afterId) =>
    pagedCompletedWiql(cfg.areaRoot, since, afterId),
  );

  if (ids.length === 0) {
    return {
      items: [],
      idCount: 0,
      hydrated: 0,
      capped,
      pages,
      durationMs: Date.now() - startedAt,
      fetchedAt: Date.now(),
      hydrateMode: "batch-rest",
      since: since.toISOString(),
      withClosedDate: 0,
      note: null,
    };
  }

  const { rows, hydrateMode, note } = await hydrateIds(
    org,
    project,
    ids,
    COMPLETED_HYDRATE_FIELDS,
  );

  const items = rows.map((row) => mapRow(row, cfg));
  // Historical work reads best newest-first, so completion order (not
  // StackRank) is the sort here. The board's StackRank ordering is untouched.
  items.sort(compareByCompletion);

  const withClosedDate = items.reduce((n, it) => (it.closedDate ? n + 1 : n), 0);

  return {
    items,
    idCount: ids.length,
    hydrated: items.length,
    capped,
    pages,
    durationMs: Date.now() - startedAt,
    fetchedAt: Date.now(),
    hydrateMode,
    since: since.toISOString(),
    withClosedDate,
    note:
      note ??
      (hydrateMode === "list-fallback"
        ? "Closed dates are unavailable on the fallback hydration path — showing last-changed dates."
        : null),
  };
}

export interface FetchTrackerResult extends FetchLiveResult {
  requestedTags: string[];
}

/**
 * Load every supported work item under the configured area that carries at
 * least one of the requested tracker tags. Terminal items are deliberately
 * retained and no rolling time window is applied.
 */
export async function fetchTrackerWorkItems(
  cfg: AdoConfig,
  requestedTags: readonly string[],
): Promise<FetchTrackerResult> {
  const startedAt = Date.now();
  const org = cfg.organization.trim();
  const project = cfg.project.trim();
  if (!org || !project) {
    throw new Error(
      "Enter an Azure DevOps organization and project to load tracker work items.",
    );
  }

  const tags = Array.from(
    new Map(
      requestedTags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => [tag.toLowerCase(), tag]),
    ).values(),
  );
  if (tags.length === 0) {
    return {
      items: [],
      idCount: 0,
      hydrated: 0,
      capped: false,
      pages: 0,
      durationMs: Date.now() - startedAt,
      fetchedAt: Date.now(),
      hydrateMode: "batch-rest",
      ranked: 0,
      rankNote: null,
      requestedTags: [],
    };
  }

  const { ids, capped, pages } = await drainKeysetIds(
    org,
    project,
    (afterId) => pagedTrackerWiql(cfg.areaRoot, tags, afterId),
  );
  if (ids.length === 0) {
    return {
      items: [],
      idCount: 0,
      hydrated: 0,
      capped,
      pages,
      durationMs: Date.now() - startedAt,
      fetchedAt: Date.now(),
      hydrateMode: "batch-rest",
      ranked: 0,
      rankNote: null,
      requestedTags: tags,
    };
  }

  const {
    rows,
    hydrateMode,
    note: hydrateNote,
  } = await hydrateIds(org, project, ids, HYDRATE_FIELDS);
  const items = rows
    .map((row) => mapRow(row, cfg))
    .filter((item) => tags.some((tag) => hasExactTag(item, tag)))
    .sort(compareByStackRank);
  const ranked = items.reduce(
    (count, item) => count + (typeof item.stackRank === "number" ? 1 : 0),
    0,
  );

  return {
    items,
    idCount: ids.length,
    hydrated: items.length,
    capped,
    pages,
    durationMs: Date.now() - startedAt,
    fetchedAt: Date.now(),
    hydrateMode,
    ranked,
    rankNote:
      hydrateNote ??
      (ranked === 0 && items.length > 0
        ? "Azure DevOps returned no StackRank values for these work items."
        : null),
    requestedTags: tags,
  };
}

/**
 * Query live User Stories, Features, and Epics from Azure DevOps and map them
 * into board WorkItems.
 *
 * Pipeline: a keyset-paginated recursive WIQL query drains every matching id
 * (paging past any per-response cap — see fetchAllWiqlIds), the full id list is
 * chunked into <=200-id batches, and every chunk is hydrated via the batch
 * ListWorkItems endpoint so the complete result set loads (no truncation).
 * Throws on missing config or connector failure so the caller can show an error
 * state — it never falls back to sample data.
 */
export async function fetchLiveWorkItems(
  cfg: AdoConfig,
): Promise<FetchLiveResult> {
  const startedAt = Date.now();
  const org = cfg.organization.trim();
  const project = cfg.project.trim();
  if (!org || !project) {
    throw new Error(
      "Enter an Azure DevOps organization and project to load live work items.",
    );
  }

  const { ids, capped, pages } = await fetchAllWiqlIds(org, project, cfg);

  if (ids.length === 0) {
    return {
      items: [],
      idCount: 0,
      hydrated: 0,
      capped,
      pages,
      durationMs: Date.now() - startedAt,
      fetchedAt: Date.now(),
      hydrateMode: "batch-rest",
      ranked: 0,
      rankNote: null,
    };
  }

  // Chunk the full id list (batch endpoint caps at ~200 ids) and hydrate EVERY
  // chunk so no matching work item is left behind. The REST path is probed on
  // the first chunk — it is the only one that returns StackRank — and its
  // failure reason (if any) is what tells the UI the board isn't ranked.
  const {
    rows,
    hydrateMode,
    note: hydrateNote,
  } = await hydrateIds(org, project, ids, HYDRATE_FIELDS);
  let rankNote: string | null = hydrateNote;

  const items: WorkItem[] = rows.map((row) => mapRow(row, cfg));

  // Batched ListWorkItems hydration gives NO ordering guarantee (chunks resolve
  // concurrently), and the WIQL ORDER BY must stay [System.Id] ASC because the
  // keyset pagination in fetchAllWiqlIds depends on it. So backlog order is
  // applied HERE, client-side, once: StackRank ascending, unranked items last,
  // ties broken by id. Every list downstream re-applies the same comparator.
  items.sort(compareByStackRank);

  // How many items actually carried a rank. When this is 0 on a non-empty
  // board, the sort above was a no-op (everything tied, id tie-break decided
  // the order) — the UI surfaces that instead of implying backlog order.
  const ranked = items.reduce(
    (n, it) => (typeof it.stackRank === "number" ? n + 1 : n),
    0,
  );
  if (ranked === 0 && items.length > 0 && !rankNote) {
    rankNote =
      "Azure DevOps returned no StackRank values for these work items.";
  }

  return {
    items,
    idCount: ids.length,
    hydrated: items.length,
    capped,
    pages,
    durationMs: Date.now() - startedAt,
    fetchedAt: Date.now(),
    hydrateMode,
    ranked,
    rankNote,
  };
}

/* ==========================================================================
 * CHILD WORK ITEMS — the nested items shown under each story on "My Work".
 *
 * Why the REST passthrough and not the connector's "Get work item children"
 * operation: `GetWorkItemChildren(account, project, id, workItemType?)` takes
 * ONE parent id per call, so listing children for N stories costs N round
 * trips (and its single optional `workItemType` filter is awkward when the
 * children are a mix of Tasks and Bugs). The verified `workitemsbatch`
 * passthrough takes up to 200 ids per request and can return each item's
 * `relations`, so the whole tab costs (parents / 200) + (children / 200)
 * requests instead of one-per-story. Same endpoint, same chunk size and the
 * same `errorPolicy: "omit"` tolerance the board already hydrates with.
 *
 * Nothing here is invented: a child that Azure DevOps won't return is reported
 * as an unhydrated id rather than being filled in with a placeholder, and a
 * story with no Child relations is genuinely childless.
 * ======================================================================== */

/** ADO's parent -> child hierarchy link. (`-Reverse` is the parent link.) */
const CHILD_LINK_REL = "System.LinkTypes.Hierarchy-Forward";

/**
 * Fields hydrated for a child work item: what the child rows render (id,
 * title, state, assignee), the work item TYPE (Task / Bug / …) which the
 * board's own field list has no need for, and [System.CreatedDate], which the
 * nested list is now ORDERED by (newest first — see
 * compareChildrenNewestFirst in work-items-data.ts).
 *
 * The created date has to be asked for EXPLICITLY: this batch endpoint returns
 * only the fields named here, so before it was added every child came back
 * with a null `createdDate` and a date sort would have had nothing real to
 * order on — it would have silently degraded to the id tie-break while looking
 * like it worked. Exactly the StackRank bug described above, so it is spelled
 * out here too.
 */
export const CHILD_HYDRATE_FIELDS = [
  "System.Id",
  "System.Title",
  "System.State",
  "System.AreaPath",
  "System.AssignedTo",
  "System.WorkItemType",
  "System.CreatedDate",
  "System.CreatedBy",
  "System.Tags",
  ADO_TARGET_DATE_FIELD,
  "Microsoft.VSTS.Common.StackRank",
] as const;

export interface ChildWorkItem extends WorkItem {
  /** [System.WorkItemType] — "Task", "Bug", … null when ADO omitted it. */
  workItemType: string | null;
}

export interface FetchChildrenResult {
  /** Parent board id ("#123") -> its children, in StackRank order. */
  byParent: Record<string, ChildWorkItem[]>;
  /** Child ids seen on the parents' relations. */
  childIdCount: number;
  /** Child ids Azure DevOps actually returned work items for. */
  hydrated: number;
  /** Child ids that could NOT be hydrated — surfaced, never hidden. */
  missingIds: number[];
  fetchedAt: number;
  durationMs: number;
}

/** "vstfs:…/workItems/38731613" / ".../_apis/wit/workItems/123" -> 123. */
function relationChildId(url: unknown): number | null {
  if (typeof url !== "string") return null;
  const m = url.match(/(\d+)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Child ids for one <=200-parent chunk, via `workitemsbatch` + relations. */
async function childIdsForChunk(
  org: string,
  project: string,
  chunk: number[],
): Promise<Map<number, number[]>> {
  const res = await connectors().azureDevOps.httpRequest(org, {
    Method: "POST",
    Uri: `${encodeURIComponent(project)}/_apis/wit/workitemsbatch?api-version=7.0`,
    Headers: { "Content-Type": "application/json" },
    // `$expand` and an explicit `fields` list are mutually exclusive on this
    // endpoint, so this request asks ONLY for relations — the child rows are
    // hydrated with their own field list in the second pass below.
    Body: JSON.stringify({ ids: chunk, $expand: "relations", errorPolicy: "omit" }),
  });
  if (!res.success || !res.data) {
    throw toError(
      res.error,
      "Azure DevOps rejected the request for child work items.",
    );
  }
  const payload = res.data as {
    value?: Array<{
      id?: number;
      relations?: Array<{ rel?: unknown; url?: unknown }>;
    }>;
  };
  if (!Array.isArray(payload.value)) {
    throw new Error(
      "Azure DevOps returned an unexpected shape for the child work item request.",
    );
  }

  const byParent = new Map<number, number[]>();
  for (const row of payload.value) {
    if (typeof row.id !== "number") continue;
    const ids: number[] = [];
    for (const rel of row.relations ?? []) {
      if (rel?.rel !== CHILD_LINK_REL) continue;
      const childId = relationChildId(rel.url);
      if (childId !== null && !ids.includes(childId)) ids.push(childId);
    }
    byParent.set(row.id, ids);
  }
  return byParent;
}

/**
 * Every child work item of the given parents, hydrated in <=200-id batches.
 *
 * Two passes, both through the same verified REST passthrough the board uses:
 * parents -> their Child relations, then those child ids -> real work items.
 * Throws on a connector failure so the caller can show an error state; it never
 * fabricates a child, an assignee or a state.
 */
export async function fetchChildWorkItems(
  cfg: AdoConfig,
  parentBoardIds: string[],
): Promise<FetchChildrenResult> {
  const startedAt = Date.now();
  const org = cfg.organization.trim();
  const project = cfg.project.trim();
  if (!org || !project) {
    throw new Error(
      "Enter an Azure DevOps organization and project to load child work items.",
    );
  }

  // Board id ("#123") <-> numeric id, so results map back onto the caller's ids.
  const boardIdByNumeric = new Map<number, string>();
  const parentIds: number[] = [];
  for (const boardId of parentBoardIds) {
    const numeric = adoNumericId(boardId);
    if (numeric === null || boardIdByNumeric.has(numeric)) continue;
    boardIdByNumeric.set(numeric, boardId);
    parentIds.push(numeric);
  }

  const empty: FetchChildrenResult = {
    byParent: {},
    childIdCount: 0,
    hydrated: 0,
    missingIds: [],
    fetchedAt: Date.now(),
    durationMs: 0,
  };
  if (parentIds.length === 0) return empty;

  const parentChunks: number[][] = [];
  for (let i = 0; i < parentIds.length; i += HYDRATE_CHUNK) {
    parentChunks.push(parentIds.slice(i, i + HYDRATE_CHUNK));
  }
  const relationMaps = await mapWithConcurrency(parentChunks, 4, (chunk) =>
    childIdsForChunk(org, project, chunk),
  );

  const childIdsByParent = new Map<number, number[]>();
  const allChildIds: number[] = [];
  const seenChild = new Set<number>();
  for (const map of relationMaps) {
    for (const [parent, ids] of map) {
      childIdsByParent.set(parent, ids);
      for (const id of ids) {
        if (seenChild.has(id)) continue;
        seenChild.add(id);
        allChildIds.push(id);
      }
    }
  }

  if (allChildIds.length === 0) {
    return {
      ...empty,
      byParent: Object.fromEntries(parentBoardIds.map((id) => [id, []])),
      fetchedAt: Date.now(),
      durationMs: Date.now() - startedAt,
    };
  }

  const childChunks: number[][] = [];
  for (let i = 0; i < allChildIds.length; i += HYDRATE_CHUNK) {
    childChunks.push(allChildIds.slice(i, i + HYDRATE_CHUNK));
  }
  const childRows = (
    await mapWithConcurrency(childChunks, 4, (chunk) =>
      hydrateChunkViaRest(org, project, chunk, CHILD_HYDRATE_FIELDS),
    )
  ).flat();

  const childById = new Map<number, ChildWorkItem>();
  for (const row of childRows) {
    const mapped = mapRow(row, cfg);
    const numeric = adoNumericId(mapped.id);
    if (numeric === null) continue;
    const typeRaw =
      (row as Record<string, unknown>)["System.WorkItemType"] ??
      (row as Record<string, unknown>)["System_WorkItemType"];
    childById.set(numeric, {
      ...mapped,
      workItemType: typeof typeRaw === "string" && typeRaw.trim() ? typeRaw.trim() : null,
    });
  }

  const byParent: Record<string, ChildWorkItem[]> = {};
  for (const boardId of parentBoardIds) byParent[boardId] = [];
  for (const [parent, ids] of childIdsByParent) {
    const boardId = boardIdByNumeric.get(parent);
    if (!boardId) continue;
    byParent[boardId] = ids
      .map((id) => childById.get(id))
      .filter((c): c is ChildWorkItem => Boolean(c))
      .sort(compareByStackRank);
  }

  const missingIds = allChildIds.filter((id) => !childById.has(id));

  return {
    byParent,
    childIdCount: allChildIds.length,
    hydrated: childById.size,
    missingIds,
    fetchedAt: Date.now(),
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Load every descendant layer beneath the given roots.
 *
 * Each breadth-first pass uses the same batched child loader above. `visited`
 * prevents malformed hierarchy cycles from looping forever and also avoids
 * fetching a shared descendant more than once.
 */
export async function fetchDescendantWorkItems(
  cfg: AdoConfig,
  rootBoardIds: string[],
): Promise<FetchChildrenResult> {
  const startedAt = Date.now();
  const byParent: Record<string, ChildWorkItem[]> = {};
  const missingIds = new Set<number>();
  const hydratedIds = new Set<string>();
  const descendantIds = new Set<string>();
  const visited = new Set(rootBoardIds);
  let frontier = [...rootBoardIds];

  while (frontier.length > 0) {
    const level = await fetchChildWorkItems(cfg, frontier);
    for (const id of level.missingIds) missingIds.add(id);

    const next: string[] = [];
    for (const parentId of frontier) {
      const children = level.byParent[parentId] ?? [];
      byParent[parentId] = children;
      for (const child of children) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        descendantIds.add(child.id);
        hydratedIds.add(child.id);
        next.push(child.id);
      }
    }
    frontier = next;
  }

  return {
    byParent,
    childIdCount: descendantIds.size + missingIds.size,
    hydrated: hydratedIds.size,
    missingIds: [...missingIds],
    fetchedAt: Date.now(),
    durationMs: Date.now() - startedAt,
  };
}

/**
 * How MANY children each parent has, WITHOUT hydrating any of them.
 *
 * This is pass ONE of fetchChildWorkItems on its own: one `workitemsbatch`
 * relations request per <=200 parents, no second hydration pass. It exists so
 * the My Work tab can show a truthful child count on every collapsed item's
 * expand toggle while still fetching the child work items themselves only when
 * a row is actually expanded.
 *
 * The counts are ADO's own Child relations — nothing is estimated, and a parent
 * Azure DevOps returned no relations for is genuinely counted as 0.
 */
export async function fetchChildCounts(
  cfg: AdoConfig,
  parentBoardIds: string[],
): Promise<Record<string, number>> {
  const org = cfg.organization.trim();
  const project = cfg.project.trim();
  if (!org || !project) {
    throw new Error(
      "Enter an Azure DevOps organization and project to load child work items.",
    );
  }

  const boardIdByNumeric = new Map<number, string>();
  const parentIds: number[] = [];
  for (const boardId of parentBoardIds) {
    const numeric = adoNumericId(boardId);
    if (numeric === null || boardIdByNumeric.has(numeric)) continue;
    boardIdByNumeric.set(numeric, boardId);
    parentIds.push(numeric);
  }
  if (parentIds.length === 0) return {};

  const chunks: number[][] = [];
  for (let i = 0; i < parentIds.length; i += HYDRATE_CHUNK) {
    chunks.push(parentIds.slice(i, i + HYDRATE_CHUNK));
  }
  const maps = await mapWithConcurrency(chunks, 4, (chunk) =>
    childIdsForChunk(org, project, chunk),
  );

  const counts: Record<string, number> = {};
  for (const boardId of parentBoardIds) counts[boardId] = 0;
  for (const map of maps) {
    for (const [parent, ids] of map) {
      const boardId = boardIdByNumeric.get(parent);
      if (boardId) counts[boardId] = ids.length;
    }
  }
  return counts;
}

/* ==========================================================================
 * MY WORK — TOP-LEVEL BUGS ASSIGNED TO THE SIGNED-IN USER
 *
 * WHY A SEPARATE QUERY, not a widened board query: the board's WIQL is
 * `[System.WorkItemType] IN ('User Story','Epic','Feature')`, and relaxing it
 * to also include Bug would put bugs into the engineer sections, the
 * backlog columns, Triage, Bulk edit and the drag-and-drop rank list —
 * every one of which reads the SAME `items` array. My Work is the only view
 * that was asked to gain bugs, so the board query is left untouched and this
 * runs alongside it. The board therefore cannot change by construction: no
 * caller of fetchLiveWorkItems sees anything new.
 *
 * It is scoped like the board query in every other respect — the same recursive
 * `UNDER` area root, the same ascending-id keyset pagination through
 * drainKeysetIds, and the same <=200-id batched hydration — so a bug is paged
 * and hydrated by exactly the rules a story is.
 *
 * The ONE deliberate difference is the state filter: this query excludes
 * RESOLVED as well as Closed/Removed (see MY_BUG_EXCLUDED_STATES). A resolved
 * bug is fixed and awaiting verification rather than outstanding work, so it is
 * not listed here. That widening applies to these bugs only — stories and the
 * nested child rows keep the board's Closed/Removed rule untouched.
 *
 * Two extra clauses, both server-side:
 *   • `[System.AssignedTo] = @Me` — ADO's own macro for the identity making the
 *     call, so only the signed-in user's bugs are ever fetched (this is a
 *     targeted read, not the whole area tree filtered down client-side).
 *     The caller still re-checks ownership against the signed-in profile with
 *     the same matcher My Work uses for stories, so if the connector's identity
 *     were ever NOT the signed-in user the tab shows nothing rather than
 *     someone else's work.
 *   • WITHOUT A PARENT — determined from ADO's REAL relations (below), never
 *     inferred. A bug that is parented to a story already surfaces as a nested
 *     child under that story, so listing it at top level too would duplicate it.
 * ======================================================================== */

/* Parentage is read through PARENT_LINK_REL, already declared above for the
   nested-task create path — the same link, from the same constant. */

/**
 * States hidden from My Work's BUG list: the board's own Closed/Removed, plus
 * RESOLVED — a bug that has been resolved is fixed and waiting to be verified,
 * which is not outstanding work for the person it is assigned to, so it would
 * only pad the tab.
 *
 * Scope, deliberately narrow: this applies to the bugs THIS query fetches and
 * to nothing else. User stories still use EXCLUDED_STATES (a story in Resolved
 * is still on the board and still in My Work), the nested child rows under a
 * card are unfiltered as before (a resolved Task still shows, greyed and sunk
 * by compareChildrenNewestFirst), and the board query is not touched at all.
 *
 * Filtered in the WIQL rather than after the fetch, exactly like Closed and
 * Removed: a resolved bug is then never fetched, never has its parent link
 * looked up, never hydrated and never counted in `missingIds`.
 */
export const MY_BUG_EXCLUDED_STATES: readonly string[] = [
  ...EXCLUDED_STATES,
  "Resolved",
];
const EXCLUDE_MY_BUG_STATES_CLAUSE = `[System.State] NOT IN (${MY_BUG_EXCLUDED_STATES.map(
  (s) => `'${s}'`,
).join(",")})`;

/**
 * A Bug's user-facing text lives in [Microsoft.VSTS.TCM.ReproSteps] in the
 * Agile/Scrum processes — [System.Description] is frequently EMPTY on a bug.
 * Requested so a bug card can show its real text instead of claiming it has
 * none; see the guarded retry in fetchMyBugs for what happens if a process
 * doesn't define the field.
 */
const REPRO_STEPS_FIELD = "Microsoft.VSTS.TCM.ReproSteps";

/**
 * The board's field list plus the bug's repro steps. The base field list already
 * includes TYPE so every board card retains its Azure DevOps type. Kept
 * SEPARATE so the board's hydration is byte-for-byte unchanged.
 */
export const MY_BUG_HYDRATE_FIELDS = [
  ...HYDRATE_FIELDS,
  REPRO_STEPS_FIELD,
] as const;

/** One keyset page of the signed-in user's bugs, ordered by id ASC. */
function pagedMyBugWiql(areaRoot: string, afterId: number): string {
  const root = effectiveAreaRoot(areaRoot);
  return (
    "SELECT [System.Id] FROM WorkItems " +
    `WHERE [System.WorkItemType] = '${escapeWiql(MY_BUG_WORK_ITEM_TYPE)}' ` +
    `AND [System.AreaPath] UNDER '${escapeWiql(root)}' ` +
    `AND ${EXCLUDE_MY_BUG_STATES_CLAUSE} ` +
    "AND [System.AssignedTo] = @Me " +
    `AND [System.Id] > ${afterId} ` +
    "ORDER BY [System.Id] ASC"
  );
}

/**
 * Does each work item in one <=200-id chunk have a PARENT?
 *
 * The same cheap relations-only `workitemsbatch` call the child counts use
 * (childIdsForChunk), reading the opposite direction of the same hierarchy
 * link. Relations are not part of the field hydration — `$expand` and an
 * explicit `fields` list are mutually exclusive on this endpoint — so this is
 * the one request that can answer parentage, and it answers it for 200 bugs at
 * a time rather than one bug per call.
 *
 * Returns an entry ONLY for ids Azure DevOps actually returned a row for, so
 * the caller can tell "ADO says this has no parent" apart from "ADO didn't
 * answer for this one" instead of treating silence as parentless.
 */
async function parentedForChunk(
  org: string,
  project: string,
  chunk: number[],
): Promise<Map<number, boolean>> {
  const res = await connectors().azureDevOps.httpRequest(org, {
    Method: "POST",
    Uri: `${encodeURIComponent(project)}/_apis/wit/workitemsbatch?api-version=7.0`,
    Headers: { "Content-Type": "application/json" },
    Body: JSON.stringify({ ids: chunk, $expand: "relations", errorPolicy: "omit" }),
  });
  if (!res.success || !res.data) {
    throw toError(res.error, "Azure DevOps rejected the request for bug links.");
  }
  const payload = res.data as {
    value?: Array<{
      id?: number;
      relations?: Array<{ rel?: unknown; url?: unknown }>;
    }>;
  };
  if (!Array.isArray(payload.value)) {
    throw new Error(
      "Azure DevOps returned an unexpected shape for the bug link request.",
    );
  }

  const parented = new Map<number, boolean>();
  for (const row of payload.value) {
    if (typeof row.id !== "number") continue;
    const hasParent = (row.relations ?? []).some(
      (rel) => rel?.rel === PARENT_LINK_REL,
    );
    parented.set(row.id, hasParent);
  }
  return parented;
}

export interface MyBugsResult {
  /** Parentless bugs assigned to the caller, in the board's StackRank order. */
  items: ChildWorkItem[];
  /**
   * Bug ids Azure DevOps wouldn't answer for — in the relations pass or the
   * hydration pass. Surfaced, never silently dropped and never guessed at.
   */
  missingIds: number[];
  fetchedAt: number;
}

/**
 * Every PARENTLESS Bug assigned to the signed-in user, hydrated like a board
 * work item. Three passes, all batched:
 *
 *   1. keyset-paginated WIQL  -> every matching bug id (no 50-row cap);
 *   2. one relations call per <=200 ids -> which of them have a parent;
 *   3. hydration of the survivors -> real fields, in <=200-id batches.
 *
 * Nothing is fabricated: a bug ADO won't return is reported in `missingIds`
 * rather than filled in, and parentage comes only from ADO's own relations.
 */
export async function fetchMyBugs(cfg: AdoConfig): Promise<MyBugsResult> {
  const org = cfg.organization.trim();
  const project = cfg.project.trim();
  if (!org || !project) {
    throw new Error(
      "Enter an Azure DevOps organization and project to load your bugs.",
    );
  }

  const { ids } = await drainKeysetIds(org, project, (afterId) =>
    pagedMyBugWiql(cfg.areaRoot, afterId),
  );
  if (ids.length === 0) {
    return { items: [], missingIds: [], fetchedAt: Date.now() };
  }

  // --- pass 2: parentage, from real relations ------------------------------
  const linkChunks: number[][] = [];
  for (let i = 0; i < ids.length; i += HYDRATE_CHUNK) {
    linkChunks.push(ids.slice(i, i + HYDRATE_CHUNK));
  }
  const linkMaps = await mapWithConcurrency(linkChunks, 4, (chunk) =>
    parentedForChunk(org, project, chunk),
  );
  const answered = new Set<number>();
  const parentless: number[] = [];
  for (const map of linkMaps) {
    for (const [id, hasParent] of map) {
      answered.add(id);
      if (!hasParent) parentless.push(id);
    }
  }
  // Ids ADO returned no row for: parentage is UNKNOWN, so they are left out
  // (a parented bug shown at top level would duplicate its nested row) and
  // reported instead of being assumed one way or the other.
  const missingIds = ids.filter((id) => !answered.has(id));
  if (parentless.length === 0) {
    return { items: [], missingIds, fetchedAt: Date.now() };
  }

  // --- pass 3: hydrate the survivors ---------------------------------------
  let { rows, hydrateMode } = await hydrateIds(
    org,
    project,
    parentless,
    MY_BUG_HYDRATE_FIELDS,
  );
  if (hydrateMode === "list-fallback") {
    // The field-selecting REST path was refused. The likeliest cause is a
    // process that doesn't define Repro Steps (ADO rejects the whole request
    // for one unknown field), and the fallback path returns no StackRank — so
    // retry ONCE with the board's own proven field list rather than leaving
    // every bug unranked. If that fails too, keep what we already have.
    try {
      const retry = await hydrateIds(org, project, parentless, HYDRATE_FIELDS);
      if (retry.hydrateMode === "batch-rest") {
        rows = retry.rows;
        hydrateMode = retry.hydrateMode;
      }
    } catch {
      // Keep the fallback rows — they are real work items, just unranked.
    }
  }

  const items: ChildWorkItem[] = rows.map((row) => {
    const base = mapRow(row, cfg);
    const r = row as unknown as Record<string, unknown>;
    const get = (key: string): unknown => r[key] ?? r[key.replace(/\./g, "_")];
    const rawReproSteps =
      typeof get(REPRO_STEPS_FIELD) === "string"
        ? (get(REPRO_STEPS_FIELD) as string)
        : "";
    const useReproSteps = !base.description && Boolean(toText(rawReproSteps));
    return {
      ...base,
      // ADO's own type string; the query already constrained it to Bug, so the
      // constant is only a label for a row that omitted the field.
      workItemType: toText(get("System.WorkItemType")) || MY_BUG_WORK_ITEM_TYPE,
      // Bugs usually carry their text in Repro Steps, not Description. Only
      // used when Description is genuinely empty — never overwriting real text,
      // and still the same tag-stripped plain text every other view renders.
      description: useReproSteps ? toText(rawReproSteps) : base.description,
      descriptionHtml:
        useReproSteps && /<[a-z][\s\S]*>/i.test(rawReproSteps)
          ? rawReproSteps
          : base.descriptionHtml,
    };
  });
  items.sort(compareByStackRank);

  const hydratedIds = new Set(
    items.map((it) => adoNumericId(it.id)).filter((n): n is number => n !== null),
  );
  for (const id of parentless) {
    if (!hydratedIds.has(id)) missingIds.push(id);
  }

  return { items, missingIds, fetchedAt: Date.now() };
}

/* ==========================================================================
 * WORK ITEM TYPE STATES
 *
 * The board's five-state list (STORY_STATES) is the User Story workflow. A
 * NESTED work item is often a Task or a Bug, whose process may define entirely
 * different state names ("Done", "Resolved", …) — writing a User Story state to
 * one of those is exactly the kind of write Azure DevOps rejects.
 *
 * So the right-click "Change state" menu on a nested item asks ADO what the
 * item's OWN type actually allows, through the documented per-type states
 * endpoint. Nothing is assumed or hard-coded: if the call fails, or the type is
 * unknown, the caller disables the entry and says why rather than offering
 * states that might not exist.
 * ======================================================================== */

export interface WorkItemTypeState {
  name: string;
  /**
   * ADO's state CATEGORY — "Proposed" | "InProgress" | "Resolved" |
   * "Completed" | "Removed". This is how "Mark as complete" stays honest for a
   * type whose completed state isn't called "Closed": it writes the type's own
   * first `Completed` state instead of guessing a name.
   */
  category: string;
}

export async function fetchWorkItemTypeStates(
  cfg: AdoConfig,
  workItemType: string,
): Promise<WorkItemTypeState[]> {
  const org = cfg.organization.trim();
  const project = cfg.project.trim();
  const type = workItemType.trim();
  if (!org || !project || !type) {
    throw new Error(
      "An Azure DevOps organization, project and work item type are needed to read the states.",
    );
  }

  const res = await connectors().azureDevOps.httpRequest(org, {
    Method: "GET",
    Uri: `${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(
      type,
    )}/states?api-version=7.0`,
  });
  if (!res.success || !res.data) {
    throw toError(
      res.error,
      `Azure DevOps wouldn't return the states for work item type "${type}".`,
    );
  }
  const payload = res.data as {
    value?: Array<{ name?: unknown; category?: unknown }>;
  };
  if (!Array.isArray(payload.value)) {
    throw new Error(
      `Azure DevOps returned an unexpected shape for the "${type}" state list.`,
    );
  }
  return payload.value
    .map((row) => ({
      name: typeof row.name === "string" ? row.name.trim() : "",
      category: typeof row.category === "string" ? row.category.trim() : "",
    }))
    .filter((s) => s.name.length > 0);
}
