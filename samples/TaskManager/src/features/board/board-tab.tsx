import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Filter, Inbox, Link2, Search, Tags, Users, X } from "lucide-react";
import { PersonAvatar as EngineerAvatar } from "@/components/person-avatar";
import { Input } from "@/components/ui/input";
import { MaximizeButton, SectionHeading } from "@/components/w95-chrome";
import { matchesFilter } from "@/features/board/board-search";
import { CardDropSlot, StoryCard } from "@/features/board/story-card";
import type { CardMenuState } from "@/features/work-items/card-menu";
import type { WorkItemWrites } from "@/features/work-items/use-work-item-writes";
import { openWorkItemDetails } from "@/features/work-items/work-item-actions";
import { useDragAutoScroll } from "@/hooks/use-drag-auto-scroll";
import type { useWorkItemDetailPrefetch } from "@/hooks/use-work-item-detail-prefetch";
import { categoryAreaPath, isKnownAreaCode, type AdoConfig, type WorkItemWrite } from "@/lib/ado";
import { appLink } from "@/lib/app-links";
import { copyLinkToClipboard } from "@/lib/clipboard";
import type { EngineerSection } from "@/lib/engineer-identity";
import { usePersonPhotos } from "@/lib/people-photos";
import { isUnassignedPersonName } from "@/lib/person-display";
import { planRank } from "@/lib/stack-rank";
import { useAppStore } from "@/lib/store";
import { normalizeTag, useTagConfig } from "@/lib/tag-config";
import { useResponsiveColumns, type ColumnStep } from "@/lib/use-columns";
import { cn } from "@/lib/utils";
import {
  AREAS,
  OTHER_AREA_CODE,
  areaMeta,
  sortByStackRank,
  type WorkItem,
} from "@/lib/work-items-data";

/**
 * The column counts a MAXIMIZED window's card list uses, mirroring the Tailwind
 * classes on maximized backlog lists.
 */
const BOARD_COLUMNS: ColumnStep[] = [
  { minWidth: 0, columns: 1 },
  { minWidth: 768, columns: 2 },
  { minWidth: 1280, columns: 3 },
  { minWidth: 1900, columns: 4 },
  { minWidth: 2400, columns: 5 },
];

/**
 * BOARD tab — engineers (assigned work) above, backlog categories below, with
 * drag-and-drop reassignment/re-ranking, a URL-synced filter, a resizable split
 * and the 95 maximize/restore gesture on every window.
 */
export function BoardTab({
  items,
  config,
  allEngineerSections,
  writes,
  detailPrefetch,
  menuOpen,
  onOpenMenu,
  onCloseMenu,
}: {
  items: WorkItem[];
  config: AdoConfig;
  allEngineerSections: EngineerSection[];
  writes: WorkItemWrites;
  detailPrefetch: ReturnType<typeof useWorkItemDetailPrefetch>;
  menuOpen: boolean;
  onOpenMenu: (menu: CardMenuState) => void;
  onCloseMenu: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { writing, writeItem, writeItems } = writes;
  const tab = "board";
  const urlItemFilter = searchParams.get("search") ?? "";
  const [boardSearchInput, setBoardSearchInput] = useState(urlItemFilter);
  const boardSearchInputRef = useRef(urlItemFilter);
  const itemFilter = useDeferredValue(boardSearchInput);

  // Work item filter — case-insensitive substring over each item's title,
  // description, tags and configured tag display labels, applied across both
  // the engineer sections and backlog category columns.
  //
  // The needle is trimmed and lowercased ONCE here, per keystroke, rather than
  // inside the per-item matcher — the matcher runs once per work item on the
  // board for every character typed, so nothing avoidable belongs in it.
  const needle = itemFilter.trim().toLowerCase();
  const filterActive = needle.length > 0;
  const searchInputActive = boardSearchInput.trim().length > 0;
  // The filter box itself, so Ctrl-F can put the caret in it (see below).
  const itemFilterRef = useRef<HTMLInputElement>(null);

  const setBoardSearch = useCallback(
    (value: string) => {
      boardSearchInputRef.current = value;
      setBoardSearchInput(value);
    },
    [],
  );

  const copyBoardSearchLink = useCallback(async () => {
    const sharedSearch = boardSearchInput.trim();
    if (!sharedSearch) return;
    const label = `Task Manager Board: ${sharedSearch}`;
    try {
      const how = await copyLinkToClipboard({ url: appLink({ tab: "board", search: sharedSearch }), label });
      toast.success("Copied Board search link", {
        description:
          how === "rich"
            ? `Named link copied for “${sharedSearch}”.`
            : `Plain-text link copied for “${sharedSearch}”.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "The browser blocked the copy.";
      toast.error("Couldn't copy the Board search link", { description: message });
    }
  }, [boardSearchInput]);

  // Independent scroll regions (Engineers / Backlog), each with
  // edge auto-scroll so a card can be dragged to an off-screen target.
  const engineersScroll = useDragAutoScroll();
  const backlogScroll = useDragAutoScroll();
  const [showBoardTagVisuals, setShowBoardTagVisuals] = useState(true);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<string | null>(null);
  const dropZoneRef = useRef<string | null>(null);
  const setActiveDropZone = useCallback((zone: string | null) => {
    if (dropZoneRef.current === zone) return;
    dropZoneRef.current = zone;
    setDropZone(zone);
  }, []);
  const clearDragTargets = useCallback(() => {
    setActiveDropZone(null);
  }, [setActiveDropZone]);
  const [boardSplit, setBoardSplit] = useState(5 / 9);
  const engineersRegionRef = useRef<HTMLElement>(null);
  const backlogRegionRef = useRef<HTMLElement>(null);
  const resizeStartRef = useRef<{
    pointerId: number;
    y: number;
    engineerHeight: number;
    totalHeight: number;
  } | null>(null);
  /**
   * MAXIMIZED SECTION — the classic 95 maximize/restore gesture on the Board.
   *
   * Holds the drop-zone key of the ONE window that is currently maximized
   * (`eng:<identity>` or `area:<code>`), or null when the board is in its
   * normal two-region layout. Only one window can be maximized at a time, by
   * construction: this is a single value, not a set.
   *
   * WHAT MAXIMIZE DOES (the choice made here): the maximized window takes over
   * the WHOLE board area — its own region grows to fill the space both regions
   * shared, the other region and the groove between them are hidden, and the
   * region's grid drops to a single full-height column. That is the closest
   * thing to a real 95 maximize (the window fills its workspace), and it is the
   * option that adds the most vertical room for work items.
   *
   * It is done ENTIRELY with the flex/grid shares the board already uses — the
   * maximized region swaps its `flex-[5]`/`flex-[4]` share for `flex-1` and
   * keeps `min-h-0` on its scroll viewport. No viewport-relative height (`vh`)
   * is introduced anywhere, so the old "region clipped off the bottom of the
   * fixed-height shell" bug cannot come back.
   */
  const [maximized, setMaximized] = useState<string | null>(null);
  const toggleMaximized = useCallback(
    (zone: string) => setMaximized((current) => (current === zone ? null : zone)),
    [],
  );
  const maximizedIsEngineer = maximized?.startsWith("eng:") ?? false;
  const maximizedIsArea = maximized?.startsWith("area:") ?? false;
  /**
   * How many columns a MAXIMIZED window's card list is showing. Read only to
   * stripe the cards by row (the layout itself is the Tailwind `grid-cols-*`
   * classes on the list, which these steps mirror — keep the two in sync).
   */
  const boardColumns = useResponsiveColumns(BOARD_COLUMNS);

  useEffect(() => {
    boardSearchInputRef.current = urlItemFilter;
    setBoardSearchInput(urlItemFilter);
  }, [urlItemFilter]);

  useEffect(() => {
    if (tab !== "board" || boardSearchInput === urlItemFilter) return;
    const timeout = window.setTimeout(() => {
      if (boardSearchInputRef.current !== boardSearchInput) return;
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("tab", "board");
          if (boardSearchInput) next.set("search", boardSearchInput);
          else next.delete("search");
          return next;
        },
        { replace: true },
      );
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [boardSearchInput, setSearchParams, tab, urlItemFilter]);

  /** One cached list drives every configured tag action and visual. */
  const { tags: allTags } = useTagConfig();
  const configuredTagLabels = useMemo(
    () =>
      new Map(
        allTags.map((tag) => [
          normalizeTag(tag.tag),
          tag.label.trim().toLowerCase(),
        ]),
      ),
    [allTags],
  );

  /**
   * ESCAPE RESTORES a maximized section — the second way back, alongside
   * double-clicking the title bar again and the restore button in the window's
   * own title bar.
   *
   * Deliberately inert whenever anything else owns Escape (a detail/connection/
   * error dialog, or the card context menu), so it can never steal the key from
   * a dialog the user is actually trying to close.
   */
  useEffect(() => {
    if (!maximized) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (
        useAppStore.getState().selectedWorkItemId ||
        menuOpen ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        return;
      }
      setMaximized(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maximized, menuOpen]);

  /**
   * CTRL-F (⌘F on a Mac) PUTS THE CARET IN THE BOARD'S FILTER BOX, and
   * selects whatever is already in it so the next keystroke replaces it — the
   * "find" the board actually has, in place of the browser's own find bar,
   * which searches the rendered page rather than the work items and can't see
   * a card that hasn't been scrolled into view.
   *
   * `preventDefault()` is what suppresses the browser dialog, so it is called
   * ONLY on the paths that really do focus the box — every guard below returns
   * first, leaving the browser's own Find untouched:
   *   • the BOARD has to be the active tab (this filter is the board's; the
   *     other tabs don't have one),
   *   • focus must not already be in a text field — including the filter box
   *     itself — so Ctrl-F while typing still reaches the browser,
   *   • nothing modal may be open: a detail / connection / error dialog or the
   *     card context menu (mirrors the Escape guard above), plus a DOM check
   *     for any other open dialog, which covers the confirmation dialog and
   *     anything a panel opens for itself.
   *
   * "My Work" deliberately gets no equivalent: it has no filter box to focus.
   */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "f") return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (
        useAppStore.getState().selectedWorkItemId ||
        menuOpen ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return;
      }
      const input = itemFilterRef.current;
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  // Filtered view of the same sections — every engineer stays visible (they are
  // drop targets) but their lists show only matching cards while a filter is on.
  const engineerSections = useMemo(
    () =>
      filterActive
        ? allEngineerSections.map((section) => ({
            ...section,
            total: section.items.length,
            // `all` keeps the UNFILTERED, StackRank-ordered list beside the
            // visible one: a drop between two visible cards has to be resolved
            // against the real list, or a rank picked between two filtered
            // neighbours would ignore the hidden cards in between.
            all: section.items,
            items: section.items.filter((it) =>
              matchesFilter(it, needle, configuredTagLabels),
            ),
          }))
        : allEngineerSections.map((section) => ({
            ...section,
            total: section.items.length,
            all: section.items,
          })),
    [allEngineerSections, configuredTagLabels, filterActive, needle],
  );

  const engineerMatchCount = useMemo(
    () => engineerSections.reduce((sum, s) => sum + s.items.length, 0),
    [engineerSections],
  );


  const photos = usePersonPhotos(
    useMemo(
      () =>
        Array.from(
          new Set(
            allEngineerSections
              .map((e) => e.email)
              .filter((e): e is string => Boolean(e)),
          ),
        ),
      [allEngineerSections],
    ),
  );

  // Unassigned stories bucketed by category. The configured areas
  // always render; any other sub-area (or an uncategorized item)
  // surfaces as its own column so nothing fetched is hidden.
  const backlogColumns = useMemo(() => {
    const map = new Map<string, WorkItem[]>();
    for (const a of AREAS) map.set(a.code, []);
    for (const it of items) {
      if (it.assignee) continue;
      const code = it.area || OTHER_AREA_CODE;
      const bucket = map.get(code) ?? [];
      bucket.push(it);
      map.set(code, bucket);
    }
    const known = AREAS.map((a) => a.code);
    const extras = [...map.keys()]
      .filter((c) => !known.includes(c))
      .sort((a, b) => a.localeCompare(b));
    // Every category column lists its work items in backlog (StackRank) order,
    // so a column matches the ordering shown in the ADO backlog.
    return [...known, ...extras].map((code) => ({
      meta: areaMeta(code),
      items: sortByStackRank(map.get(code) ?? []),
    }));
  }, [items]);

  // Filter applied AFTER the StackRank sort, so backlog order is
  // preserved within the matches. `total` keeps the unfiltered column size so
  // the header can show "3 of 27" while a filter is on.
  const filteredBacklogColumns = useMemo(
    () =>
      backlogColumns.map((col) => ({
        meta: col.meta,
        total: col.items.length,
        // Unfiltered column, for the same reason as the engineer sections: a
        // positional drop is resolved against the real StackRank order.
        all: col.items,
        items: filterActive
          ? col.items.filter((it) =>
              matchesFilter(it, needle, configuredTagLabels),
            )
          : col.items,
      })),
    [backlogColumns, configuredTagLabels, filterActive, needle],
  );

  const backlogMatchCount = useMemo(
    () => filteredBacklogColumns.reduce((sum, c) => sum + c.items.length, 0),
    [filteredBacklogColumns],
  );
  const backlogTotalCount = useMemo(
    () => filteredBacklogColumns.reduce((sum, c) => sum + c.total, 0),
    [filteredBacklogColumns],
  );

  // SAFETY NET for the maximize gesture: if the maximized window's section stops
  // existing between refreshes (an engineer with no work items left drops out of
  // the board entirely), the board would otherwise be left showing an empty
  // region with the other one hidden. Restoring automatically is the honest
  // behaviour — there is no window left to maximize.
  useEffect(() => {
    if (!maximized) return;
    const stillThere =
      engineerSections.some((s) => `eng:${s.key}` === maximized) ||
      filteredBacklogColumns.some((c) => `area:${c.meta.code}` === maximized);
    if (!stillThere) setMaximized(null);
  }, [maximized, engineerSections, filteredBacklogColumns]);

  /**
   * Drop a card at a POSITION inside a list (between two cards) rather than
   * just onto a section.
   *
   * Within the item's own list this is a pure re-order: one new StackRank,
   * strictly between its new neighbours, written to Azure DevOps through the
   * same path as every other edit. Dropped at a position in a DIFFERENT list it
   * does both jobs in ONE atomic write — the reassignment (or the move to a
   * backlog category) AND the rank — so the card lands exactly where it was
   * dropped instead of being reassigned and then jumping to wherever its old
   * rank happens to put it.
   *
   * `full` is the list's real StackRank order and `visible` what the title
   * filter is currently showing; the insertion index arrives in VISIBLE terms
   * and is translated onto the real list here.
   */
  function dropAtPosition(
    id: string,
    full: WorkItem[],
    visible: WorkItem[],
    visibleIndex: number,
    target:
      | { kind: "engineer"; name: string; email: string | null }
      | { kind: "area"; code: string },
  ) {
    setDraggedId(null);
    clearDragTargets();
    // The pointer-up is resolved centrally, so stop either region's independent
    // edge-scroll loop before applying the write.
    engineersScroll.stop();
    backlogScroll.stop();
    const moved = items.find((it) => it.id === id);
    if (!moved) return;

    // "Insert before this visible card" -> its index in the real list; a drop
    // past the last visible card means the end of the real list.
    const anchor = visibleIndex < visible.length ? visible[visibleIndex] : null;
    const anchorIndex = anchor ? full.findIndex((it) => it.id === anchor.id) : -1;
    const index = anchorIndex >= 0 ? anchorIndex : full.length;

    const from = full.findIndex((it) => it.id === id);
    const sameList = from >= 0;
    // Dropped either side of where it already sits: nothing would move, so
    // nothing is written.
    if (sameList && (index === from || index === from + 1)) return;

    // The section change this drop also implies (none when it's a re-order
    // inside the card's own list).
    const optimistic: Partial<WorkItem> = {};
    const write: WorkItemWrite = {};
    const labels: string[] = [];
    if (target.kind === "engineer") {
      if (moved.assignee !== target.name) {
        optimistic.assignee = target.name;
        optimistic.assigneeEmail = target.email;
        write.assignee = { name: target.name, email: target.email };
        labels.push(`Assign to ${target.name}`);
      }
    } else {
      if (moved.assignee) {
        optimistic.assignee = null;
        optimistic.assigneeEmail = null;
        write.assignee = { name: null, email: null };
        labels.push("Move to backlog");
      }
      if (target.code !== moved.area && isKnownAreaCode(target.code)) {
        const path = categoryAreaPath(target.code, config.areaRoot);
        optimistic.area = target.code;
        optimistic.areaPath = path;
        write.areaPath = path;
        labels.push(`Set area to ${target.code}`);
      }
    }

    const others = full.filter((it) => it.id !== id);
    const insertAt = sameList && index > from ? index - 1 : index;
    const plan = planRank(others, insertAt, moved);
    labels.push("Reorder");

    if (plan.kind === "single") {
      void writeItem(
        id,
        { ...optimistic, stackRank: plan.rank },
        { ...write, stackRank: plan.rank },
        labels.join(" · "),
      );
      return;
    }

    // Renormalize: the gap couldn't be bisected (equal or missing ranks, or a
    // gap too small for floating point), so this list's order is written down
    // evenly spaced. The dragged card carries its section change with it.
    const changes = plan.ranks.map((entry) =>
      entry.id === id
        ? {
            id,
            optimistic: { ...optimistic, stackRank: entry.rank },
            write: { ...write, stackRank: entry.rank },
          }
        : {
            id: entry.id,
            optimistic: { stackRank: entry.rank } as Partial<WorkItem>,
            write: { stackRank: entry.rank } as WorkItemWrite,
          },
    );
    void writeItems(changes, `${labels.join(" · ")} · re-space list`);
  }

  // Drop onto an engineer: write the new owner to [System.AssignedTo]. The
  // identity (email/UPN) moves with the work item — otherwise the dropped item
  // would keep its previous owner's address and regroup under that identity.
  function dropOnEngineer(
    id: string,
    assignee: string,
    assigneeEmail: string | null,
  ) {
    setDraggedId(null);
    clearDragTargets();
    engineersScroll.stop();
    backlogScroll.stop();
    const item = items.find((it) => it.id === id);
    if (!item || item.assignee === assignee) return; // nothing to write
    void writeItem(
      id,
      { assignee, assigneeEmail },
      { assignee: { name: assignee, email: assigneeEmail } },
      `Assign to ${assignee}`,
    );
  }

  // Drop onto a backlog category: clear [System.AssignedTo], and when the card
  // lands in a DIFFERENT known category also write that category's area path —
  // otherwise the card would visibly move to a column ADO never put it in.
  function dropOnCategory(id: string, areaCode: string) {
    setDraggedId(null);
    clearDragTargets();
    engineersScroll.stop();
    backlogScroll.stop();
    const item = items.find((it) => it.id === id);
    if (!item) return;

    const optimistic: Partial<WorkItem> = {};
    const write: WorkItemWrite = {};
    const labels: string[] = [];

    if (item.assignee) {
      optimistic.assignee = null;
      optimistic.assigneeEmail = null;
      write.assignee = { name: null, email: null };
      labels.push("Move to backlog");
    }
    // Only known categories have a derivable area path; an "Other"/unknown
    // column stays a pure unassign rather than inventing a path.
    if (areaCode !== item.area && isKnownAreaCode(areaCode)) {
      const path = categoryAreaPath(areaCode, config.areaRoot);
      optimistic.area = areaCode;
      optimistic.areaPath = path;
      write.areaPath = path;
      labels.push(`Set area to ${areaCode}`);
    }
    if (labels.length === 0) return; // nothing would change in ADO

    void writeItem(id, optimistic, write, labels.join(" · "));
  }

  function cancelBoardDrag() {
    setDraggedId(null);
    clearDragTargets();
    engineersScroll.stop();
    backlogScroll.stop();
  }

  function dropAtPoint(id: string, clientX: number, clientY: number) {
    const hit = document.elementFromPoint(clientX, clientY);
    const zoneElement = hit?.closest<HTMLElement>("[data-board-drop-zone]");
    const zone = zoneElement?.dataset.boardDropZone;
    if (!zoneElement || !zone) {
      cancelBoardDrag();
      return;
    }

    const slot = hit?.closest<HTMLElement>("[data-board-drop-slot]");
    const slotBelongsToZone =
      slot?.closest<HTMLElement>("[data-board-drop-zone]") === zoneElement;
    let insertionIndex: number | null = null;
    if (slot && slotBelongsToZone) {
      const baseIndex = Number(slot.dataset.boardDropSlot);
      const rect = slot.getBoundingClientRect();
      const multiColumn = slot.dataset.boardDropMultiColumn === "true";
      const pastMidpoint = multiColumn
        ? clientX > rect.left + rect.width / 2
        : clientY > rect.top + rect.height / 2;
      if (Number.isInteger(baseIndex)) {
        insertionIndex = baseIndex + (pastMidpoint ? 1 : 0);
      }
    }

    if (zone.startsWith("eng:")) {
      const section = engineerSections.find(({ key }) => `eng:${key}` === zone);
      if (!section) {
        cancelBoardDrag();
        return;
      }
      if (insertionIndex !== null) {
        dropAtPosition(id, section.all, section.items, insertionIndex, {
          kind: "engineer",
          name: section.name,
          email: section.email,
        });
      } else {
        dropOnEngineer(id, section.name, section.email);
      }
      return;
    }

    if (zone.startsWith("area:")) {
      const column = filteredBacklogColumns.find(
        ({ meta }) => `area:${meta.code}` === zone,
      );
      if (!column) {
        cancelBoardDrag();
        return;
      }
      if (insertionIndex !== null) {
        dropAtPosition(id, column.all, column.items, insertionIndex, {
          kind: "area",
          code: column.meta.code,
        });
      } else {
        dropOnCategory(id, column.meta.code);
      }
      return;
    }

    cancelBoardDrag();
  }


  return (
    // The board owns its OWN bounded flex column instead of leaning
                // on the tab window's column via a bare fragment. `min-h-0`
                // (flex items default to `min-height:auto`, which is what stops
                // a child from ever shrinking) + `flex-1` is what gives the two
                // regions below a real, resolved height — the precondition for
                // each of them scrolling independently.
                <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* Work item filter — case-insensitive substring over each card's
                title, description, tags and configured tag labels, across both
                the engineer sections and the backlog columns. */}
            <div className="w95-panel flex shrink-0 flex-wrap items-center gap-2 px-2 py-2">
              <div className="relative min-w-[16rem] flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#808080]" />
                <Input
                  ref={itemFilterRef}
                  value={boardSearchInput}
                  onChange={(e) => setBoardSearch(e.target.value)}
                  placeholder="Filter by title, description, or tag…"
                  aria-label="Filter work items by title, description, tag, or configured tag label"
                  // Says what is searched, and where the shortcut lands — Ctrl-F
                  // no longer opens the browser's find bar while the Board is
                  // open.
                  title="Filter work items by title, description, tag, or configured tag label — press Ctrl-F (⌘F on a Mac) to jump here"
                  className="w95-search-input h-[22px]"
                />
                {searchInputActive && (
                  <button
                    type="button"
                    onClick={() => setBoardSearch("")}
                    aria-label="Clear filter"
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-black"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="w95-btn flex h-[22px] w-[26px] shrink-0 items-center justify-center p-0"
                onClick={() => void copyBoardSearchLink()}
                disabled={!searchInputActive}
                aria-label="Copy a link to this Board search"
                title={
                  searchInputActive
                    ? `Copy a link that opens the Board filtered by “${boardSearchInput.trim()}”`
                    : "Enter a search to copy a filtered Board link"
                }
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
              {filterActive ? (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="w95-status inline-flex items-center gap-1.5 font-bold">
                    <Filter className="h-3 w-3" />
                    Filtering by title, description, and tags — engineers and backlog
                  </span>
                  <span className="w95-status">
                    <span className="font-bold">
                      {backlogMatchCount.toLocaleString()}
                    </span>{" "}
                    of {backlogTotalCount.toLocaleString()} backlog{" "}
                    {backlogTotalCount === 1 ? "work item" : "work items"} ·{" "}
                    <span className="font-bold">
                      {engineerMatchCount.toLocaleString()}
                    </span>{" "}
                    assigned {engineerMatchCount === 1 ? "match" : "matches"}
                  </span>
                  <button
                    type="button"
                    className="w95-btn"
                    onClick={() => setBoardSearch("")}
                  >
                    Clear filter
                  </button>
                </div>
              ) : (
                <span className="w95-status text-[11px]">
                  Showing all work items — type to match titles, descriptions,
                  tags, or configured tag labels (case-insensitive).
                </span>
              )}
            </div>

            {/* Engineers — the larger of the two flex SHARES of the board
                column (3fr here vs 2fr for the backlog). Sharing the column
                (rather than "engineers take what's left, backlog is a rigid
                viewport fraction") is what guarantees the two regions together
                can never exceed the fixed-height shell, so neither region's
                scroll viewport is ever clipped off the bottom of the screen.
                `min-h-[7rem]` stops it collapsing on a short viewport. */}
            <section
              ref={engineersRegionRef}
              style={
                !maximized
                  ? { flexBasis: 0, flexGrow: boardSplit, flexShrink: 1 }
                  : undefined
              }
              className={cn(
                "flex flex-col",
                // A maximized BACKLOG window owns the whole board area, so this
                // region steps aside entirely; a maximized ENGINEER window
                // makes this region take that whole area (still a flex share of
                // the bounded column — never a viewport height).
                maximizedIsArea && "hidden",
                maximizedIsEngineer
                  ? "min-h-0 flex-1"
                  : "min-h-[7rem]",
              )}
            >
          <SectionHeading
            icon={<Users className="h-3 w-3" />}
            title="Engineers"
            subtitle={
              filterActive
                ? `Owned work items matching “${itemFilter.trim()}”`
                : "Work items currently owned by each engineer"
            }
            action={
              <button
                type="button"
                className={cn(
                  "w95-btn h-auto shrink-0 px-1.5 py-0.5 text-[10px]",
                  showBoardTagVisuals && "w95-btn--on",
                )}
                aria-pressed={showBoardTagVisuals}
                onClick={() => setShowBoardTagVisuals((shown) => !shown)}
                title={
                  showBoardTagVisuals
                    ? "Tag visuals are shown — click to hide them"
                    : "Tag visuals are hidden — click to show them"
                }
              >
                <span aria-hidden="true" className="w-2 text-center font-bold">
                  {showBoardTagVisuals ? "✓" : ""}
                </span>
                <Tags className="h-3 w-3" />
                Tag visuals: {showBoardTagVisuals ? "Show" : "Hide"}
              </button>
            }
          />
          <div
            ref={engineersScroll.ref}
            onPointerMove={(e) => {
              if (draggedId !== null) engineersScroll.handlers.onPointerMove(e);
            }}
            onPointerLeave={engineersScroll.handlers.onPointerLeave}
            className={cn(
              "grid min-h-0 flex-1 grid-cols-1 gap-x-1.5 gap-y-2 overflow-y-auto pr-1",
              // Maximized: one full-width, full-height column (the grid's
              // default `align-content: stretch` gives the single auto row all
              // the height the region has).
              !maximizedIsEngineer &&
                "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1900px]:grid-cols-6 min-[2400px]:grid-cols-7",
            )}
          >
            {engineerSections
              .filter(({ key }) => !maximized || `eng:${key}` === maximized)
              .map(({ key, name, email, items: assigned, total }) => {
              const zone = `eng:${key}`;
              const active = dropZone === zone;
              const isMaximized = maximized === zone;
              return (
                <div
                  key={key}
                  data-board-drop-zone={zone}
                  onPointerMove={() => {
                    if (draggedId !== null) setActiveDropZone(zone);
                  }}
                  onPointerLeave={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const leftWindow =
                      e.clientX < rect.left ||
                      e.clientX > rect.right ||
                      e.clientY < rect.top ||
                      e.clientY > rect.bottom;
                    if (leftWindow) {
                      setActiveDropZone(null);
                    }
                  }}
                  className={cn(
                    "w95-window flex flex-col",
                    active && "w95-droptarget",
                  )}
                >
                  {/* Double-click the caption to maximize / restore, exactly
                      like a real 95 window. The count label and the restore
                      button below are part of the caption, so the gesture works
                      anywhere along it. */}
                  <div
                    className="w95-titlebar cursor-default select-none"
                    onDoubleClick={() => toggleMaximized(zone)}
                    title={
                      isMaximized
                        ? `Double-click to restore ${name}'s window (or press Escape)`
                        : `Double-click to maximize ${name}'s window`
                    }
                  >
                    <EngineerAvatar name={name} photoUrl={photos[email ?? ""]} />
                    <p
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        isUnassignedPersonName(name) && "text-[#d0d0d0]",
                      )}
                    >
                      {name}
                    </p>
                    {/* Plain LABEL, not a button: the count was never clickable,
                        so it no longer wears the raised `.w95-titlebtn` bevel. */}
                    <span className="ml-auto shrink-0 whitespace-nowrap px-1 text-[10px] font-normal">
                      {filterActive ? `${assigned.length} of ${total}` : assigned.length}{" "}
                      {(filterActive ? total : assigned.length) === 1
                        ? "work item"
                        : "work items"}
                    </span>
                    {/* The 95 maximize / restore control — the visible way back
                        that does not depend on knowing the double-click gesture
                        (Escape is the third). `stopPropagation` on its own
                        double-click keeps a fast double press on the BUTTON from
                        also firing the title bar's gesture, which would toggle
                        twice and appear to do nothing. */}
                    <MaximizeButton
                      maximized={isMaximized}
                      label={`${name}'s window`}
                      onClick={() => toggleMaximized(zone)}
                    />
                  </div>
                  {/* Bounded to roughly FOUR of the (now denser) cards: an
                      engineer with more than four work items gets a scroll bar
                      inside their window instead of a taller card, so every
                      engineer column stays the same compact height. */}
                  <div
                    className={cn(
                      "w95-in mt-[3px] min-h-0 flex-1 overflow-y-auto p-1",
                      // MAXIMIZED: the window is the whole board area, so the
                      // four-card cap is lifted. Engineer cards stay in one
                      // column and grow their typography and spacing so the
                      // focused person's work is easier to read. `auto-rows-min`
                      // keeps each card at
                      // height still comes from the region's flex share with
                      // `min-h-0` — no viewport-relative height, so the old
                      // clipping bug can't come back.
                      isMaximized
                        ? "grid auto-rows-min grid-cols-1 gap-2"
                        : "max-h-[9.5rem] space-y-1",
                    )}
                  >
                    {assigned.length === 0 ? (
                      <div className="flex h-full min-h-[72px] flex-col items-center justify-center gap-1 text-center text-[#404040]">
                        {filterActive && total > 0 ? (
                          <>
                            <Search className="h-5 w-5" />
                            <span className="text-[11px]">
                              No match · {total} hidden
                            </span>
                          </>
                        ) : (
                          <>
                            <Inbox className="h-5 w-5" />
                            <span className="text-[11px]">Drop a work item here</span>
                          </>
                        )}
                      </div>
                    ) : (
                      assigned.map((item, i) => (
                        <CardDropSlot
                          key={item.id}
                          index={i}
                          dragActive={draggedId !== null}
                          multiColumn={false}
                        >
                          <StoryCard
                            // Lets the card explain a description/tag-only match.
                            matchNeedle={filterActive ? needle : null}
                            // Striped by ROW: `i % 2` becomes a diagonal
                            // checkerboard once the list wraps into columns,
                            // whereas whole alternating rows still read as a 95
                            // list. Identical to the old stripes at 1 column.
                            zebra={i % 2 === 1}
                            enlarged={isMaximized}
                            item={item}
                            showTagVisuals={showBoardTagVisuals}
                            onPrefetch={() => detailPrefetch.prefetch(item)}
                            onCancelPrefetch={detailPrefetch.cancelPrefetch}
                            onDragStart={() => {
                              onCloseMenu();
                              setDraggedId(item.id);
                            }}
                            onDragEnd={() => {
                              cancelBoardDrag();
                            }}
                            onDropAtPoint={(x, y) => dropAtPoint(item.id, x, y)}
                            onOpen={() => openWorkItemDetails(item)}
                            onContextMenu={(x, y) =>
                              onOpenMenu({ id: item.id, x, y, kind: "board" })
                            }
                            dragging={draggedId === item.id}
                            busyLabel={writing[item.id] ?? null}
                          />
                        </CardDropSlot>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Classic 95 etched groove separating the two board regions, so the
            Engineers and Backlog areas read as distinct panels instead of one
            continuous grey field. */}
        {/* With one window maximized there is only ONE region on screen, so the
            groove between two regions has nothing left to separate. */}
        {!maximized && (
          <div
            className="w95-divider w95-divider--resize shrink-0"
            role="separator"
            aria-label="Resize Engineers and Backlog sections"
            aria-orientation="horizontal"
            aria-valuemin={20}
            aria-valuemax={80}
            aria-valuenow={Math.round(boardSplit * 100)}
            tabIndex={0}
            title="Drag to resize Engineers and Backlog"
            onPointerDown={(event) => {
              const engineers = engineersRegionRef.current;
              const backlog = backlogRegionRef.current;
              if (!engineers || !backlog) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              const engineerHeight = engineers.getBoundingClientRect().height;
              const totalHeight =
                engineerHeight + backlog.getBoundingClientRect().height;
              resizeStartRef.current = {
                pointerId: event.pointerId,
                y: event.clientY,
                engineerHeight,
                totalHeight,
              };
            }}
            onPointerMove={(event) => {
              const start = resizeStartRef.current;
              if (!start || start.pointerId !== event.pointerId) return;
              const nextEngineerHeight =
                start.engineerHeight + event.clientY - start.y;
              setBoardSplit(
                Math.min(0.8, Math.max(0.2, nextEngineerHeight / start.totalHeight)),
              );
            }}
            onPointerUp={(event) => {
              if (resizeStartRef.current?.pointerId !== event.pointerId) return;
              resizeStartRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              resizeStartRef.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              setBoardSplit((current) =>
                Math.min(
                  0.8,
                  Math.max(0.2, current + (event.key === "ArrowDown" ? 0.05 : -0.05)),
                ),
              );
            }}
          />
        )}

        {/* Backlogs by category — the last child of the fixed-height flex
            column, so it stays anchored to the bottom edge, and its grid is its
            own `overflow-y-auto` viewport that scrolls independently of the
            Engineers region above it.

            It takes a flex SHARE (2fr) rather than the old rigid `h-[34vh]`:
            that height was measured against the VIEWPORT, not the space left
            inside the fixed shell, so heading + 34vh + the engineers floor
            could overflow the column and `main`'s `overflow-hidden` clipped the
            bottom of this scroll viewport off-screen — which is exactly why the
            region appeared not to scroll. As a flex child with `min-h-0` on the
            grid it can only ever be as tall as the space actually available. */}
        <section
          ref={backlogRegionRef}
          style={
            !maximized
              ? { flexBasis: 0, flexGrow: 1 - boardSplit, flexShrink: 1 }
              : undefined
          }
          className={cn(
            "flex flex-col",
            // Mirror image of the Engineers region: a maximized ENGINEER window
            // owns the whole board area, so this region steps aside; a maximized
            // CATEGORY window makes this region take that whole area. Still a
            // flex share of the bounded column — never a viewport height, so the
            // old clipping bug cannot come back.
            maximizedIsEngineer && "hidden",
            maximizedIsArea ? "min-h-0 flex-1" : "min-h-[9rem]",
          )}
        >
          {/* Same treatment as the Engineers heading — the 95 icon tile plus a
              single compact row with the description inline, so the two board
              regions read as a matched pair. */}
          <SectionHeading
            icon={<Inbox className="h-3 w-3" />}
            title="Backlog"
            subtitle={
              filterActive
                ? `${backlogMatchCount.toLocaleString()} of ${backlogTotalCount.toLocaleString()} unassigned work items match “${itemFilter.trim()}”`
                : "Unassigned work items by category. Highest priority items at the top."
            }
          />
          {/* NO `content-start` here (deliberately).
 
              That was the "footer" at the bottom of the Board: there is no
              footer ELEMENT on this page at all — the shell is just the header
              plus <main>, and this region is the last thing in the flex column.
              `content-start` packs the grid's auto rows against the top, so
              every pixel the category windows didn't use showed up as an empty
              grey band under them, which reads exactly like a page footer. It
              grew when the per-category area-path strip was removed, because
              each window got shorter and handed even more height to the band.
 
              Letting `align-content` fall back to its `stretch` default hands
              that leftover height to the rows instead, so the category windows
              (and, with the list cap lifted below, their scroll viewports) fill
              the region and show more work items before scrolling. */}
          <div
            ref={backlogScroll.ref}
            onPointerMove={(e) => {
              if (draggedId !== null) backlogScroll.handlers.onPointerMove(e);
            }}
            onPointerLeave={backlogScroll.handlers.onPointerLeave}
            className={cn(
              "grid min-h-0 flex-1 grid-cols-1 gap-x-1.5 gap-y-2 overflow-y-auto pr-1",
              // Maximized: a single full-width, full-height column.
              !maximizedIsArea &&
                "md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5 min-[1900px]:grid-cols-6 min-[2400px]:grid-cols-8",
            )}
          >
            {filteredBacklogColumns
              .filter(({ meta: area }) => !maximized || `area:${area.code}` === maximized)
              .map(({ meta: area, items: backlog, total }) => {
              const zone = `area:${area.code}`;
              const active = dropZone === zone;
              const isMaximized = maximized === zone;
              return (
                <div
                  key={area.code}
                  data-board-drop-zone={zone}
                  onPointerMove={() => {
                    if (draggedId !== null) setActiveDropZone(zone);
                  }}
                  onPointerLeave={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const leftWindow =
                      e.clientX < rect.left ||
                      e.clientX > rect.right ||
                      e.clientY < rect.top ||
                      e.clientY > rect.bottom;
                    if (leftWindow) {
                      setActiveDropZone(null);
                    }
                  }}
                  className={cn(
                    "w95-window flex flex-col overflow-hidden",
                    active && "w95-droptarget",
                  )}
                >
                  {/* 95 title bar, but the category keeps its own colour via
                      the swatch (and the card's left edge) so the four
                      categories stay instantly distinguishable. */}
                  {/* Double-click the caption to maximize / restore, exactly
                      like the engineer windows above. */}
                  <div
                    className="w95-titlebar cursor-default select-none"
                    onDoubleClick={() => toggleMaximized(zone)}
                    title={
                      isMaximized
                        ? `Double-click to restore the ${area.name} window (or press Escape)`
                        : `Double-click to maximize the ${area.name} window`
                    }
                  >
                    <span
                      className={cn(
                        "h-3 w-3 shrink-0 ring-1 ring-black/60",
                        area.swatch,
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{area.name}</span>
                    {/* Plain LABEL, exactly like the engineer windows: the
                        count was never clickable, so it wears no button bevel. */}
                    <span className="ml-auto shrink-0 whitespace-nowrap px-1 text-[10px] font-normal">
                      {filterActive ? `${backlog.length} of ${total}` : backlog.length}{" "}
                      {(filterActive ? total : backlog.length) === 1
                        ? "work item"
                        : "work items"}
                    </span>
                    <MaximizeButton
                      maximized={isMaximized}
                      label={`the ${area.name} window`}
                      onClick={() => toggleMaximized(zone)}
                    />
                  </div>
                  {/* The sunken area-path status strip that used to sit under
                      this title bar is gone: it was a full status-bar-styled
                      line of chrome per category window, and dropping it hands
                      that height straight to the list below (more work items
                      visible in every category). The area path is still on each
                      work item's detail dialog, so nothing is lost. */}
                  {/* No max-height cap: the row is now stretched by the grid
                      (see the note on the grid above), so `flex-1` + `min-h-0`
                      lets this viewport take the FULL height of its window —
                      that's what turns the reclaimed footer space into visible
                      work items. It still scrolls on overflow, and the old
                      clipping problem the cap was guarding against can't recur:
                      the height now comes from the region, not from content. */}
                  <div
                    className={cn(
                      "w95-in mt-[3px] min-h-0 flex-1 overflow-y-auto p-1",
                      // MAXIMIZED: same treatment as the engineer windows — the
                      // cards flow into as many columns as the width allows,
                      // in reading order, so a maximized category shows far more
                      // of its backlog at once. `auto-rows-min` keeps the cards
                      // at their natural height; the region's flex share plus
                      // `min-h-0` still own the height (never the viewport).
                      isMaximized
                        ? "grid auto-rows-min grid-cols-1 gap-1 md:grid-cols-2 xl:grid-cols-3 min-[1900px]:grid-cols-4 min-[2400px]:grid-cols-5"
                        : "space-y-1",
                    )}
                  >
                    {backlog.length === 0 ? (
                      <div className="flex min-h-[84px] flex-col items-center justify-center gap-1 px-2 text-center text-[#404040]">
                        {filterActive && total > 0 ? (
                          <>
                            <Search className="h-5 w-5" />
                            <span className="text-[11px]">
                              No match · {total} hidden
                            </span>
                          </>
                        ) : (
                          <>
                            <Inbox className="h-5 w-5" />
                            <span className="text-[11px]">Backlog empty</span>
                          </>
                        )}
                      </div>
                    ) : (
                      backlog.map((item, i) => (
                        <CardDropSlot
                          key={item.id}
                          index={i}
                          dragActive={draggedId !== null}
                          multiColumn={isMaximized}
                        >
                          <StoryCard
                            // Lets the card explain a description/tag-only match.
                            matchNeedle={filterActive ? needle : null}
                            // Row striping, as in the engineer windows above.
                            zebra={
                              Math.floor(i / (isMaximized ? boardColumns : 1)) %
                                2 ===
                              1
                            }
                            item={item}
                            showTagVisuals={showBoardTagVisuals}
                            onPrefetch={() => detailPrefetch.prefetch(item)}
                            onCancelPrefetch={detailPrefetch.cancelPrefetch}
                            onDragStart={() => {
                              onCloseMenu();
                              setDraggedId(item.id);
                            }}
                            onDragEnd={() => {
                              cancelBoardDrag();
                            }}
                            onDropAtPoint={(x, y) => dropAtPoint(item.id, x, y)}
                            onOpen={() => openWorkItemDetails(item)}
                            onContextMenu={(x, y) =>
                              onOpenMenu({ id: item.id, x, y, kind: "board" })
                            }
                            dragging={draggedId === item.id}
                            busyLabel={writing[item.id] ?? null}
                          />
                        </CardDropSlot>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
                </div>
  );
}
