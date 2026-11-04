import { useQuery } from "@tanstack/react-query";
import { CardContextMenu, type CardMenuState } from "@/features/work-items/card-menu";
import {
  copyWorkItemLink,
  openWorkItemInAdo,
  closeWorkItemDetails,
} from "@/features/work-items/work-item-actions";
import type { WorkItemWrites } from "@/features/work-items/use-work-item-writes";
import {
  ADO_WORK_ITEM_TYPE,
  fetchWorkItemTypeStates,
  toggleTag,
  workItemUrl,
  type AdoConfig,
  type WorkItemWrite,
} from "@/lib/ado";
import { safeUrl } from "@/lib/safe-url";
import { useAppStore } from "@/lib/store";
import { useTagConfig } from "@/lib/tag-config";
import type { WorkItem } from "@/lib/work-items-data";

/**
 * The ONE right-click menu for work items in every view. Board cards and My Work
 * cards write through the board's write path; nested items and My Work bugs hand
 * the change back to the panel that owns their row; Completed/Triage rows get
 * the link entries (plus tag toggles where allowed).
 */
export function WorkItemMenu({
  cardMenu,
  setCardMenu,
  items,
  config,
  hasConn,
  myWorkSelection,
  clearSelection,
  writes,
}: {
  cardMenu: CardMenuState | null;
  setCardMenu: (menu: CardMenuState | null) => void;
  items: WorkItem[];
  config: AdoConfig;
  hasConn: boolean;
  myWorkSelection: WorkItem[];
  clearSelection: () => void;
  writes: WorkItemWrites;
}) {
  const { tags } = useTagConfig();
  const { writeItem, writeBulkSelection, deleteChildItem } = writes;

  /**
   * The states Azure DevOps allows for the menu item's real work item type.
   * User Stories, Features, Epics, Tasks, and Bugs can use different workflows,
   * so every writable menu asks for its type's states and caches the result.
   */
  const menuWorkItemType =
    cardMenu?.kind === "child"
      ? (cardMenu.childType?.trim() || null)
      : cardMenu?.kind === "board"
        ? (items.find((item) => item.id === cardMenu.id)?.workItemType?.trim() ||
          ADO_WORK_ITEM_TYPE)
        : null;
  const menuStatesQuery = useQuery({
    queryKey: [
      "ado-work-item-type-states",
      config.organization,
      config.project,
      menuWorkItemType,
    ],
    queryFn: () => fetchWorkItemTypeStates(config, menuWorkItemType as string),
    enabled: hasConn && Boolean(menuWorkItemType),
    retry: false,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  // The work item the menu is open for, resolved from the LIVE list: if a
  // refresh removed it (e.g. it was just closed), this is null and no menu
  // renders — it can never act on a work item that is no longer on the board.
  //
  // A link-only menu (Completed / Triage) falls back to the card's own item,
  // since those work items aren't necessarily in the board's list — it offers
  // no writes, so there is nothing that could act on stale data.
  //
  // A CHILD menu always uses the row's own work item: a nested item is not part
  // of the board's list at all, so there is nothing there to resolve it against.
  const cardMenuItem = !cardMenu
    ? null
    : cardMenu.kind === "child"
      ? (cardMenu.item ?? null)
      : (items.find((it) => it.id === cardMenu.id) ?? cardMenu.item ?? null);

  const menuStates = menuStatesQuery.data ?? [];

  /**
   * DOES THIS MENU APPLY TO A MULTI-SELECTION?
   *
   * Only when 2+ are selected AND the card that was right-clicked is one of
   * them. Right-clicking a card OUTSIDE the selection is deliberately still a
   * single-item menu — acting on twelve items because of a click on a
   * thirteenth would be a genuinely dangerous surprise.
   *
   * The selection belongs to MY WORK, so a "link" menu (Triage, Completed) is
   * never a bulk menu. That guard matters now the Triage "Recently created"
   * rows offer the tag toggles: My Work does not clear its selection when
   * its tab unmounts, so without this a selection left behind on My Work could
   * be picked up by a right-click on a Triage row for the same work item and
   * silently tag the whole selection. A Triage row acts on ITS OWN item, only.
   */
  const bulkTargets =
    cardMenu &&
    cardMenu.kind !== "link" &&
    myWorkSelection.length > 1 &&
    myWorkSelection.some((it) => it.id === cardMenu.id)
      ? myWorkSelection
      : null;

  /**
   * The work item TYPES in that selection, retained from Azure DevOps for board
   * items and top-level My Work bugs alike.
   *
   * States are per-type in Azure DevOps — a Bug's are not a User Story's — so a
   * MIXED selection has no single valid state list. Rather than guess an
   * intersection (which could offer a state that only looks shared, or hide a
   * valid one), "Change state" is DISABLED for a mixed selection and says why.
   * Tag actions have no such problem: [System.Tags] is type-independent, so
   * they stay available across a mixed selection.
   */
  const bulkTypeNames = bulkTargets
    ? [
        ...new Set(
          bulkTargets.map((it) => it.workItemType?.trim() || ADO_WORK_ITEM_TYPE),
        ),
      ]
    : [];
  const bulkMixedTypes = bulkTypeNames.length > 1;

  /**
   * Run one of the menu's write actions against a NESTED work item: dismiss the
   * menu (like every other action does) and hand the change to the row's owner,
   * which applies it optimistically and calls `writeChildItem`.
   */
  function runChildMenuWrite(
    optimistic: Partial<WorkItem>,
    write: WorkItemWrite,
    label: string,
  ) {
    const menu = cardMenu;
    setCardMenu(null);
    menu?.onWrite?.({ optimistic, write, label });
  }

  // ---- Board right-click menu actions -------------------------------------
  // Both are REAL Azure DevOps writes through the same writeItem path as
  // drag-and-drop (optimistic update -> write -> refetch, rollback + the
  // connector's own error text on failure).

  /** "Unassign" — clears [System.AssignedTo] (sent as an empty identity). */
  function unassignItem(id: string) {
    setCardMenu(null);
    const item = items.find((it) => it.id === id);
    if (!item || !item.assignee) return; // nothing would change in ADO
    void writeItem(
      id,
      { assignee: null, assigneeEmail: null },
      { assignee: { name: null, email: null } },
      "Unassign",
    );
  }

  /**
   * "Change state ▸ <state>" — writes [System.State] through the SAME
   * writeItem path as everything else (optimistic update -> real ADO write via
   * updateWorkItemFields' userEnteredFields -> refetch, with rollback and the
   * connector's own error text on failure).
   *
   * Closed and Removed both drop the work item out of the board query (which
   * excludes them), so the refetch inside writeItem returns a result WITHOUT
   * it and `items` is replaced wholesale — the card disappears cleanly, no
   * stale row. The two things that could still point at the vanished id are
   * closed up front: the menu (dismissed here) and the detail dialog, whose
   * selected detail id is cleared when it happens to be this work item.
   */
  function setItemState(id: string, state: string) {
    setCardMenu(null);
    const item = items.find((it) => it.id === id);
    if (!item || item.state === state) return; // nothing would change in ADO
    if (
      useAppStore.getState().selectedWorkItemId === id &&
      (state === "Closed" || state === "Removed")
    ) {
      closeWorkItemDetails();
    }
    void writeItem(id, { state }, { state }, `Set state to ${state}`);
  }

  /**
   * Add or remove one configured tag in [System.Tags].
   *
   * ONE handler for every configured tag: the write, the matching rule and the
   * failure handling are identical, and the tag is a parameter, so the menu
   * entries share this path exactly and can never drift apart.
   *
   * Goes through the SAME writeItem path as every other action (optimistic
   * update -> real ADO write via updateWorkItemFields' userEnteredFields ->
   * refetch, with rollback and the connector's own error text on failure), so
   * the marker the tag drives — the flame and its alternating outline, or the
   * wrench and its
   * caution-tape border — appears or disappears instantly and reverts if Azure
   * DevOps refuses the write.
   *
   * ADO stores tags as one semicolon-separated string, so the write sends the
   * item's COMPLETE resulting tag list: toggleTag() adds or removes only the
   * exact whole tag (case-insensitive, whitespace-trimmed — which is why a tag
   * containing SPACES toggles as reliably as a hyphenated one) and preserves
   * every other tag's original casing and order. Clearing the last tag still
   * goes out as the verified JSON-Patch `remove`, and a toggle that would
   * change nothing is dropped before any round trip.
   */
  function toggleItemTag(id: string, tag: string) {
    setCardMenu(null);
    const item = items.find((it) => it.id === id);
    if (!item) return;

    const next = toggleTag(item.tags ?? [], tag);
    if (!next) return; // nothing would change in ADO

    void writeItem(
      id,
      { tags: next.tags },
      { tags: next.tags, tagChange: next.added ? "add" : "remove" },
      next.added ? `Add ${tag} tag` : `Remove ${tag} tag`,
    );
  }

  function copyItemLink(id: string, title: string) {
    setCardMenu(null);
    void copyWorkItemLink(config, hasConn, id, title);
  }

  function openItemLink(id: string) {
    setCardMenu(null);
    openWorkItemInAdo(config, hasConn, id);
  }

  return (
    <>
      {cardMenu && cardMenuItem && (
        <CardContextMenu
          item={cardMenuItem}
          x={cardMenu.x}
          y={cardMenu.y}
          onClose={() => setCardMenu(null)}
          // Writes are offered for a board work item (Board tab AND My Work
          // cards) and for a My Work nested item; a Completed/Triage row's menu
          // is the read-only entries alone.
          canWrite={cardMenu.kind !== "link"}
          // Tag toggles, scoped SEPARATELY from the write actions above:
          // Triage's "Recently created" rows set this true and so offer the
          // tag toggles while `canWrite` stays false, which
          // keeps Change state, Unassign and Delete out of that menu. Every
          // other menu leaves it undefined and it just follows `canWrite`.
          canToggleTags={cardMenu.canToggleTags ?? cardMenu.kind !== "link"}
          bulkCount={bulkTargets?.length ?? 1}
          typeLabel={menuWorkItemType}
          states={menuStates.map((state) => state.name)}
          statesLoading={Boolean(menuWorkItemType) && menuStatesQuery.isLoading}
          statesError={
            // A mixed selection has no single valid state list, so the entry
            // is disabled with the reason rather than offering states that
            // may not exist on half the selection.
            bulkMixedTypes
              ? `The ${bulkTargets?.length} selected work items are of different types (${bulkTypeNames.join(
                  " and ",
                )}), and Azure DevOps defines states per type — select items of one type to change state.`
              : menuWorkItemType && menuStatesQuery.isError
                ? menuStatesQuery.error instanceof Error
                  ? menuStatesQuery.error.message
                  : "Couldn't reach Azure DevOps."
                : null
          }
          onUnassign={() => {
            if (cardMenu.kind === "child") {
              runChildMenuWrite(
                { assignee: null, assigneeEmail: null },
                { assignee: { name: null, email: null } },
                "Unassign",
              );
              return;
            }
            unassignItem(cardMenuItem.id);
          }}
          onSetState={(state) => {
            // BULK: apply to every selected work item, then drop the selection
            // so the next right-click can't silently repeat on a stale set.
            if (bulkTargets) {
              if (bulkMixedTypes) return; // disabled above; belt and braces
              const targets = bulkTargets;
              setCardMenu(null);
              clearSelection();
              void writeBulkSelection(
                targets,
                (it) =>
                  it.state === state
                    ? null // already there — don't spend a write on it
                    : { optimistic: { state }, write: { state } },
                `Set state to ${state}`,
              );
              return;
            }
            if (cardMenu.kind === "child") {
              runChildMenuWrite({ state }, { state }, `Set state to ${state}`);
              return;
            }
            setItemState(cardMenuItem.id, state);
          }}
          // Everyone gets the link entries — they change nothing in ADO.
          hasLink={Boolean(safeUrl(workItemUrl(config, cardMenuItem.id)))}
          // The title travels with the id so the copied link can be NAMED
          // ("38731613: …"). This is the one Copy link binding in the app —
          // board cards, My Work cards, nested children, Triage and Completed
          // all open THIS menu — so every view gets it from here.
          onCopyLink={() => void copyItemLink(cardMenuItem.id, cardMenuItem.title)}
          onOpenLink={() => openItemLink(cardMenuItem.id)}
          // Tag toggles are [System.Tags] writes, which are type-independent, so they work the
          // same on a nested Task or Bug as on a board work item.
          //
          // One callback carries the configured TAG. Board items use the board's
          // write path; nested items use the executor supplied by their panel.
          // The current ordinary, removable configurations. An unavailable
          // store yields no tag actions rather than inventing defaults.
          tags={tags}
          onToggleTag={(tag) => {
            // BULK: tags are type-independent, so this works across a mixed
            // selection. Each item is toggled from ITS OWN current tag list —
            // never from the clicked card's — so items that already match are
            // skipped instead of being flipped the wrong way.
            if (bulkTargets) {
              const targets = bulkTargets;
              setCardMenu(null);
              clearSelection();
              void writeBulkSelection(
                targets,
                (it) => {
                  const next = toggleTag(it.tags ?? [], tag);
                  if (!next) return null;
                  return {
                    optimistic: { tags: next.tags },
                    write: {
                      tags: next.tags,
                      tagChange: next.added ? "add" : "remove",
                    },
                  };
                },
                `Toggle ${tag} tag`,
              );
              return;
            }
            if (cardMenu.kind === "child") {
              const next = toggleTag(cardMenuItem.tags ?? [], tag);
              if (!next) return; // nothing would change in ADO
              runChildMenuWrite(
                { tags: next.tags },
                { tags: next.tags, tagChange: next.added ? "add" : "remove" },
                next.added ? `Add ${tag} tag` : `Remove ${tag} tag`,
              );
              return;
            }
            toggleItemTag(cardMenuItem.id, tag);
          }}
          // DELETE — nested items only, available to every user. Board cards still deliberately do NOT get
          // this entry, so the most destructive action in the app keeps the
          // smallest surface that makes sense: a nested row and a confirmation.
          // The nested-only guard below stays — it is the boundary, not the
          // permission. Azure DevOps decides who may actually delete.
          // A top-level bug passes canDelete:false explicitly — it is a
          // story-level card, not a nested row (see CardMenuState.canDelete).
          canDelete={cardMenu.canDelete ?? cardMenu.kind === "child"}
          onDelete={() => {
            if (cardMenu.kind !== "child") return;
            if (cardMenu.canDelete === false) return;
            const child = cardMenuItem;
            const childType = cardMenu.childType ?? null;
            setCardMenu(null);
            void deleteChildItem(child, childType);
          }}
        />
      )}

    </>
  );
}
