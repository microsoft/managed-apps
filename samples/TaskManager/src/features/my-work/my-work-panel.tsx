// MY WORK tab — every live work item assigned to the SIGNED-IN user, with the
// item's description and the nested (child) work items underneath it.
//
// Identity: matched on the addresses the app already knows about — the signed-in
// profile's `mail` AND `userPrincipalName` (Office 365 Users -> "Get my profile
// (V2)", via useCurrentUser) compared case-insensitively against the work item's
// [System.AssignedTo] identity, using the SAME normalizeIdentityEmail helper the
// engineer sections key on. Deliberately never matched on display name alone —
// two people can share a name — and no second identity mechanism is introduced.
//
// Descriptions: [System.Description] is HTML in Azure DevOps. It is untrusted
// connector content, so it is NOT injected as markup anywhere: the hydration
// step (toText in lib/ado.ts) already strips every tag and decodes the basic
// entities, and what is rendered here is that PLAIN TEXT through ordinary JSX
// (React escapes it). Formatting is therefore lost by design — the tab says so —
// and there is no dangerouslySetInnerHTML on this path.
//
// Children: fetched LAZILY (this component only mounts when the tab is opened)
// and in BATCHES through the same <=200-id REST passthrough the board hydrates
// with — see fetchChildWorkItems in lib/ado.ts, which also records why the
// batch endpoint was chosen over the connector's per-item "Get work item
// children" operation. Nothing is fabricated: a child Azure DevOps wouldn't
// return is reported as a gap, and an item with no Child relations says plainly
// that it has none.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  FilePlus2,
  Inbox,
  ListPlus,
  ListTree,
  Loader2,
  RefreshCw,
  UserX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState } from "@/components/states";
import { PersonAvatar } from "@/components/person-avatar";
import { CobwebIndicator } from "@/components/cobweb-indicator";
import { TagChips } from "@/components/tag-chips";
import { useTagVisualFrameClasses } from "@/lib/tag-visuals";
import {
  AddTaskDialog,
  type AssigneeOption,
} from "@/components/add-task-dialog";
import { CreateMyWorkItemDialog } from "@/components/create-my-work-item-dialog";
import { useIsMenuTarget } from "@/hooks/use-menu-target";
import { usePersonPhotos } from "@/lib/people-photos";
import {
  buildEngineerSections,
  normalizeIdentityEmail,
} from "@/lib/engineer-identity";
import {
  adoWriteIdentity,
  useCurrentUser,
  type CurrentUser,
} from "@/lib/current-user";
import { useResponsiveColumns, type ColumnStep } from "@/lib/use-columns";
import {
  ENGINEERS,
  areaMeta,
  compareChildrenNewestFirst,
  createdLabels,
  isAncientWorkItem,
  isFinishedState,
  sortByCreatedNewestFirst,
  sortByStackRank,
  stateMeta,
  type WorkItem,
} from "@/lib/work-items-data";
import {
  fetchChildCounts,
  fetchChildWorkItems,
  fetchMyBugs,
  MY_BUG_WORK_ITEM_TYPE,
  type AdoConfig,
  type ChildWorkItem,
  type WorkItemWrite,
} from "@/lib/ado";

/**
 * A write the right-click menu asked for on a NESTED work item: what to show
 * immediately, what to send to Azure DevOps, and what to call it.
 */
export type ChildWriteRequest = {
  optimistic: Partial<WorkItem>;
  write: WorkItemWrite;
  label: string;
};

/**
 * Is this work item assigned to the signed-in user?
 *
 * True only when the item carries an identity address that equals the profile's
 * `mail` or `userPrincipalName` (both trimmed + lower-cased). An item whose
 * "Assigned To" has no address at all can't be matched this way, so it is left
 * out rather than guessed at from its display name.
 */
function isAssignedToUser(item: WorkItem, user: CurrentUser): boolean {
  const itemEmail = normalizeIdentityEmail(item.assigneeEmail);
  if (!itemEmail) return false;
  const mine = [user.mail, user.userPrincipalName]
    .map((a) => normalizeIdentityEmail(a))
    .filter((a): a is string => Boolean(a));
  return mine.includes(itemEmail);
}

/**
 * The column counts of the card grid below, mirroring its Tailwind classes
 * (`grid-cols-1 lg:grid-cols-2 min-[1600px]:grid-cols-3`). Read only for zebra
 * striping — the layout itself is pure CSS. Keep the two in sync.
 *
 * THRESHOLDS LOWERED: the third column used to need 1900px, which in practice
 * almost nothing reached — a 1920px monitor only clears it with the window
 * genuinely maximized and no side chrome, so a 1440p or scaled display never
 * saw three columns at all. They are now 1024px for the second column (was
 * 1280) and 1600px for the third (was 1900), which puts three columns on an
 * ordinary wide laptop or a 1600px+ window instead of reserving them for a
 * maximized 1080p+ desktop. Each card still gets ~500px at three columns,
 * which is what its description block and nested list need to stay readable —
 * that is what stops this going to four.
 */
const MY_WORK_COLUMNS: ColumnStep[] = [
  { minWidth: 0, columns: 1 },
  { minWidth: 1024, columns: 2 },
  { minWidth: 1600, columns: 3 },
];

/**
 * Which work item types the list shows — two INDEPENDENT switches rather than
 * one three-way choice, so each type is turned on and off on its own and the
 * control shows at a glance which are visible. Both default to on.
 */
type MyWorkTypeFilter = { boardItems: boolean; bugs: boolean };

/**
 * The list's order. "priority" is the app's existing backlog ordering
 * ([Microsoft.VSTS.Common.StackRank] — what the board and this tab have always
 * sorted by, and what the UI calls backlog priority). It is NOT the old
 * standalone Priority field, which was removed from this app because the
 * connector's batch hydration never returned it and it only ever rendered a
 * fallback; nothing here brings that back.
 */
type MyWorkSort = "priority" | "created";

export function MyWorkPanel({
  items,
  config,
  writing,
  onOpenItem,
  onPrefetchItem,
  onPrefetchNestedItem,
  onCancelPrefetch,
  onCardContextMenu,
  onChildContextMenu,
  onBugContextMenu,
  onSelectionChange,
  writeChild,
}: {
  /** The board's live work items (no second query for the items themselves). */
  items: WorkItem[];
  config: AdoConfig;
  /** id -> in-flight write label, from the app's one write path. */
  writing: Record<string, string>;
  onOpenItem: (item: WorkItem) => void;
  onPrefetchItem: (item: WorkItem) => void;
  onPrefetchNestedItem: (item: WorkItem) => void;
  onCancelPrefetch: () => void;
  /** Right-click a MY WORK card: the Board's full context menu, unchanged. */
  onCardContextMenu: (item: WorkItem, x: number, y: number) => void;
  /**
   * Right-click a NESTED item: the SAME menu component, plus the executor that
   * applies the chosen write optimistically to this panel's own child row and
   * rolls it back if Azure DevOps refuses it.
   */
  onChildContextMenu: (
    child: ChildWorkItem,
    x: number,
    y: number,
    onWrite: (change: ChildWriteRequest) => void,
  ) => void;
  /**
   * Right-click a TOP-LEVEL BUG card. Same shape as the nested-item menu —
   * a bug isn't in the board's `items` list either, so this panel owns its
   * optimistic update, and its "Change state" flyout must list the BUG type's
   * own states rather than the five User Story ones — but the app-wide rule
   * that only a NESTED item may be deleted still holds, so the caller does not
   * offer Delete for these cards (see `canDelete` in CardMenuState).
   */
  onBugContextMenu: (
    bug: ChildWorkItem,
    x: number,
    y: number,
    onWrite: (change: ChildWriteRequest) => void,
  ) => void;
  /**
   * The current multi-selection, reported up so the ONE context menu (owned by
   * the page) can apply an action to all of it. Empty or single means "behave
   * exactly as before" — the menu only goes bulk at 2+.
   */
  onSelectionChange?: (items: WorkItem[]) => void;
  /** The app's single write path for a work item outside the board list. */
  writeChild: (
    id: string,
    write: WorkItemWrite,
    label: string,
  ) => Promise<string | null>;
}) {
  const user = useCurrentUser(true);
  const columns = useResponsiveColumns(MY_WORK_COLUMNS);

  /**
   * VIEW CONTROLS for this tab — which types are listed, and in what order.
   *
   * Session state, NOT persisted, which matches the one other view filter in
   * the app: the board's own filter box is plain `useState("")` and resets on
   * reload (only connection settings and app data are persisted). It is also the safer default for a control that
   * HIDES things — a filter that silently survived a reload is how a tab comes
   * back looking empty and gets reported as lost data. Every visit therefore
   * starts at the defaults: all types, ordered by priority.
   */
  const [typeFilter, setTypeFilter] = useState<MyWorkTypeFilter>({
    boardItems: true,
    bugs: true,
  });
  const [sortMode, setSortMode] = useState<MyWorkSort>("priority");
  const [createWorkItemOpen, setCreateWorkItemOpen] = useState(false);
  /** True while either type is switched off — drives the "N of M" count. */
  const filterActive = !typeFilter.boardItems || !typeFilter.bugs;

  /**
   * MULTI-SELECTION — ids of the top-level cards currently selected, plus the
   * ANCHOR a Shift+click extends from (the last card clicked without Shift).
   *
   * Ids, not indices: the list re-sorts and re-filters underneath this, and an
   * index would silently come to mean a different work item. Selecting nothing
   * is the normal state, and a single right-click on an UNSELECTED card is
   * unaffected by any of this.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);

  /**
   * Modifier-click selection over the CURRENTLY VISIBLE, currently ordered
   * list:
   *   • Shift+click — select the contiguous range between the anchor and this
   *     card, as it is shown on screen (so a range always matches what the
   *     user can actually see, whatever the filter and ordering are).
   *   • Ctrl/Cmd+click — add or remove this one card, and move the anchor here.
   *   • plain click — untouched; it still opens the work item.
   */
  const handleSelectClick = useCallback(
    (id: string, shift: boolean, toggle: boolean, visible: WorkItem[]) => {
      if (shift && anchorId) {
        const from = visible.findIndex((it) => it.id === anchorId);
        const to = visible.findIndex((it) => it.id === id);
        if (from >= 0 && to >= 0) {
          const [lo, hi] = from <= to ? [from, to] : [to, from];
          const range = visible.slice(lo, hi + 1).map((it) => it.id);
          setSelectedIds((prev) => [...new Set([...prev, ...range])]);
          return;
        }
      }
      if (toggle) {
        setSelectedIds((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
        setAnchorId(id);
        return;
      }
      // Shift with no usable anchor behaves as "start a selection here".
      setSelectedIds([id]);
      setAnchorId(id);
    },
    [anchorId],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setAnchorId(null);
  }, []);

  /**
   * OPTIMISTIC OVERLAY for a top-level bug's writes, keyed by bug id — the same
   * contract as `childOverlay` below, for the same reason: a bug comes from
   * this panel's own query, not the board's `items`, so the board write path
   * can't own its optimistic update or roll it back.
   */
  const [bugOverlay, setBugOverlay] = useState<
    Record<string, Partial<WorkItem>>
  >({});

  /**
   * YOUR TOP-LEVEL BUGS — a My Work-only read (see fetchMyBugs in lib/ado.ts).
   *
   * Deliberately NOT part of the board query: widening that query's portfolio
   * type clause to include Bug would push bugs into the
   * engineer sections, the backlog columns, Triage and Bulk edit, all of
   * which render the same `items` array. This runs alongside it, scoped by the
   * same area root / state exclusion / keyset pagination, and only this tab
   * ever sees the result.
   *
   * Keyed on the connection (not on `parentIds`) so it is fetched once per
   * refresh rather than re-running whenever your story list changes, and
   * invalidated by the app-wide Refresh exactly like the child queries.
   */
  const bugsQuery = useQuery({
    queryKey: [
      "ado-my-bugs",
      config.organization,
      config.project,
      config.areaRoot,
    ],
    queryFn: () => fetchMyBugs(config),
    enabled: Boolean(
      user && config.organization.trim() && config.project.trim(),
    ),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  /**
   * The bugs, with this panel's optimistic overlay applied — and re-checked
   * against the SIGNED-IN PROFILE with the very same matcher the stories use.
   *
   * The query already asks Azure DevOps for `[System.AssignedTo] = @Me`, so
   * this is normally a no-op. It is here because `@Me` is whoever the Azure
   * DevOps connection authenticates as, which is not, by construction, the
   * profile this tab means by "you": if those two identities ever diverged the
   * tab would quietly list another person's bugs as yours. With the check, that
   * case shows nothing instead — the same "say nothing rather than guess" rule
   * the tab already applies to an unresolvable profile.
   */
  const myBugs = useMemo(() => {
    if (!user) return [];
    return (bugsQuery.data?.items ?? [])
      .filter((bug) => isAssignedToUser(bug, user))
      .map((bug) =>
        bugOverlay[bug.id] ? { ...bug, ...bugOverlay[bug.id] } : bug,
      );
  }, [bugsQuery.data, user, bugOverlay]);

  /** Bug id -> the bug, so a card can tell which of the two kinds it is. */
  const bugById = useMemo(
    () => new Map(myBugs.map((bug) => [bug.id, bug])),
    [myBugs],
  );

  /**
   * Your work items — board items and top-level bugs at the SAME level, in ONE
   * list. Interleaved by the board's own comparator (StackRank ascending,
   * unranked last, id tie-break), so a bug sits wherever its rank puts it
   * rather than in a section of its own.
   */
  /**
   * EVERYTHING of yours, both types, before the view filter.
   *
   * Kept separately from `mine` so the header can honestly say "3 of 11": the
   * total has to come from a real unfiltered count, never from arithmetic on
   * the filtered list.
   */
  const mineAll = useMemo(
    () =>
      user
        ? [...items.filter((it) => isAssignedToUser(it, user)), ...myBugs]
        : [],
    [items, user, myBugs],
  );

  /**
   * What the list actually renders: `mineAll` filtered by type, then ordered.
   *
   * THE TYPE FILTER IS TOP-LEVEL ONLY, by construction. It is applied here and
   * ONLY here — to the array of parent cards. The nested rows come from a
   * different array entirely (`children[item.id]`, from childrenQuery) which is
   * never filtered by it, so an item's nested Bugs and Tasks all still show
   * even while board items are filtered out. Choosing the type
   * a CARD is, and choosing what a card CONTAINS, are two different questions;
   * this control only answers the first.
   *
   * Which type an item is comes from `bugById` — membership of this panel's own
   * bug query — not from parsing a title or an id, so it is always Azure
   * DevOps' own answer.
   */
  const mine = useMemo(() => {
    const kept = mineAll.filter((it) =>
      bugById.has(it.id) ? typeFilter.bugs : typeFilter.boardItems,
    );
    // "priority" keeps the existing backlog (StackRank) comparator untouched,
    // unranked-last and id tie-break included; "created" is newest first.
    return sortMode === "created"
      ? sortByCreatedNewestFirst(kept)
      : sortByStackRank(kept);
  }, [mineAll, typeFilter, sortMode, bugById]);

  const parentIds = useMemo(() => mine.map((it) => it.id), [mine]);

  /**
   * Keep the selection honest: drop any id that is no longer in the visible
   * list. That covers a refresh removing a work item, and it covers a type
   * filter being switched off — a bulk action must never reach a card the user
   * can no longer see, which is exactly how someone would close a work item
   * they had forgotten was selected.
   */
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = prev.filter((id) => parentIds.includes(id));
      return next.length === prev.length ? prev : next;
    });
  }, [parentIds]);

  /** The selected items, in the order they are shown. */
  const selectedItems = useMemo(
    () => mine.filter((it) => selectedIds.includes(it.id)),
    [mine, selectedIds],
  );
  /** A bulk action only exists at 2+; one selected card behaves as before. */
  const bulkSelection = selectedItems.length > 1 ? selectedItems : null;

  // Report the selection up to the page, which owns the context menu.
  useEffect(() => {
    onSelectionChange?.(selectedItems);
  }, [selectedItems, onSelectionChange]);

  /**
   * WHICH cards have their nested items expanded. Everything starts COLLAPSED —
   * the tab opens as a clean list of your own work, and the nested items are
   * revealed (and only then fetched) on demand.
   */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const expandedIds = useMemo(
    () => parentIds.filter((id) => expanded[id]),
    [parentIds, expanded],
  );

  /**
   * Is EVERY card expanded right now? Drives the one button's label, so it
   * always names what the click will do rather than describing a mode — and it
   * flips back to "Expand all" by itself when a refresh brings in a work item
   * that wasn't part of the last expand.
   */
  const allExpanded = parentIds.length > 0 && parentIds.every((id) => expanded[id]);

  /**
   * EXPAND ALL / COLLAPSE ALL — one button, because a one-way "expand all" is
   * a trap: it is the click you most want to undo.
   *
   * COST: this is deliberately a single state update, not a loop of per-card
   * expands. Every expanded card is served by ONE query keyed on the joined id
   * list (`childrenQuery` below), so flipping them all on changes that key
   * exactly once and issues exactly one fetch — not one request per card.
   * fetchChildWorkItems then does the batching internally: parent ids and child
   * ids are both chunked 200 at a time and run at most 4 requests in parallel
   * (HYDRATE_CHUNK / mapWithConcurrency in lib/ado.ts), so a user with 40
   * stories still produces a couple of batched calls rather than 40. Cards
   * opened earlier keep their rows on screen while it resolves
   * (`placeholderData`), and the existing "Loading nested items…" indicator in
   * the header is what says it is working — no card blinks back to a spinner.
   */
  const toggleAllExpanded = useCallback(() => {
    setExpanded(() =>
      allExpanded
        ? {}
        : // `as const` keeps each pair a TUPLE, so this resolves to the typed
          // Object.fromEntries overload (Record<string, boolean>) rather than
          // the `any`-returning one.
          Object.fromEntries(parentIds.map((id) => [id, true] as const)),
    );
  }, [allExpanded, parentIds]);

  /**
   * CHILD COUNTS — one cheap `workitemsbatch` relations call for all of your
   * items (no child work items are hydrated), so every collapsed card can show
   * a truthful "Nested items (3)" on its toggle without fetching the children
   * themselves. Refreshed by the app-wide Refresh through query invalidation.
   */
  const countsQuery = useQuery({
    queryKey: [
      "ado-child-counts",
      config.organization,
      config.project,
      parentIds.join(","),
    ],
    queryFn: () => fetchChildCounts(config, parentIds),
    enabled: parentIds.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const counts = countsQuery.data ?? {};

  /**
   * THE NESTED ITEMS THEMSELVES — hydrated only for the cards that are actually
   * EXPANDED, in the same <=200-id batches as before. Collapsing a card leaves
   * its data in the TanStack cache, so re-expanding it is instant, and the query
   * doesn't exist at all until the first expand.
   *
   * The app-wide Refresh invalidates this key, so refreshing while My Work is
   * open updates exactly what is on screen.
   */
  const childrenQuery = useQuery({
    queryKey: [
      "ado-child-work-items",
      config.organization,
      config.project,
      expandedIds.join(","),
    ],
    queryFn: () => fetchChildWorkItems(config, expandedIds),
    enabled: expandedIds.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    // Expanding a SECOND card changes this key. Keeping the previous result on
    // screen while the new one loads means the cards you already opened don't
    // blink back to "loading" — the card being opened is the only one that
    // waits (it has no entry in the kept result, which is how the row below
    // tells "not fetched yet" apart from "genuinely has none").
    placeholderData: (prev) => prev,
  });

  const children = useMemo(
    () => childrenQuery.data?.byParent ?? {},
    [childrenQuery.data],
  );
  const missingCount = childrenQuery.data?.missingIds.length ?? 0;
  /** Bugs Azure DevOps wouldn't fully answer for — reported, never guessed. */
  const bugsMissing = bugsQuery.data?.missingIds.length ?? 0;

  /**
   * OPTIMISTIC OVERLAY for nested-item writes, keyed by child id.
   *
   * A nested item is not in the board's `items` list, so the app's board write
   * path can't own its optimistic update — this panel does instead, with the
   * same contract: paint the change immediately, send the REAL write, refetch on
   * success, and drop the change (rolling the row back to what Azure DevOps
   * actually holds) if the write fails.
   */
  const [childOverlay, setChildOverlay] = useState<
    Record<string, Partial<WorkItem>>
  >({});

  const runChildWrite = useCallback(
    (child: ChildWorkItem, change: ChildWriteRequest) => {
      setChildOverlay((o) => ({ ...o, [child.id]: change.optimistic }));
      void (async () => {
        const error = await writeChild(child.id, change.write, change.label);
        if (!error) {
          // Success: replace the guess with what ADO really stored, then drop
          // the overlay so the refetched row is what's on screen.
          await childrenQuery.refetch();
        }
        setChildOverlay((o) => {
          const next = { ...o };
          delete next[child.id];
          return next;
        });
      })();
    },
    [writeChild, childrenQuery],
  );

  /**
   * The same contract for a TOP-LEVEL BUG: paint the change immediately, send
   * the real write through the app's one out-of-board write path, refetch the
   * bug list on success, and drop the overlay either way — so a refused write
   * rolls the card back to what Azure DevOps actually holds.
   *
   * Refetching `bugsQuery` (not the board query) is what makes a bug moved to
   * Closed or Removed leave the list, exactly as the query's own state
   * exclusion says it should.
   */
  const runBugWrite = useCallback(
    (bug: ChildWorkItem, change: ChildWriteRequest) => {
      setBugOverlay((o) => ({ ...o, [bug.id]: change.optimistic }));
      void (async () => {
        const error = await writeChild(bug.id, change.write, change.label);
        if (!error) await bugsQuery.refetch();
        setBugOverlay((o) => {
          const next = { ...o };
          delete next[bug.id];
          return next;
        });
      })();
    },
    [writeChild, bugsQuery],
  );

  // Profile photos for whoever owns the CHILD items — they may be anyone on the
  // team, not just the signed-in user, so this set is looked up here.
  const childEmails = useMemo(() => {
    const set = new Set<string>();
    for (const list of Object.values(children)) {
      for (const child of list) {
        const email = normalizeIdentityEmail(child.assigneeEmail);
        if (email) set.add(email);
      }
    }
    return [...set];
  }, [children]);
  const photos = usePersonPhotos(childEmails);

  /* --------------------------------------------------------- add nested item
   * WHICH work item the creation dialog is open for (null = closed), and the
   * roster it offers.
   *
   * The owner list is built from identities this app has genuinely seen — the
   * signed-in user, and every engineer section the live board data produced
   * (the same buildEngineerSections + email-keyed dedupe the Board uses, so a
   * person can't appear twice). Roster names with NO address are left out on
   * purpose: [System.AssignedTo] is written as an email/UPN, and a bare display
   * name is exactly the value Azure DevOps rejects. Together with the dialog
   * having no free-text identity box, that means every option in the picker is
   * an address ADO can actually resolve.
   */
  const [addTaskFor, setAddTaskFor] = useState<string | null>(null);

  /**
   * The signed-in user's identity AS AZURE DEVOPS KNOWS IT.
   *
   * GROUND TRUTH FIRST: every card in this tab is a work item Azure DevOps says
   * is assigned to this user, so that item's own [System.AssignedTo] identity
   * IS ADO's value for them — read back from ADO, not derived from a profile.
   * That matters because the Office 365 profile's `mail` and the ADO identity
   * are often different strings for one person (`Avery.Example@…` vs `avery@…`),
   * and writing the wrong one is rejected as an unknown identity.
   *
   * Only when this user owns nothing yet (so ADO has never named them here)
   * does it fall back to the profile — UPN first, never `mail` first. See
   * adoWriteIdentity in lib/current-user.ts.
   */
  const selfIdentity = useMemo(() => {
    for (const it of mine) {
      const email = normalizeIdentityEmail(it.assigneeEmail);
      if (email) return email;
    }
    return normalizeIdentityEmail(adoWriteIdentity(user));
  }, [mine, user]);

  const assigneeOptions = useMemo<AssigneeOption[]>(() => {
    const byEmail = new Map<string, AssigneeOption>();
    if (user && selfIdentity) {
      byEmail.set(selfIdentity, {
        email: selfIdentity,
        name: user.displayName,
        isSelf: true,
      });
    }
    for (const section of buildEngineerSections(items, ENGINEERS)) {
      const email = normalizeIdentityEmail(section.email);
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, { email, name: section.name });
    }
    return [...byEmail.values()].sort(
      (a, b) =>
        Number(Boolean(b.isSelf)) - Number(Boolean(a.isSelf)) ||
        a.name.localeCompare(b.name),
    );
  }, [items, user, selfIdentity]);

  const queryClient = useQueryClient();

  /**
   * A Task was created under `parentId`. Nothing is stubbed into the list: the
   * parent's nested section is EXPANDED (so the new task is visible where it
   * landed) and both child queries are invalidated, which refetches the rows
   * and the count from Azure DevOps. Expanding a collapsed card changes the
   * children query's key, so that card fetches its list for the first time.
   */
  const handleTaskCreated = useCallback(
    (parentId: string) => {
      setExpanded((e) => ({ ...e, [parentId]: true }));
      void queryClient.invalidateQueries({ queryKey: ["ado-child-counts"] });
      void queryClient.invalidateQueries({ queryKey: ["ado-child-work-items"] });
    },
    [queryClient],
  );

  // Resolved from the LIVE list: if a refresh removed the work item, the dialog
  // closes itself rather than creating a task under something that's gone.
  const addTaskParent = useMemo(
    () => mine.find((it) => it.id === addTaskFor) ?? null,
    [mine, addTaskFor],
  );

  if (!user) {
    return (
      <div className="w95-window px-3 py-2">
        <EmptyState
          icon={UserX}
          title="Waiting for your profile"
          description="My Work needs your signed-in identity (Office 365 Users → “Get my profile”) to know which items are yours. If your profile can't be resolved, nothing is shown here rather than guessing from names."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="w95-panel flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 text-[11px]">
        {/* pl-1.5 so the count doesn't sit hard against the panel's bevel. */}
        {/* COUNT — "N of M" whenever a filter is hiding something, the same way
            the board's filter reports itself, so a shortened list never looks
            like missing data. Unfiltered it stays the plain count it was. */}
        <span className="pl-1.5 font-bold">
          {!filterActive
            ? `${mine.length} work ${mine.length === 1 ? "item" : "items"} assigned to you`
            : `${mine.length} of ${mineAll.length} work ${
                mineAll.length === 1 ? "item" : "items"
              } assigned to you`}
        </span>

        <button
          type="button"
          className="w95-btn h-auto py-0.5 text-[10px]"
          disabled={!selfIdentity}
          onClick={() => setCreateWorkItemOpen(true)}
          title={
            selfIdentity
              ? "Create a User Story or Bug assigned to you"
              : "Your Azure DevOps identity could not be resolved"
          }
        >
          <FilePlus2 className="h-3 w-3" />
          New work item
        </button>

        {/* Open (or close) every card's nested list at once, in line with the
            count. One button that names what the click does — see
            toggleAllExpanded above for why this is a single batched fetch
            rather than one request per card. Hidden when there is nothing to
            expand. Cards still start COLLAPSED: this is an explicit click, not
            a change of default. */}
        {mine.length > 0 && (
          <button
            type="button"
            className="w95-btn h-auto py-0.5 text-[10px]"
            onClick={toggleAllExpanded}
            title={
              allExpanded
                ? "Collapse the nested work items under every card"
                : "Expand the nested work items under every card (loads them from Azure DevOps in one batched read)"
            }
          >
            {allExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        )}
        {/* The four lines of explanatory prose that used to sit here (identity
            match, sort order, plain-text descriptions, right-click hint) were
            removed on request: they cost a whole band of vertical space on
            every visit to say things the tab demonstrates by itself. None of
            the behaviour changed — identity matching, the Stack Rank sort, the
            plain-text description rule and the right-click menu are all exactly
            as they were, and this tab still has no refresh control of its own
            (the shared Refresh action in My Work and Board updates both
            everything this tab shows, by invalidating the child queries). */}
        {/* SELECTION READOUT — says how many are selected and how to act on
            them, because a right-click menu that suddenly applies to twelve
            work items must never be a surprise. */}
        {selectedItems.length > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 bg-[#000080] px-1.5 py-px text-[10px] font-bold text-white">
            {selectedItems.length} selected
            {bulkSelection && (
              <span className="font-normal">
                — right-click any of them to act on all {selectedItems.length}
              </span>
            )}
            <button
              type="button"
              className="w95-btn h-auto py-0 text-[10px]"
              onClick={clearSelection}
              title="Clear the selection"
            >
              Clear
            </button>
          </span>
        )}

        {/* `ml-auto` moved off this note and onto the control group below —
            two `ml-auto` children would each claim the free space and the
            controls would stop sitting flush right. It now reads as status
            text next to the count, which is where it belongs. */}
        {childrenQuery.isFetching && (
          <span className="flex shrink-0 items-center gap-1 font-bold text-[#000080]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading nested items…
          </span>
        )}

        {/* VIEW CONTROLS — 95 TOOLBAR TOGGLES, not dropdowns.
            Each is a chunky beveled button that stays PRESSED (and dithered)
            while its option is on, with a tick in front of it, which is how 95
            showed a latched toolbar button and a checked menu item. Two signals
            for the same fact — bevel direction and the tick — so it reads
            whether or not you notice the bevel.

            "Show" is two INDEPENDENT switches; "Order by" is a pair where
            exactly one is pressed, so it behaves as a radio group. Both are
            `aria-pressed` buttons so the state is exposed properly rather than
            being purely visual.

            ANCHORED RIGHT via `ml-auto`, and placed LAST IN THE MARKUP rather
            than being floated across with CSS `order` — keyboard tab order and
            screen-reader order follow the DOM, so reordering visually alone
            would have put the controls in a different place for a keyboard user
            than for everyone else. What reads left-to-right is: what the list
            CONTAINS (the count, Expand all, the selection) on the left, and how
            it is CONFIGURED (which types, which order) on the right.

            Its own `flex-wrap` is the narrow-width behaviour: the two groups
            drop onto separate lines, still right-aligned (`justify-end`),
            instead of overflowing the panel or squeezing the count. The parent
            row already wraps too, so the whole group moves to its own line
            before anything collides. */}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-[10px]">Show:</span>
            <button
              type="button"
              className={cn(
                "w95-btn h-auto py-0.5 text-[10px]",
                typeFilter.boardItems && "w95-btn--on",
              )}
              aria-pressed={typeFilter.boardItems}
              onClick={() =>
                setTypeFilter((f) => ({ ...f, boardItems: !f.boardItems }))
              }
              title={
                typeFilter.boardItems
                  ? "User Stories, Features, and Epics are shown — click to hide them"
                  : "User Stories, Features, and Epics are hidden — click to show them"
              }
            >
              <span aria-hidden="true" className="w-2 text-center font-bold">
                {typeFilter.boardItems ? "✓" : ""}
              </span>
              Backlog items
            </button>
            <button
              type="button"
              className={cn(
                "w95-btn h-auto py-0.5 text-[10px]",
                typeFilter.bugs && "w95-btn--on",
              )}
              aria-pressed={typeFilter.bugs}
              onClick={() => setTypeFilter((f) => ({ ...f, bugs: !f.bugs }))}
              title={
                typeFilter.bugs
                  ? "Bugs are shown — click to hide them"
                  : "Bugs are hidden — click to show them"
              }
            >
              <span aria-hidden="true" className="w-2 text-center font-bold">
                {typeFilter.bugs ? "✓" : ""}
              </span>
              Bugs
            </button>
          </span>

          <span className="flex shrink-0 items-center gap-1">
            <span className="text-[10px]">Order by:</span>
            {(
              [
                ["priority", "Backlog priority", "Order by the backlog (Stack Rank) order, as the board does"],
                ["created", "Newest first", "Order by created date, newest first"],
              ] as const
            ).map(([mode, label, hint]) => (
              <button
                key={mode}
                type="button"
                className={cn(
                  "w95-btn h-auto py-0.5 text-[10px]",
                  sortMode === mode && "w95-btn--on",
                )}
                aria-pressed={sortMode === mode}
                onClick={() => setSortMode(mode)}
                title={hint}
              >
                <span aria-hidden="true" className="w-2 text-center font-bold">
                  {sortMode === mode ? "✓" : ""}
                </span>
                {label}
              </button>
            ))}
          </span>
        </span>
      </div>

      {missingCount > 0 && (
        <div className="w95-panel flex shrink-0 items-center gap-2 px-2 py-1 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 text-[#808000]" />
          {missingCount} linked child{" "}
          {missingCount === 1 ? "item" : "items"} couldn't be loaded from Azure
          DevOps (deleted or not accessible) — they are left out rather than shown
          with made-up details.
        </div>
      )}

      {/* The bug list failing is NON-DESTRUCTIVE: your stories are already on
          screen and stay there. It is reported here, in Azure DevOps' own
          words, rather than being swallowed — an empty bug section and a failed
          read must never look the same. */}
      {bugsQuery.isError && (
        <div className="w95-panel flex shrink-0 items-center gap-2 px-2 py-1 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 text-[#808000]" />
          Your {MY_BUG_WORK_ITEM_TYPE.toLowerCase()}s couldn't be loaded from
          Azure DevOps, so only work items from the board are listed —{" "}
          {bugsQuery.error instanceof Error
            ? bugsQuery.error.message
            : "Couldn't reach Azure DevOps."}
        </div>
      )}

      {bugsMissing > 0 && (
        <div className="w95-panel flex shrink-0 items-center gap-2 px-2 py-1 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 text-[#808000]" />
          {bugsMissing} of your {MY_BUG_WORK_ITEM_TYPE.toLowerCase()}s couldn't
          be read from Azure DevOps (its details or its parent link), so{" "}
          {bugsMissing === 1 ? "it is" : "they are"} left out rather than shown
          without knowing whether {bugsMissing === 1 ? "it has" : "they have"} a
          parent.
        </div>
      )}

      {mine.length === 0 ? (
        <div className="w95-window px-3 py-2">
          {/* An empty list because of the FILTER is a different fact from an
              empty list because you have no work, and saying the wrong one
              would be misleading — so the filtered case names the filter and
              says what is being hidden. */}
          {mineAll.length > 0 && filterActive ? (
            <EmptyState
              icon={Inbox}
              title={
                !typeFilter.boardItems && !typeFilter.bugs
                  ? "Both work item groups are hidden"
                  : typeFilter.bugs
                    ? "No bugs assigned to you"
                    : "No backlog items assigned to you"
              }
              description={
                !typeFilter.boardItems && !typeFilter.bugs
                  ? `“Backlog items” and “Bugs” are both switched off, so all ${mineAll.length} work ${
                      mineAll.length === 1 ? "item" : "items"
                    } assigned to you ${
                      mineAll.length === 1 ? "is" : "are"
                    } hidden. Switch one back on to see ${
                      mineAll.length === 1 ? "it" : "them"
                    }.`
                  : `“${
                      typeFilter.bugs ? "Backlog items" : "Bugs"
                    }” is switched off, which hides the ${mineAll.length} work ${
                      mineAll.length === 1 ? "item" : "items"
                    } assigned to you. Switch it back on to see ${
                      mineAll.length === 1 ? "it" : "them"
                    }.`
              }
              action={
                <button
                  type="button"
                  className="w95-btn"
                  onClick={() => setTypeFilter({ boardItems: true, bugs: true })}
                >
                  Show all work items
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={Inbox}
              title="Nothing assigned to you"
              description="No live work item under the configured area path is currently assigned to your identity. Closed and Removed items are excluded — see the Completed tab for finished work."
            />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {/* MULTI-COLUMN at wide widths: these cards carry a description and a
              nested-item list, so one narrow column wasted most of a wide
              screen. `auto-rows-min` keeps each card its natural height (no
              stretching) and the scroll container above keeps `min-h-0` — no
              viewport-relative height anywhere. The breakpoints here MUST match
              MY_WORK_COLUMNS below, which is what keeps the zebra striping in
              step with the layout. */}
          {/* BOTH breakpoints are arbitrary (`min-[…]`) ON PURPOSE — do not
              "simplify" the first one back to `lg:`.

              THE BUG THIS FIXES: `lg:grid-cols-2` and `min-[1600px]:grid-cols-3`
              are equally specific, so at ≥1600px, where BOTH match, the winner
              is whichever the stylesheet prints LAST. Tailwind emitted the
              arbitrary variant before the named one (measured: the 1600px rule
              at byte 96533, the 64rem rule at 100143), so grid-cols-2 always
              overrode grid-cols-3 and the third column was unreachable at every
              width — which is why raising/lowering the threshold never changed
              anything. Keeping both in the SAME family makes them sort by
              width, so the wider rule lands last and wins. */}
          <div className="grid auto-rows-min grid-cols-1 gap-2 min-[1024px]:grid-cols-2 min-[1600px]:grid-cols-3">
            {mine.map((item, index) => {
              const isExpanded = Boolean(expanded[item.id]);
              // Which KIND of card this is. A bug came from this panel's own
              // query and carries Azure DevOps' own type string; everything
              // else carries its hydrated User Story, Feature, or Epic type.
              const bug = bugById.get(item.id) ?? null;
              // undefined = this card's children have not been fetched yet;
              // [] = Azure DevOps says it genuinely has none.
              const loaded = children[item.id];
              // Sorted AFTER the optimistic overlay is applied, not at fetch
              // time, so marking a nested item Closed from its right-click menu
              // drops it to the bottom (and greys it) the moment you click,
              // instead of only after the refetch lands.
              const childItems = (loaded ?? [])
                .map((child) =>
                  childOverlay[child.id]
                    ? { ...child, ...childOverlay[child.id] }
                    : child,
                )
                .sort(compareChildrenNewestFirst);
              return (
                <MyWorkCard
                  key={item.id}
                  item={item}
                  typeLabel={bug?.workItemType ?? item.workItemType ?? "User Story"}
                  isBug={Boolean(bug)}
                  // Striped by ROW, not by list index: in a multi-column grid
                  // `index % 2` paints a diagonal checkerboard, while whole
                  // alternating rows still read as the 95 list they did in one
                  // column (and reduce to the identical stripes at columns = 1).
                  zebra={Math.floor(index / columns) % 2 === 1}
                  busyLabel={writing[item.id] ?? null}
                  childItems={childItems}
                  // The count comes from the cheap relations call, so it is
                  // known (and true) even while the card is collapsed. null =
                  // not read yet / the call failed — the toggle then says so
                  // rather than showing a made-up number.
                  childCount={
                    typeof counts[item.id] === "number" ? counts[item.id] : null
                  }
                  countsLoading={countsQuery.isLoading}
                  expanded={isExpanded}
                  onToggleExpanded={() =>
                    setExpanded((e) => ({ ...e, [item.id]: !e[item.id] }))
                  }
                  onAddTask={() => setAddTaskFor(item.id)}
                  childrenLoading={isExpanded && !loaded && !childrenQuery.isError}
                  childrenError={
                    isExpanded && childrenQuery.isError
                      ? childrenQuery.error instanceof Error
                        ? childrenQuery.error.message
                        : "Couldn't reach Azure DevOps."
                      : null
                  }
                  onRetryChildren={() => void childrenQuery.refetch()}
                  photos={photos}
                  writing={writing}
                  selected={selectedIds.includes(item.id)}
                  onSelectClick={(shift, toggle) =>
                    handleSelectClick(item.id, shift, toggle, mine)
                  }
                  onOpen={() => onOpenItem(item)}
                  onPrefetch={() => onPrefetchItem(item)}
                  onCancelPrefetch={onCancelPrefetch}
                  // A story is a board work item, so it gets the Board's menu
                  // on the Board's write path. A bug isn't in that list, so it
                  // gets the same menu with this panel owning the optimistic
                  // write and the BUG type's own states in the flyout.
                  onContextMenu={(x, y) =>
                    bug
                      ? onBugContextMenu(bug, x, y, (change) =>
                          runBugWrite(bug, change),
                        )
                      : onCardContextMenu(item, x, y)
                  }
                  onChildContextMenu={(child, x, y) =>
                    onChildContextMenu(child, x, y, (change) =>
                      runChildWrite(child, change),
                    )
                  }
                  onOpenChild={(child) => onOpenItem(child)}
                  onPrefetchChild={(child) => onPrefetchNestedItem(child)}
                />
              );
            })}
          </div>
        </div>
      )}
      {/* Create a nested Task under one of your work items. Mounted only while
          a card asked for it, so the parent's iteration read (see the dialog)
          happens on demand rather than for every card on screen. */}
      {addTaskParent && (
        <AddTaskDialog
          open
          parent={addTaskParent}
          config={config}
          assignees={assigneeOptions}
          onClose={() => setAddTaskFor(null)}
          onCreated={() => handleTaskCreated(addTaskParent.id)}
        />
      )}
      <CreateMyWorkItemDialog
        open={createWorkItemOpen}
        config={config}
        creatorIdentity={selfIdentity}
        creatorName={user.displayName}
        onOpenChange={setCreateWorkItemOpen}
        onCreated={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["ado-work-items"] }),
            queryClient.invalidateQueries({ queryKey: ["ado-my-bugs"] }),
          ]);
        }}
      />
    </div>
  );
}

/**
 * "Created on" stamp, used by BOTH a top-level card and a nested row so the two
 * never drift apart.
 *
 * It reuses the Triage list's exact pair of renderings — the coarse age in the
 * row, the precise timestamp on hover — from the one shared formatter in
 * work-items-data, rather than introducing a third date style to the app.
 *
 * Deliberately COMPACT: these rows already carry a type chip, a state badge,
 * tags, an assignee and a children toggle, so the age sits INLINE among the
 * existing chips ("Created 3 days ago") instead of taking a line of its own, and it
 * never widens the layout — it is shrink-0 next to the flexible title, so a
 * long title truncates as it already did.
 *
 * When Azure DevOps returned no parseable created date this renders a neutral
 * "—" that says so on hover. It never substitutes the fetch time, "now", or a
 * date inferred from the id: a missing date is shown as missing.
 */
function CreatedStamp({
  item,
  muted = false,
}: {
  item: WorkItem;
  muted?: boolean;
}) {
  const labels = createdLabels(item);
  const tone = muted ? "text-[#8a8a8a]" : "text-[#404040]";
  if (!labels) {
    return (
      <span
        className={cn("shrink-0 text-[9px]", tone)}
        title="Azure DevOps returned no created date for this work item."
      >
        —
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 text-[9px]",
        tone,
      )}
      title={`Created ${labels.absolute}`}
    >
      <Clock className="h-2.5 w-2.5" />
      Created {labels.relative}
    </span>
  );
}

function MyWorkCard({
  item,
  typeLabel,
  isBug,
  zebra,
  busyLabel,
  childItems,
  childCount,
  countsLoading,
  expanded,
  onToggleExpanded,
  onAddTask,
  childrenLoading,
  childrenError,
  onRetryChildren,
  photos,
  writing,
  selected,
  onSelectClick,
  onOpen,
  onPrefetch,
  onCancelPrefetch,
  onContextMenu,
  onChildContextMenu,
  onOpenChild,
  onPrefetchChild,
}: {
  item: WorkItem;
  /**
   * [System.WorkItemType] for this card — Azure DevOps' own string for every
   * board item and top-level bug.
   */
  typeLabel: string;
  /** Drives the type chip's colour + icon only; the label is `typeLabel`. */
  isBug: boolean;
  zebra: boolean;
  /** Non-null while a write for this work item is in flight with ADO. */
  busyLabel: string | null;
  childItems: ChildWorkItem[];
  /** ADO's own child count, or null when it isn't known (never guessed). */
  childCount: number | null;
  countsLoading: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Open the "New nested item" dialog for this work item. */
  onAddTask: () => void;
  childrenLoading: boolean;
  childrenError: string | null;
  onRetryChildren: () => void;
  photos: Record<string, string>;
  writing: Record<string, string>;
  /** Part of the current multi-selection. */
  selected: boolean;
  /** A Shift/Ctrl/Cmd click on the card — plain clicks are NOT routed here. */
  onSelectClick: (shift: boolean, toggle: boolean) => void;
  onOpen: () => void;
  onPrefetch: () => void;
  onCancelPrefetch: () => void;
  onContextMenu: (x: number, y: number) => void;
  onChildContextMenu: (child: ChildWorkItem, x: number, y: number) => void;
  onOpenChild: (child: ChildWorkItem) => void;
  onPrefetchChild: (child: ChildWorkItem) => void;
}) {
  const area = areaMeta(item.area);
  const state = stateMeta(item.state);
  const tagVisualFrameClass = useTagVisualFrameClasses(item);
  // Created 3+ years ago -> the corner cobweb, from the same created date the
  // CreatedStamp below renders.
  const ancient = isAncientWorkItem(item);
  // This card's right-click menu is open — same 95 selection marker the board
  // cards use, from the same state.
  const menuTarget = useIsMenuTarget(item.id);

  /**
   * WHICH OF THE TWO NESTED-LIST BUTTONS THIS CARD SHOWS.
   *
   * • The expand toggle is hidden for a BUG, and for anything Azure DevOps
   *   tells us has NO children. The count comes from the cheap relations-only
   *   call that already runs while the card is collapsed, so "has none" is
   *   KNOWN here rather than guessed — and the toggle disappears only on a
   *   real zero.
   *
   *   `childCount === null` means the count is still loading or came back
   *   unavailable. That is NOT zero, so the toggle stays: hiding it on an
   *   unknown count would silently bury children that do exist. Only a
   *   definite 0 removes it.
   *
   * • "New nested item" is hidden for a BUG.
   *
   * KNOWN CONSEQUENCE, flagged rather than hidden: Azure DevOps does allow a
   * Bug to have child Tasks. Suppressing the toggle on bugs means that if one
   * does have children they are not reachable from this tab (they remain in
   * Azure DevOps, and on the board's own cards, untouched — nothing is
   * deleted or filtered out of the data). That is what was asked for; it is
   * called out here so it is a decision on record and not an accident.
   */
  const showNestedToggle = !isBug && childCount !== 0;
  const showAddTask = !isBug;

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e.clientX, e.clientY);
      }}
      // Modifier-click selects; a plain click opens the card unless the click
      // belongs to one of its own controls (nested toggle, nested-item creator, title).
      onClick={(e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          onSelectClick(e.shiftKey, e.ctrlKey || e.metaKey);
          return;
        }
        const target = e.target as HTMLElement;
        if (target.closest("button, a, input, textarea, select, [role='button']")) {
          return;
        }
        onOpen();
      }}
      onPointerEnter={onPrefetch}
      onPointerLeave={onCancelPrefetch}
      className={cn(
        // `relative` is the positioning context for the corner cobweb below.
        "w95-item w95-interactive relative cursor-pointer border-l-4 px-2 py-1.5",
        selected && "w95-selecteditem",
        // SURFACE. A bug takes a grey-red version of whichever zebra band it
        // falls in, rather than one flat colour: striping still has to read
        // within a run of bugs, so both bands are tinted by the same amount
        // (ΔE00 5.7 from their grey originals) and the step between them is
        // preserved (7.8 vs the stories' 8.4). Subtle on purpose — it is a
        // background hint behind the explicit "Bug" chip, not a second status
        // signal, and it stays well clear of every state badge colour
        // (nearest is Removed's grey at ΔE00 15.4) so it can't be misread as
        // one. The category border, hot outline, caution tape and navy
        // menu-target ring are all drawn ON TOP and are unaffected.
        isBug
          ? zebra
            ? "bg-[#e9dcdb]"
            : "bg-[#c8bcbc]"
          : zebra
            ? "bg-[#e4e1dc]"
            : "bg-[#c0c0c0]",
        "shadow-[inset_-1px_-1px_0_0_#0a0a0a,inset_1px_1px_0_0_#ffffff,inset_-2px_-2px_0_0_#808080,inset_2px_2px_0_0_#dfdfdf]",
        area?.border,
        menuTarget && "w95-menutarget",
        tagVisualFrameClass,
      )}
    >
      {/* Ancient item -> cobweb in the top-right corner. Click-through and
          absolutely positioned, so multi-select, the right-click menu and the
          nested-items toggle are all untouched by it. Seeded by the work item
          id, so this card wears the same web as it does on the Board. */}
      {ancient && <CobwebIndicator seed={item.id} />}
      <div className="flex items-start gap-1.5">
        <p className="flex min-w-0 flex-1 items-start gap-1 text-[11px] font-bold leading-tight">
          <button
            type="button"
            onClick={onOpen}
            title="Open the work item details"
            className="min-w-0 text-left underline-offset-2 hover:underline"
          >
            {item.title}
          </button>
        </p>
        {/* The copy-link and open-in-ADO buttons that used to sit here are
            gone: both live in the right-click menu now (for this card AND for
            every nested row), which keeps the card to its content. */}
        {busyLabel && (
          <span className="flex shrink-0 items-center gap-1 text-[9px] font-bold text-[#000080]">
            <Loader2 className="h-3 w-3 animate-spin" />
            {busyLabel}…
          </span>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-none">
        {/* WORK ITEM TYPE — the same grey "type" chip the nested rows use, so a
            type always reads as a type here and never as another state badge
            (those are the coloured ones). A bug keeps that shape but takes the
            maroon text and a bug glyph, which is what makes it obvious at a
            glance which cards in the list are bugs rather than stories. */}
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 bg-[#dfdfdf] px-1 py-px text-[9px] font-medium ring-1 ring-black/20",
            isBug ? "text-[#7a1212]" : "text-[#000080]",
          )}
          title={`Azure DevOps work item type: ${typeLabel}`}
        >
          {isBug && <Bug className="h-2.5 w-2.5" />}
          {typeLabel}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 px-1 py-px text-[9px] font-medium ring-1 ring-black/20",
            state.badge,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", state.dot)} />
          {item.state}
        </span>
        <TagChips item={item} />
        {/* Created date — inline with the other chips, so the card gains no
            height. Exact timestamp on hover. */}
        <CreatedStamp item={item} />
        <span
          className={cn(
            "ml-auto shrink-0 px-1 py-px text-[9px] font-medium ring-1 ring-black/20",
            area?.tag,
          )}
        >
          {area?.name}
        </span>
      </div>

      {/* Description — plain text only (see the note at the top of this file). */}
      <div className="w95-in mt-1.5 max-h-40 overflow-y-auto px-1.5 py-1 text-[11px] leading-snug">
        {item.description ? (
          <p className="whitespace-pre-wrap break-words">{item.description}</p>
        ) : (
          <p className="text-[#606060]">
            This work item has no description in Azure DevOps.
          </p>
        )}
      </div>

      {/* Nested work items — COLLAPSED by default, and fetched only on the
          first expand (the count on the toggle comes from a separate, cheap
          relations call, so it is known while collapsed). */}
      {(showNestedToggle || showAddTask || expanded) && (
      <div className="mt-1.5">
        {/* Rendered only when there is at least one button to put in it, so a
            bug's card doesn't carry an empty toolbar row's worth of space. */}
        {(showNestedToggle || showAddTask) && (
        <div className="flex flex-wrap items-center gap-1">
          {showNestedToggle && (
          <button
            type="button"
            className="w95-btn h-auto py-0.5 text-[10px]"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            title={
              expanded
                ? "Hide this work item's nested items"
                : "Show this work item's nested items (loads them from Azure DevOps the first time)"
            }
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <ListTree className="h-3 w-3" />
            Nested work items
            <span className="font-normal">
              {childCount !== null
                ? `(${childCount})`
                : countsLoading
                  ? "(…)"
                  : "(count unavailable)"}
            </span>
          </button>
          )}
          {/* Sits beside the expand toggle because it adds to exactly that
              list: a real Task or User Story created under this item. */}
          {showAddTask && (
          <button
            type="button"
            className="w95-btn h-auto py-0.5 text-[10px]"
            onClick={onAddTask}
            title="Create a new nested work item (writes to Azure DevOps)"
          >
            <ListPlus className="h-3 w-3" />
            New nested item
          </button>
          )}
        </div>
        )}
        {!expanded ? null : childrenLoading ? (
          <p className="mt-1 flex items-center gap-1 text-[10px] text-[#404040]">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading nested items from
            Azure DevOps…
          </p>
        ) : childrenError ? (
          <div className="mt-1">
            <ErrorState
              title="Couldn't load nested work items"
              description={childrenError}
              action={
                <button type="button" className="w95-btn" onClick={onRetryChildren}>
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </button>
              }
            />
          </div>
        ) : childItems.length === 0 ? (
          <p className="mt-1 text-[10px] text-[#606060]">
            This work item has no nested work items in Azure DevOps.
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-0.5">
            {childItems.map((child, i) => (
              <ChildRow
                key={child.id}
                child={child}
                zebra={i % 2 === 1}
                busyLabel={writing[child.id] ?? null}
                photoUrl={
                  photos[normalizeIdentityEmail(child.assigneeEmail) ?? ""]
                }
                onContextMenu={(x, y) => onChildContextMenu(child, x, y)}
                onOpen={() => onOpenChild(child)}
                onPrefetch={() => onPrefetchChild(child)}
                onCancelPrefetch={onCancelPrefetch}
              />
            ))}
          </ul>
        )}
      </div>
      )}
    </div>
  );
}

function ChildRow({
  child,
  zebra,
  busyLabel,
  photoUrl,
  onContextMenu,
  onOpen,
  onPrefetch,
  onCancelPrefetch,
}: {
  child: ChildWorkItem;
  zebra: boolean;
  /** Non-null while a write for this nested item is in flight with ADO. */
  busyLabel: string | null;
  photoUrl?: string;
  /** Right-click: the SAME context menu the board cards use. */
  onContextMenu: (x: number, y: number) => void;
  onOpen: () => void;
  onPrefetch: () => void;
  onCancelPrefetch: () => void;
}) {
  const state = stateMeta(child.state);
  const tagVisualFrameClass = useTagVisualFrameClasses(child);
  const busy = Boolean(busyLabel);
  /**
   * Is this nested row a BUG? Compared against Azure DevOps' own type string
   * (case- and whitespace-insensitively, the same way the app matches tags),
   * so it never depends on how the type happens to be capitalised.
   */
  const isBugChild =
    (child.workItemType ?? "").trim().toLowerCase() ===
    MY_BUG_WORK_ITEM_TYPE.toLowerCase();
  /**
   * Finished work (Closed / Removed / Resolved and the other templates'
   * equivalents) is de-emphasised as well as sorted to the bottom.
   *
   * Greyed a STEP, not switched off: #6f6f6f on the row's own background still
   * reads comfortably, where 95's true disabled grey (#808080 with a white
   * emboss) would say "you can't use this" — which would be a lie, since every
   * right-click action still works on these rows. The STATE BADGE deliberately
   * keeps its full colour: it is the thing that explains why the row is grey,
   * so fading it too would remove the answer along with the emphasis.
   */
  const finished = isFinishedState(child.state);
  // Nested rows get the same selection marker as the cards above them. The
  // navy ring reads clearly over a greyed finished row without undoing the
  // greying — the wash is translucent and the text keeps its own colour.
  const menuTarget = useIsMenuTarget(child.id);
  return (
    <li
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onOpen();
      }}
      onPointerEnter={onPrefetch}
      onPointerLeave={onCancelPrefetch}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return; // a write is already in flight for this item
        onContextMenu(e.clientX, e.clientY);
      }}
      title={
        busy
          ? `${busyLabel} — writing to Azure DevOps…`
          : "Right-click for actions (writes to Azure DevOps)"
      }
      className={cn(
        "w95-interactive relative flex items-center gap-1.5 px-1.5 py-0.5 ring-1 ring-black/10",
        // A nested BUG takes the same grey-red tint the top-level bug cards
        // do (same ΔE00 5.7 shift, per band), so "bug" looks like one thing
        // everywhere in this tab. FINISHED rows keep their plain greyed
        // surface untinted — those are deliberately de-emphasised and sunk to
        // the bottom, and colouring them would undo exactly that.
        isBugChild && !finished
          ? zebra
            ? "bg-[#e9dcdb]"
            : "bg-[#d6c9c8]"
          : zebra
            ? "bg-[#e4e1dc]"
            : "bg-[#cfccc7]",
        busy ? "cursor-wait" : "cursor-pointer",
        // The title and the assignee name inherit this, so one class carries
        // most of the de-emphasis.
        finished && "text-[#6f6f6f]",
        menuTarget && "w95-menutarget",
        tagVisualFrameClass,
      )}
    >
      <span
        className={cn(
          "shrink-0 px-1 py-px text-[9px] font-medium ring-1 ring-black/20 bg-[#dfdfdf]",
          finished ? "text-[#6a6a7a]" : "text-[#000080]",
        )}
      >
        {child.workItemType ?? "Work item"}
      </span>
      <TagChips item={child} />
      <span className="min-w-0 flex-1 truncate text-[10px]" title={child.title}>
        {child.title}
      </span>
      <span
        className={cn(
          "shrink-0 font-mono text-[9px]",
          finished ? "text-[#8a8a8a]" : "text-[#404040]",
        )}
      >
        {child.id}
      </span>
      {/* Created date for the nested row too, greyed with the rest of the row
          when the child is in a finished state so it doesn't fight the sunk,
          muted styling those rows already carry. */}
      <CreatedStamp item={child} muted={finished} />
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 px-1 py-px text-[9px] font-medium ring-1 ring-black/20",
          state.badge,
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", state.dot)} />
        {child.state || "Unknown state"}
      </span>
      <ChildAssignee name={child.assignee} photoUrl={photoUrl} />
      {/* No link button here either — "Open in Azure DevOps" and "Copy link"
          are both on this row's right-click menu. */}
      {busy && (
        <span className="flex shrink-0 items-center gap-1 text-[9px] font-bold text-[#000080]">
          <Loader2 className="h-3 w-3 animate-spin" />
          {busyLabel}…
        </span>
      )}
    </li>
  );
}

/** The child's owner: real profile photo when one resolved, else a safe fallback. */
function ChildAssignee({
  name,
  photoUrl,
}: {
  name: string | null;
  photoUrl?: string;
}) {
  const displayName = name ?? "Unassigned";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-[9px]",
        !name && "text-[#606060]",
      )}
    >
      <PersonAvatar
        name={displayName}
        photoUrl={photoUrl}
        className="h-4 w-4"
      />
      <span className="max-w-[9rem] truncate">{displayName}</span>
    </span>
  );
}
