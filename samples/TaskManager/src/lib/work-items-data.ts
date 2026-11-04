import { appConfig } from "@/config";

// Board metadata: the team roster, ownership-area (category) styling, and the
// tolerant state badge lookups. Work items come only from live Azure
// DevOps (see lib/ado.ts) — there is no sample/seed data.

export interface AreaMeta {
  code: string; // sub-area name; used on cards + as backlog id
  name: string; // display label
  // What belongs in this category — shown next to the option in the Triage
  // pickers (new work item + uncategorized reroute) so the choice is obvious.
  description?: string;
  dot: string; // avatar/marker background
  swatch: string; // small square accent
  border: string; // left border accent on cards
  headerBg: string; // backlog column header background
  headerText: string; // backlog column header text
  ring: string; // drop-target highlight ring
  tag: string; // area chip on a card
}

// The state values offered by the work-item detail editor. A live item whose
// ADO state falls outside this list is still shown (the editor prepends the
// real value) — the list is the offered set, never a coercion.
export type StoryState =
  | "New"
  | "Committed"
  | "Active"
  | "Closed"
  | "Removed";

export interface WorkItem {
  id: string; // "#12345" (Azure DevOps id)
  /** Azure DevOps [System.WorkItemType], when live hydration returned it. */
  workItemType?: string | null;
  title: string;
  area: string; // AreaMeta.code
  areaPath?: string; // full ADO area path
  assignee: string | null; // engineer name, or null when in the backlog
  // Identity (email / UPN) from the ADO "Assigned To" field, when the connector
  // supplies one. Used only to look up an Office 365 profile photo; null when
  // unknown (the avatar then stays on initials).
  assigneeEmail?: string | null;
  /** Raw ADO HTML for rich rendering/editing; omitted when the source was plain text. */
  descriptionHtml?: string;
  description: string;
  // Any Azure DevOps state.
  state: string;
  // Raw [System.CreatedDate] from ADO (ISO string) when the connector supplies
  // one — used only by the Triage "recently created" list. Never synthesized:
  // an item with no created date simply doesn't appear in that list.
  createdDate?: string | null;
  // Display name from [System.CreatedBy], and its identity (email/UPN) when the
  // connector returns one. Both null when ADO didn't provide them.
  createdBy?: string | null;
  createdByEmail?: string | null;
  // Tags from [System.Tags], which ADO returns as a single semicolon-separated
  // string ("infra; spike"). Split into individual tags at hydration time.
  // Empty array when the item has none / the connector omitted the field —
  // never synthesized.
  tags?: string[];
  // Raw [Microsoft.VSTS.Common.ClosedDate] from ADO (ISO string) when the
  // connector returns it — the real date the work item was completed. Only the
  // Completed tab requests this field, and it is null whenever ADO didn't
  // supply one (Removed items often have no closed date): never synthesized.
  closedDate?: string | null;
  // Raw [System.ChangedDate] from ADO (ISO string) — the last time the work
  // item changed. Used as the completion-date FALLBACK on the Completed tab
  // when [Microsoft.VSTS.Common.ClosedDate] isn't retrievable for an item.
  changedDate?: string | null;
  /** Date-only value from [Microsoft.VSTS.Scheduling.TargetDate], when set. */
  targetDate?: string | null;
  // Raw [Microsoft.VSTS.Common.StackRank] from ADO — the backlog priority order
  // shown in the Azure DevOps backlog. null when the connector doesn't return
  // the field for an item; never synthesized (such items simply sort last).
  stackRank?: number | null;
}

// Backlog order: StackRank ascending (the same order Azure DevOps shows in the
// backlog), items WITHOUT a StackRank last, then a numeric-id tie-break so the
// ordering is total, stable and deterministic across refreshes.
export function compareByStackRank(a: WorkItem, b: WorkItem): number {
  const ra = typeof a.stackRank === "number" ? a.stackRank : null;
  const rb = typeof b.stackRank === "number" ? b.stackRank : null;
  if (ra !== rb) {
    if (ra === null) return 1; // missing rank sinks to the bottom
    if (rb === null) return -1;
    return ra - rb;
  }
  return numericId(a.id) - numericId(b.id);
}

// "#12345" -> 12345; anything unparseable sorts after real ids.
function numericId(boardId: string): number {
  const n = Number(String(boardId).replace(/^#/, "").trim());
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * The work item states that mean "this one is FINISHED".
 *
 * Azure DevOps groups states into CATEGORIES ("Proposed" | "InProgress" |
 * "Resolved" | "Completed" | "Removed") and a category check would be the exact
 * answer — but a category is only obtainable from a per-work-item-TYPE call
 * (fetchWorkItemTypeStates in lib/ado.ts), and a nested list can mix Tasks,
 * Bugs and anything else. Ordering a list would then have to fetch a state list
 * for every type present before it could order anything, which is a pile of
 * extra requests to answer a question about rows already on screen — and worse,
 * it would make the ORDER depend on whether those calls had come back yet, so
 * the same list would sort differently from one moment to the next.
 *
 * So this matches the state NAME instead, case-insensitively and whitespace
 * trimmed. It covers Closed, Removed and Resolved
 * plus the equivalents the other ADO process templates use for the same idea
 * ("Done" in Scrum/Basic, "Completed") — all of which already appear in
 * STATE_META below, so this recognises nothing the app didn't already know
 * about. An unrecognised state is deliberately NOT treated as finished: it
 * keeps its place in the date order rather than being guessed at.
 */
const FINISHED_STATES = new Set([
  "closed",
  "removed",
  "resolved",
  "done",
  "completed",
]);

export function isFinishedState(state: string | null | undefined): boolean {
  return FINISHED_STATES.has(String(state ?? "").trim().toLowerCase());
}

// [System.CreatedDate] as a sortable number, or null when the item carries no
// parseable one. Never substituted with "now" or with the id — a missing date
// stays missing and is ordered explicitly below.
export function createdTime(item: WorkItem): number | null {
  if (!item.createdDate) return null;
  const t = Date.parse(item.createdDate);
  return Number.isFinite(t) ? t : null;
}

/* --------------------------------------------------------------------------
 * CREATED-DATE FORMATTING — one implementation, shared.
 *
 * These two were written for the Triage "recently created" list and now serve
 * My Work as well. They live here rather than in either panel so both views
 * render a created date the SAME way: an app that formats the same field three
 * different ways in three places reads as three different apps.
 * ------------------------------------------------------------------------ */

/** Absolute created date: "12 Aug 2026, 09:41" (locale-ordered). */
export function formatCreatedTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The same date one or more years later.
 *
 * Rebuilt from the ORIGINAL date every time rather than by mutating one Date
 * twice: setFullYear on 29 Feb rolls forward to 1 Mar in a non-leap year, and
 * stepping that already-rolled value back again would land a day off the real
 * created date. A 29 Feb item therefore has its anniversary on 1 Mar in
 * non-leap years, which is when a full calendar year has actually passed.
 */
function anniversaryOf(created: Date, yearsLater: number): Date {
  const d = new Date(created.getTime());
  d.setFullYear(created.getFullYear() + yearsLater);
  return d;
}

/**
 * Whole calendar years between a created date and `now`, or NULL when the date
 * is unparseable.
 *
 * Counted by ANNIVERSARY, not by dividing by 365: three years means the same
 * date three years earlier, whatever leap days fell in between. Exported
 * because more than one thing keys off an item's age (the relative stamp
 * below, and the cobweb in isAncientWorkItem) and they must never disagree —
 * a card reading "3 years ago" with no cobweb, or the reverse, would just look
 * broken. One implementation, one answer.
 *
 * `now` is injectable so the behaviour can be tested at fixed dates instead of
 * only at whatever today happens to be.
 */
export function wholeYearsSince(iso: string, now: Date = new Date()): number | null {
  const then = new Date(iso);
  if (!Number.isFinite(then.getTime())) return null;
  let years = now.getFullYear() - then.getFullYear();
  // The year subtraction overshoots by at most one — when this year's
  // anniversary is still ahead of us — so one step back is always enough.
  if (years > 0 && anniversaryOf(then, years).getTime() > now.getTime()) {
    years -= 1;
  }
  // A future-dated item is 0 years old, never negative.
  return years < 0 ? 0 : years;
}

/**
 * Coarse age: "just now" / "5h ago" / "3 days ago", and past a year
 * "1 year ago" / "1 year 42 days ago" / "2 years 7 days ago".
 *
 * Years are counted by ANNIVERSARY, not by dividing by 365, so "1 year 0 days"
 * means the same date last year whatever leap days fell in between. The
 * remainder is then the same floor-of-elapsed-24-hour-periods rule the
 * sub-year path already used, so "1 year 3 days" and the "368 days" this used
 * to print describe the same instant. Below a year the output is unchanged.
 *
 * Kept compact deliberately — these sit inline among the chips in dense rows,
 * and the exact timestamp stays one hover away (formatCreatedTimestamp).
 */
export function relativeAge(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const ms = now.getTime() - then.getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);

  // Whole calendar years elapsed. An unparseable date yields null here and
  // falls through to the days path below exactly as it did before — the
  // callers are what decide how a missing date is shown.
  const years = wholeYearsSince(iso, now);
  if (years === null || years < 1) {
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }

  const sinceAnniversary = now.getTime() - anniversaryOf(then, years).getTime();
  const rest = Math.max(0, Math.floor(sinceAnniversary / 86_400_000));
  const yearPart = `${years} year${years === 1 ? "" : "s"}`;
  // On the anniversary itself the day count is dropped rather than printed as
  // a bare "0 days".
  if (rest < 1) return `${yearPart} ago`;
  return `${yearPart} ${rest} day${rest === 1 ? "" : "s"} ago`;
}

/**
 * Both renderings of an item's created date, or NULL when Azure DevOps gave no
 * parseable one.
 *
 * Null is the honest answer and the caller must handle it: hydration can come
 * back through the list-fallback path, which returns a reduced field set, so
 * `createdDate` genuinely can be absent. Nothing here substitutes "now", the
 * fetch time, or a date derived from the id — a missing date stays missing.
 */
export function createdLabels(
  item: WorkItem,
): { relative: string; absolute: string } | null {
  const t = createdTime(item);
  if (t === null || !item.createdDate) return null;
  return {
    relative: relativeAge(item.createdDate),
    absolute: formatCreatedTimestamp(item.createdDate),
  };
}

/** How old a work item has to be before the cobwebs move in. */
export const ANCIENT_YEARS = 3;

/**
 * Has this work item been open long enough to gather cobwebs?
 *
 * Reads the SAME [System.CreatedDate] the created-on stamp reads (via
 * createdTime) and the SAME calendar-year maths the stamp's wording uses (via
 * wholeYearsSince), so the two can never contradict each other: the cobweb
 * appears exactly when the stamp starts saying "3 years …" and not a day
 * before.
 *
 * The threshold is "has completed its 3rd year" rather than "strictly more
 * than 3 years", so the graphic and the label change on the same refresh.
 *
 * NO DATE MEANS NO COBWEB. An item Azure DevOps returned no parseable created
 * date for is of UNKNOWN age, and unknown is not ancient — it keeps the plain
 * "—" stamp and gets no graphic. Guessing an age from the id or the fetch time
 * to decorate it would be inventing data.
 */
export function isAncientWorkItem(item: WorkItem): boolean {
  if (createdTime(item) === null || !item.createdDate) return false;
  const years = wholeYearsSince(item.createdDate);
  return years !== null && years >= ANCIENT_YEARS;
}

// Newest-first id tie-break. ADO ids increase over time, so a higher id IS the
// later item — the right direction for this sort. Unparseable ids stay last
// rather than being flipped to the front by the descending compare.
function compareIdNewestFirst(a: string, b: string): number {
  const ia = numericId(a);
  const ib = numericId(b);
  if (ia === ib) return 0;
  if (ia === Number.MAX_SAFE_INTEGER) return 1;
  if (ib === Number.MAX_SAFE_INTEGER) return -1;
  return ib - ia;
}

/**
 * Nested-item order: NEWEST FIRST, with finished work pushed to the bottom.
 *
 * Three rules, in order:
 *   1. Finished items (isFinishedState) always sort below unfinished ones,
 *      whatever their dates say.
 *   2. Within each of those two groups, newest [System.CreatedDate] first.
 *   3. An item with NO usable created date sinks to the bottom of its own
 *      group (it is not pretended to be new), and ties break on the id, so the
 *      result is total, stable and identical across refreshes rather than
 *      depending on the order Azure DevOps happened to return rows in.
 *
 * Deliberately separate from compareByStackRank, which still orders every
 * board list — this one is only for the nested lists under My Work.
 */
export function compareChildrenNewestFirst(a: WorkItem, b: WorkItem): number {
  const fa = isFinishedState(a.state);
  const fb = isFinishedState(b.state);
  if (fa !== fb) return fa ? 1 : -1;

  const ta = createdTime(a);
  const tb = createdTime(b);
  if (ta !== tb) {
    if (ta === null) return 1; // no date -> bottom of its group
    if (tb === null) return -1;
    return tb - ta; // newest first
  }
  return compareIdNewestFirst(a.id, b.id);
}

/**
 * NEWEST FIRST by [System.CreatedDate], for a TOP-LEVEL list.
 *
 * Deliberately NOT compareChildrenNewestFirst: that one also sinks finished
 * work to the bottom, which is right for a nested list (a card's done Tasks
 * belong out of the way) but wrong here. My Work still lists a story in
 * Resolved, and under this ordering there is exactly one rule —
 * creation time — so a resolved story sorts by its date like everything else
 * rather than being quietly demoted by a rule they didn't ask for.
 *
 * The two rules it DOES share with the nested sort, so the app orders dates
 * consistently wherever it sorts by them:
 *   • an item with no parseable created date goes LAST rather than being
 *     treated as epoch-0 (which would fling it to one end) — and it stays
 *     there deterministically;
 *   • ties break on id, newest first, so the order is total and stable across
 *     refreshes instead of depending on the order Azure DevOps returned rows.
 */
export function compareByCreatedNewestFirst(a: WorkItem, b: WorkItem): number {
  const ta = createdTime(a);
  const tb = createdTime(b);
  if (ta !== tb) {
    if (ta === null) return 1; // no date -> bottom
    if (tb === null) return -1;
    return tb - ta; // newest first
  }
  return compareIdNewestFirst(a.id, b.id);
}

/** A new array of the given work items, newest created first. */
export function sortByCreatedNewestFirst(items: WorkItem[]): WorkItem[] {
  return [...items].sort(compareByCreatedNewestFirst);
}

/**
 * Does this work item carry EXACTLY this tag?
 *
 * One matching rule for every tag-driven marker: whole-tag, case-insensitive,
 * whitespace-trimmed on BOTH sides of the comparison — never a substring. Tags
 * arrive already split on ";" and trimmed (see toTags in lib/ado.ts), so a tag
 * containing SPACES ("Needs Review") compares correctly: only the
 * semicolon separates tags in [System.Tags], never a space.
 */
export function hasExactTag(
  item: Pick<WorkItem, "tags">,
  tag: string,
): boolean {
  const target = tag.trim().toLowerCase();
  if (!target) return false;
  return (item.tags ?? []).some((t) => t.trim().toLowerCase() === target);
}

/** A new array of the given work items in backlog (StackRank) order. */
export function sortByStackRank(items: WorkItem[]): WorkItem[] {
  return [...items].sort(compareByStackRank);
}

export const STORY_STATES: StoryState[] = [
  "New",
  "Committed",
  "Active",
  "Closed",
  "Removed",
];

/**
 * What each state MEANS to this team — the single source of truth, shared by
 * every surface that lets someone pick a state (the work-item detail dialog's
 * State selector and the board's right-click "Change state" submenu), so the
 * wording can never drift between them.
 *
 * Keyed by the exact ADO state name. A live state outside this list (ADO
 * processes can define others) simply has no description — the picker still
 * shows the raw state, it just carries no blurb. Nothing is invented for it.
 */
export const STATE_DESCRIPTIONS: Record<string, string> = {
  New: "Not yet started",
  Committed: "In your personal backlog",
  Active: "Actively being worked on",
  Closed: "Work is fully complete (including testing and code cleanup)",
  Removed: "We no longer want to do this item",
};

/** The team's description for a state, or null when there isn't one. */
export function stateDescription(state: string): string | null {
  return STATE_DESCRIPTIONS[state] ?? null;
}

/* ===========================================================================
 * STATE COLOURS — measured against this app's real surfaces, not picked by
 * name. Written as explicit hex rather than palette steps so every value here
 * is the value that actually ships and can be re-measured.
 *
 * Grouped by MEANING, so a state's colour says the same thing wherever it is
 * rendered (card badges, nested rows, the Completed tab, the Triage lists, the
 * Bulk edit preview, the context menu's "Change state" flyout and the detail
 * dialog's state picker all read this one map):
 *
 *   GREEN   finished        Closed · Resolved · Done
 *   GREY    removed         Removed
 *   YELLOW  in flight       Active · In Progress
 *   ORANGE  committed       Committed
 *   PINK    not started     New
 *   BLUE    approved        Approved   (no equivalent in the requested six)
 *   VIOLET  unrecognised    the fallback below
 *
 * WHAT WAS MEASURED. Two different questions, each with the right metric:
 *
 *  1. Is the LABEL legible on its badge? WCAG contrast (a luminance ratio).
 *     Every pair below is >= 4.5:1, most are far higher:
 *       green  6.49  ·  yellow 8.10  ·  orange 5.84  ·  grey 5.81
 *       pink   5.97  ·  blue   7.32  ·  violet 8.26
 *
 *  2. Does the BADGE separate from the 95 grey it sits on? Contrast ratio is
 *     the wrong tool here — it only knows luminance, so it calls a strong
 *     yellow and a light grey "the same" when they are obviously different
 *     colours. This uses CIEDE2000 instead, against all three surfaces the
 *     badges appear on — #c0c0c0 card face, #e4e1dc zebra band, #cfccc7 nested
 *     row. Worst case per family (>= 10 is a clearly different colour):
 *       green 17.7 · yellow 21.0 · orange 15.3 · pink 18.2 · blue 13.0
 *       grey  13.3
 *
 *     YELLOW was the one flagged as risky and it is in fact the STRONGEST of
 *     the set (21.0-23.9): the risk is real for a pale yellow, which is why
 *     this one is a deeper #f0dd82 rather than a wash, and its label is a very
 *     dark brown-black that clears AAA at 8.10:1.
 *
 *  3. Is the DOT visible? Dots appear inside a badge, on the #c0c0c0 menu face,
 *     AND on the #000080 highlighted menu row. Those last two cannot both be
 *     satisfied: 3:1 against #c0c0c0 needs luminance <= 0.1424 and 3:1 against
 *     #000080 needs >= 0.1468, so the window is EMPTY — the best any colour can
 *     do on both at once is ~2.97:1. Rather than settle for mediocre
 *     everywhere, the dots are tuned to ~4:1 against the grey face (and ~5:1
 *     inside their own badge), and the navy case is handled where it actually
 *     occurs: win95.css gives the dot a white ring on a highlighted row, the
 *     same trick the app already uses to keep option descriptions readable
 *     there. See `.w95-state-dot`.
 * ======================================================================== */

/** Finished work — Closed, Resolved, and Scrum/Basic's "Done". */
const STATE_GREEN = { badge: "bg-[#bfe3bf] text-[#14532d]", dot: "bg-[#166420]" };

/**
 * REMOVED — grey, as asked, but a grey chosen so it does not disappear.
 *
 * A nominal light grey is exactly what fails here: the previous pass measured
 * one at dE2000 2.1-5.9 against this app's own surfaces and it vanished into
 * them, which is why the unknown-state fallback is violet rather than grey. So
 * this is a deliberately DARKER, COOLER slate — it separates from all three
 * greys on lightness AND on hue (they are neutral-to-warm, this is blue-cool),
 * measuring 13.3 / 21.6 / 17.3 against #c0c0c0 / #e4e1dc / #cfccc7. Its worst
 * case is comparable to the coloured families, and it is 20.0 from the violet
 * fallback, so "Removed" can't be mistaken for "state I don't recognise".
 *
 * The label is near-black at 5.81:1 on the badge, which also keeps Removed
 * legible on a greyed-out finished nested row: that row de-emphasises its own
 * text, but the badge carries its own colours and so keeps full strength.
 *
 * The dot is darker than the other families' (5.31:1 on the menu face rather
 * than ~4:1) because it has to clear 3:1 against THIS badge too, and this badge
 * is darker than the light tints the others use — at 3.27:1 it does. On the
 * navy highlighted row it takes the same white ring as every other state dot.
 */
const STATE_GREY = { badge: "bg-[#8f97a1] text-[#171c21]", dot: "bg-[#394652]" };
/** In flight — Active, and its "In Progress" equivalent on other templates. */
const STATE_YELLOW = { badge: "bg-[#f0dd82] text-[#4a3a00]", dot: "bg-[#6e5200]" };
const STATE_ORANGE = { badge: "bg-[#f6cfa5] text-[#7c3a00]", dot: "bg-[#903e00]" };
const STATE_PINK = { badge: "bg-[#f6c9de] text-[#8b1d54]", dot: "bg-[#a1205c]" };
const STATE_BLUE = { badge: "bg-[#c9d8f5] text-[#1c3d7a]", dot: "bg-[#1f4a99]" };

/**
 * Anything Azure DevOps returns that isn't named below.
 *
 * Deliberately NOT a grey: three of this app's surfaces are already grey, and
 * a grey badge on them measured dE2000 2.1-5.9 — it disappeared. This is a
 * desaturated violet, far enough from all three (11.0-11.8) to be seen while
 * still reading as "no particular meaning", and it claims none of the six
 * colours above so an unknown state can never be mistaken for a known one.
 */
const STATE_UNKNOWN = { badge: "bg-[#ddd8ea] text-[#3d3457]", dot: "bg-[#6242ad]" };

export const STATE_META: Record<string, { badge: string; dot: string }> = {
  New: STATE_PINK,
  Active: STATE_YELLOW,
  Resolved: STATE_GREEN,
  Closed: STATE_GREEN,
  // Common additional ADO states (Agile / Scrum / Basic process templates).
  // These weren't in the request; they're mapped to the family that MEANS the
  // same thing, so a Task's "Done" matches a Story's "Closed" and a Task's
  // "In Progress" matches a Story's "Active" instead of being the one odd
  // colour left over. Approved has no equivalent among the six and keeps a
  // hue of its own.
  Committed: STATE_ORANGE,
  Approved: STATE_BLUE,
  "In Progress": STATE_YELLOW,
  Done: STATE_GREEN,
  // Removed is still a FINISHED state everywhere else in the app (it sorts to
  // the bottom of a nested list with Closed and Resolved — see
  // isFinishedState). Only its colour is separate: it means "taken out", not
  // "completed", and it now says so.
  Removed: STATE_GREY,
};

// Tolerant lookup — live ADO states may fall outside the set above (any work
// item type can define its own), so an unknown value renders the neutral badge
// with its raw label instead of crashing or going unstyled.
export function stateMeta(s: string): { badge: string; dot: string } {
  return STATE_META[s] ?? STATE_UNKNOWN;
}

// Optional team roster (VITE_TEAM_MEMBERS). Roster order IS the board order for
// the Engineers region (buildEngineerSections seeds each name's position from
// this list); assignees returned by Azure DevOps who aren't on it sort after it.
export const ENGINEERS: string[] = appConfig.team.members;

type AreaStyle = Omit<AreaMeta, "code" | "name" | "description">;

// Colour styles assigned, in order, to the configured backlog categories.
const AREA_PALETTE: AreaStyle[] = [
  {
    dot: "bg-blue-500",
    swatch: "bg-blue-500",
    border: "border-l-blue-500",
    headerBg: "bg-blue-50",
    headerText: "text-blue-700",
    ring: "ring-blue-400",
    tag: "bg-blue-100 text-blue-700",
  },
  {
    dot: "bg-[#9B4A9B]",
    swatch: "bg-[#9B4A9B]",
    border: "border-l-[#9B4A9B]",
    headerBg: "bg-[#9B4A9B]/10",
    headerText: "text-[#9B4A9B]",
    ring: "ring-[#9B4A9B]",
    tag: "bg-[#E7D8F2] text-[#5A2A6E]",
  },
  {
    dot: "bg-[#00695C]",
    swatch: "bg-[#00695C]",
    border: "border-l-[#00695C]",
    headerBg: "bg-[#D9F5EF]",
    headerText: "text-[#00574C]",
    ring: "ring-[#00897B]",
    tag: "bg-[#CDFFF4] text-[#00453D]",
  },
  {
    dot: "bg-orange-700",
    swatch: "bg-orange-700",
    border: "border-l-orange-700",
    headerBg: "bg-orange-50",
    headerText: "text-orange-800",
    ring: "ring-orange-500",
    tag: "bg-orange-100 text-orange-800",
  },
  {
    dot: "bg-rose-600",
    swatch: "bg-rose-600",
    border: "border-l-rose-600",
    headerBg: "bg-rose-50",
    headerText: "text-rose-800",
    ring: "ring-rose-400",
    tag: "bg-rose-100 text-rose-800",
  },
  {
    dot: "bg-lime-700",
    swatch: "bg-lime-700",
    border: "border-l-lime-700",
    headerBg: "bg-lime-50",
    headerText: "text-lime-800",
    ring: "ring-lime-500",
    tag: "bg-lime-100 text-lime-800",
  },
];

/**
 * Backlog categories: the immediate sub-areas of the configured area path that
 * get their own coloured column (VITE_ADO_AREAS, e.g. "Frontend,Backend").
 * Any other sub-area still shows up as a neutral column, so nothing is hidden.
 */
export function buildAreas(names: readonly string[]): AreaMeta[] {
  return names.map((name, index) => ({
    code: name,
    name,
    ...AREA_PALETTE[index % AREA_PALETTE.length],
  }));
}

export const AREAS: AreaMeta[] = buildAreas(appConfig.ado.areas);
export const AREA_BY_CODE: Record<string, AreaMeta> = Object.fromEntries(
  AREAS.map((a) => [a.code, a]),
);

// Category code used for items whose area path can't be matched to a sub-area
// (e.g. a story sitting directly on the configured area root).
export const OTHER_AREA_CODE = "Other";

// Neutral styling for any category that isn't one of the configured ownership
// areas — another immediate sub-area of the area root, or the uncategorized bucket.
const NEUTRAL_AREA: AreaStyle = {
  dot: "bg-slate-400",
  swatch: "bg-slate-400",
  border: "border-l-slate-400",
  headerBg: "bg-slate-100",
  headerText: "text-slate-600",
  ring: "ring-slate-300",
  tag: "bg-slate-200 text-slate-600",
};

// Resolve display metadata for a category code. Known ownership areas use their
// branded colors; every other code renders with a neutral style so no fetched
// story is ever dropped or mis-bucketed off the board.
export function areaMeta(code: string): AreaMeta {
  const known = AREA_BY_CODE[code];
  if (known) return known;
  return {
    code,
    name: code === OTHER_AREA_CODE ? "Other / Uncategorized" : code,
    ...NEUTRAL_AREA,
  };
}

// Deterministic avatar color per engineer (Tailwind class strings kept literal).
const AVATAR_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-sky-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-pink-500",
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
