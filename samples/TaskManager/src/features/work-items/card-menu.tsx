import { type WorkItemWrite } from "@/lib/ado";
import { INLINE_CONFIGURED_TAG_LIMIT, markerStyle, type ResolvedTag } from "@/lib/tag-config";
import { cn } from "@/lib/utils";
import { hasExactTag, stateDescription, stateMeta, type WorkItem } from "@/lib/work-items-data";
import { ExternalLink, Flame, Link2, Tag, Tags, Trash2, UserMinus, Wrench } from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

/**
 * Where a work item's context menu was opened, and for which work item.
 *
 * `kind` decides which entries the menu offers and which write path is behind
 * them. `item` carries the card's own work item for the cases where the id
 * can't be resolved against the board's `items` list — a Completed or Triage
 * row (the main query excludes Closed/Removed), or a nested child item.
 */
export type CardMenuState = {
  id: string;
  x: number;
  y: number;
  /**
   * WHICH work item this menu is acting on, which decides both the entries and
   * the write path behind them:
   *
   *  • "board" — a live board work item. That is the Board's cards AND the My
   *    Work tab's own cards (the same work items, from the same live list), so
   *    both get the identical full menu through `writeItem` and their own
   *    work-item type's state list.
   *  • "child" — a NESTED work item under a My Work card. Same entries, but the
   *    writes go through `writeChildItem` (the child isn't in the board list,
   *    so it has its own optimistic/rollback owner) and the "Change state"
   *    flyout lists the states Azure DevOps reports for the child's OWN type.
   *  • "link" — a Completed or Triage row: the read-only link entries, plus
   *    (only where `canToggleTags` says so) the configured tag toggles.
   *
   * A TOP-LEVEL BUG on My Work uses "child" as well: it is a real work item
   * that isn't in the board's list either, so it needs the same panel-owned
   * write path and the same per-type state list. It differs in one respect —
   * Delete stays nested-only — which is why `canDelete` is explicit below
   * rather than inferred from the kind.
   */
  kind: "board" | "child" | "link";
  item?: WorkItem;
  /**
   * Whether this menu may offer DELETE. Defaults to "any child menu" (a nested
   * row), and is set FALSE for a top-level bug: it sits at story level, and
   * board-level cards deliberately don't carry the app's most destructive
   * action.
   */
  canDelete?: boolean;
  /**
   * Whether the configured tag toggles are offered, INDEPENDENTLY of the
   * general write actions.
   *
   * Set true for Triage's "Recently created" rows, which are real board work
   * items and so write through the board's own `writeItem` path — they get the
   * configured tag toggles without getting Change state or Unassign.
   * Undefined everywhere else, where it simply follows the menu's write
   * capability and nothing changes.
   */
  canToggleTags?: boolean;
  /** [System.WorkItemType] of a "child" menu's item ("Task", "Bug", …). */
  childType?: string | null;
  /**
   * For a "child" menu: how to actually RUN a write on that item, supplied by
   * the view that owns the child row (My Work).
   *
   * The optimistic update and the rollback have to happen where the row's data
   * lives, and a child isn't in the board's `items` list — so the menu hands the
   * change back to its owner instead of trying to mutate a list it isn't part
   * of. The real Azure DevOps call still goes through the app's single
   * `writeChildItem` path.
   */
  onWrite?: (change: {
    optimistic: Partial<WorkItem>;
    write: WorkItemWrite;
    label: string;
  }) => void;
};

/**
 * The Board's right-click menu — a real Windows 95 pop-up (raised bevel, navy
 * highlight, etched separator). In order: the two link entries every view gets,
 * then the board's write actions:
 *
 *   • Change state ▸  -> writes [System.State] (this item's TYPE's own states)
 *   • Unassign        -> clears [System.AssignedTo]
 *
 * A "Mark as complete" shortcut used to sit above these. It was removed as
 * redundant: it only ever wrote one state, and "Change state" already offers
 * that state (and every other one the work item type allows) from the same
 * write path — two entries for one field invited the question of how they
 * differed.
 *
 * Both go through the board's ONE write path (writeItem -> updateWorkItemFields)
 * so they are real Azure DevOps writes with the same optimistic update, refetch,
 * rollback-on-failure and error surfacing as drag-and-drop and the detail
 * dialog. An action that wouldn't change anything in ADO (unassigning an already
 * unassigned item, completing an already-Closed one) is disabled rather than
 * sending a no-op write.
 *
 * It closes on Escape, on an outside pointer press, on any scroll (capture
 * phase, so the independently scrolling board regions count) and on resize —
 * exactly like the real thing, which never floats away from its anchor.
 * Keyboard: the first enabled entry is focused on open, Up/Down (and Home/End)
 * move between entries, Enter/Space activate.
 */
/**
 * Breathing room kept between any pop-up menu and the edge of the viewport, in
 * px. Shared by the root menu and its cascading flyout so both settle on the
 * same visual gutter.
 */
const MENU_MARGIN = 4;

/**
 * THE TAG TAG TOGGLES the right-click menu offers.
 *
 * Every entry is generated from ONE configured list rather than written out
 * per tag, so all tags are guaranteed the the same
 * "Mark as X" / "Unmark as X" labelling read from the item's CURRENT tags, the
 * same tooltip naming the exact [System.Tags] value, and the same verified
 * write path. Adding a configured tag adds a row to that list, not a code path.
 *
 * `label` is what the MENU calls the thing ("Mark as Hot"), `tag` is the exact
 * value written to Azure DevOps. They are kept separate on purpose: the wording
 * describes the item's STATE, which is what the person clicking is thinking
 * about, while the tag stays untouched — the menu still names it in the tooltip
 * so it remains discoverable.
 */
/**
 * The menu icon follows the configured marker when it is one of the bespoke
 * visuals; chip and no-marker styles use the generic tag icon.
 */
function tagEntryIcon(tag: ResolvedTag): ReactNode {
  const icon = markerStyle(tag.marker).icon;
  if (icon === "flame") return <Flame className="h-3.5 w-3.5" />;
  if (icon === "repair") return <Wrench className="h-3.5 w-3.5" />;
  return <Tag className="h-3.5 w-3.5" />;
}

/**
 * EXPORTED so the menu each view actually offers can be rendered and checked
 * directly for a given set of capabilities — which entries exist for a Triage
 * "Recently created" row versus a board card versus a view without tag toggles is exactly the
 * kind of thing that should not have to be confirmed by hand. Only HomePage
 * renders it.
 */
export function CardContextMenu({
  item,
  x,
  y,
  onClose,
  canWrite,
  canToggleTags = canWrite,
  onUnassign,
  onSetState,
  hasLink,
  onCopyLink,
  onOpenLink,
  onToggleTag,
  tags = [],
  canDelete = false,
  onDelete = () => {},
  states,
  statesLoading = false,
  statesError = null,
  typeLabel = null,
  bulkCount = 1,
}: {
  item: WorkItem;
  x: number;
  y: number;
  onClose: () => void;
  /**
   * Whether this menu may offer the GENERAL Azure DevOps write actions —
   * Change state and Unassign (and, with `canDelete`, Delete). False for a card
   * outside the board.
   *
   * NOTE this no longer covers the tag toggles: they have their own
   * capability below, because "may this row change state / owner?" and "may an
   * this row get a tag toggled?" turned out to be genuinely different
   * questions. See `canToggleTags`.
   */
  canWrite: boolean;
  /**
   * Whether this menu may offer the configured tag toggles (Mark/Unmark
   * as <label>).
   *
   * SPLIT OUT OF `canWrite` so a view can offer the tag toggles WITHOUT
   * offering Change state and Unassign. Triage's "Recently created" list is
   * exactly that case: flagging something hot the moment it lands is triage
   * work, whereas changing its state or owner is not — that list's own reroute
   * controls and the board are where those belong.
   *
   * Defaults to `canWrite`, so every existing caller keeps precisely the menu
   * it had; only a caller that passes this explicitly gets the finer grain.
   * 
   */
  canToggleTags?: boolean;
  onUnassign: () => void;
  onSetState: (state: string) => void;
  /** False when no Azure DevOps URL can be built for this work item. */
  hasLink: boolean;
  onCopyLink: () => void;
  /** Opens the work item in Azure DevOps in a new tab. */
  onOpenLink: () => void;
  /**
   * Add/remove one of the marker tags on this work item. Takes the TAG, so the
   * hot and repair entries are the same entry built twice rather than two
   * near-identical props and two near-identical handlers.
   */
  onToggleTag: (tag: string) => void;
  /**
   * The ordinary removable tag configurations this menu can toggle.
   */
  tags?: readonly ResolvedTag[];
  /**
   * Whether this menu may offer DELETE. True only for a nested work item in My
   * Work — board cards deliberately don't get it. Not gated: everyone who
   * gets the write menu gets this entry, and Azure DevOps' own permissions
   * decide whether the delete is allowed to happen.
   */
  canDelete?: boolean;
  /** Opens the confirmation, then deletes for real if it is accepted. */
  onDelete?: () => void;
  /**
   * The states the "Change state" flyout may write, in order.
   *
   * This is the list Azure DevOps reports for the item's own type. A Feature's
   * states need not match a User Story's, just as a Task's need not. While that
   * list is being read
   * (`statesLoading`) or if it couldn't be read (`statesError`), the entry is
   * DISABLED and says why; it never falls back to a guessed list.
   */
  states: string[];
  statesLoading?: boolean;
  statesError?: string | null;
  /** e.g. "Task" — named in the menu header so a child's menu is unambiguous. */
  typeLabel?: string | null;
  /** How many work items this menu will act on. 1 = the normal single menu. */
  bulkCount?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Start at the pointer, then clamp inside the viewport once measured (a menu
  // opened near the right/bottom edge flips back on-screen instead of clipping).
  // `maxHeight` is only set in the extreme case where the menu is TALLER than
  // the viewport itself — then it pins to the visible area and scrolls
  // internally, so every entry stays reachable instead of running off-screen.
  const [pos, setPos] = useState<{
    x: number;
    y: number;
    maxHeight: number | null;
  }>({ x, y, maxHeight: null });

  /**
   * Which entry is highlighted by the KEYBOARD, or -1 for "none".
   *
   * It starts at -1 on purpose. The bug this fixes: the menu used to call
   * `.focus()` on the first enabled button as soon as it opened, and the
   * highlight rule matched `:focus` — so right-clicking a card left "Unassign"
   * painted in the navy selection colour even though the pointer was nowhere
   * near it and no key had been pressed. It read as a permanently hovered item.
   *
   * Now the CONTAINER takes focus on open (so key events still land) and no
   * entry is highlighted until the user actually arrows onto one. Mouse hover
   * is handled purely by `:hover` in CSS, exactly like a real 95 menu.
   */
  const [activeIndex, setActiveIndex] = useState(-1);

  /**
   * WHICH cascading flyout is open, by its parent entry's key, or null.
   *
   * This used to be a boolean, because "Change state" was the only flyout the
   * menu had. It is a key now so a SECOND one can exist — "More tags", which
   * appears once enough tags are configured that listing them all inline would
   * make the menu unusable. Everything below (placement, keyboard, the
   * highlight, the scroll-into-view) is written against whichever flyout is
   * open rather than against the state list, so the two behave identically and
   * there is only one implementation to keep correct.
   */
  const [openSub, setOpenSub] = useState<string | null>(null);
  /** Which row of the OPEN flyout the keyboard is on (-1 = none, same
   *  no-pre-highlight rule as the parent menu). */
  const [subIndex, setSubIndex] = useState(-1);
  const subRef = useRef<HTMLDivElement>(null);
  // Kept as a derived boolean so every existing read of "is a flyout open?"
  // stays exactly as it was.
  const submenuOpen = openSub !== null;

  /**
   * Where the "Change state" flyout actually lands, measured on open.
   *
   *  • `flipped`   — it would run off the RIGHT edge, so it opens to the left.
   *  • `top`       — its offset from the parent row, in px. Normally -2 (the
   *                  classic 95 alignment across the parent menu's padding);
   *                  a NEGATIVE-er value means it was flipped upward because
   *                  there was no room below.
   *  • `maxHeight` — only set when the flyout is taller than the viewport, so
   *                  it scrolls internally instead of being cut off.
   */
  const [subPlacement, setSubPlacement] = useState<{
    flipped: boolean;
    top: number;
    maxHeight: number | null;
  }>({ flipped: false, top: -2, maxHeight: null });

  // Measured in a LAYOUT effect so the clamped position is committed in the
  // same frame the menu paints — it never flashes at the raw pointer spot first.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const menu = ref.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      // `scrollHeight` is the NATURAL height even after a previous pass capped
      // it, so re-measuring can never ratchet the menu smaller and smaller.
      const height = Math.max(rect.height, menu.scrollHeight);
      const room = window.innerHeight - MENU_MARGIN * 2;
      const fits = height <= room;
      setPos({
        x: Math.max(2, Math.min(x, window.innerWidth - rect.width - MENU_MARGIN)),
        // Fits: sit at the pointer, pulled up just enough to clear the bottom.
        // Doesn't fit at all: pin to the top of the viewport and scroll.
        y: fits
          ? Math.max(2, Math.min(y, window.innerHeight - height - MENU_MARGIN))
          : MENU_MARGIN,
        maxHeight: fits ? null : room,
      });
    };
    place();
    // Focus the MENU itself, not an entry: the pop-up is keyboard-reachable
    // from the moment it opens, with nothing pre-selected.
    el.focus({ preventScroll: true });
    // Belt and braces: the menu already dismisses itself on resize, but if that
    // ever changes the geometry stays correct rather than silently clipping.
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // The menu is anchored to a card, so scrolling the board behind it must
    // dismiss it — but a scroll INSIDE the menu (which happens once a very tall
    // menu or flyout has been capped to the viewport and scrolls internally)
    // obviously must not close the thing the user is scrolling.
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    // Capture phase: scroll doesn't bubble, and the board's regions scroll
    // independently, so only a capturing listener sees them.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const canUnassign = Boolean(item.assignee);
  // Why the state entries are unavailable, when they are — surfaced verbatim in
  // the entry's tooltip so a connector failure is never silently swallowed.
  const statesUnavailable = statesLoading
    ? "Reading this work item type's states from Azure DevOps…"
    : statesError
      ? `Azure DevOps wouldn't say which states this work item type allows — ${statesError}`
      : states.length === 0
        ? "Azure DevOps returned no states for this work item type."
        : null;

  /**
   * ONE tag's menu row, built the same way wherever it ends up — inline in the
   * parent menu or inside the "More tags" flyout.
   *
   * The label names what the click will DO, read from the item's CURRENT tags,
   * so it is never a guess about the tag's state; the tooltip names the exact
   * [System.Tags] value being written, which is what keeps the underlying tag
   * discoverable while the wording stays readable. A configured tag with no
   * marker style is no different here — it toggles exactly like the others and
   * simply draws nothing on the card.
   */
  const tagEntry = (t: ResolvedTag) => {
    const tagged = hasExactTag(item, t.tag);
    return {
      key: `tag-${t.key}`,
      label: tagged ? `Unmark as ${t.label}` : `Mark as ${t.label}`,
      icon: tagEntryIcon(t),
      disabled: false,
      title: tagged
        ? `Remove the ${t.tag} tag from [System.Tags] in Azure DevOps`
        : `Add the ${t.tag} tag to [System.Tags] in Azure DevOps`,
      onSelect: () => onToggleTag(t.tag),
    };
  };

  const collapseTags = tags.length > INLINE_CONFIGURED_TAG_LIMIT;
  const inlineTags = collapseTags ? [] : tags;
  const overflowTags = collapseTags ? tags : [];

  /**
   * The parent menu's entries, in render order — one list, so keyboard
   * navigation, the highlight and the click handlers can never drift apart.
   *
   * ORDER: the two read-only link entries first (they are the whole menu on a
   * Completed or Triage card), then the board's write actions, then the
   * destructive Delete for a nested item, then the tag marker toggles —
   * each of the last two opening its own separated group. It runs from
   * "changes nothing" at the top to "changes the most" at the bottom.
   */
  const entries: {
    key: string;
    label: string;
    icon: ReactNode;
    disabled: boolean;
    title: string;
    submenu?: boolean;
    /** Painted as a destructive action (see .w95-menu-item--danger). */
    danger?: boolean;
    /** Draws the etched 95 group separator immediately above this entry. */
    separatorBefore?: boolean;
    onSelect: () => void;
  }[] = [
    // ---- Everyone, everywhere, FIRST -------------------------------------
    // Read-only, so not board-gated: these two are the
    // whole menu on a Completed or Triage card. They lead the list because
    // they are the entries that behave identically in every view and can never
    // be disabled by gating — the safe, always-there pair at the top, with the
    // actions that write to Azure DevOps below them.
    {
      key: "copy-link",
      label: "Copy link",
      icon: <Link2 className="h-3.5 w-3.5" />,
      disabled: !hasLink,
      title: hasLink
        ? "Copy this work item's Azure DevOps link, named with its id and title"
        : "No Azure DevOps link is available for this work item",
      onSelect: onCopyLink,
    },
    {
      key: "open-ado",
      label: "Open in Azure DevOps",
      icon: <ExternalLink className="h-3.5 w-3.5" />,
      disabled: !hasLink,
      title: hasLink
        ? "Open this work item in Azure DevOps in a new tab"
        : "No Azure DevOps link is available for this work item",
      onSelect: onOpenLink,
    },
    // ---- Write actions: BOARD ONLY --------------------------------------
    // Spread in only when the menu was opened from a board card. On the
    // Completed tab and in Triage there is no board write path, so these
    // entries do not exist in the DOM at all and the two link entries above
    // are the entire menu.
    ...(canWrite
      ? [
          {
            key: "state",
            label: "Change state",
            icon: <Tag className="h-3.5 w-3.5" />,
            disabled: Boolean(statesUnavailable),
            title:
              statesUnavailable ??
              `Write a new [System.State] to Azure DevOps${
                typeLabel ? ` (${typeLabel} states)` : ""
              }`,
            submenu: true,
            // Clicking the parent row just reveals the flyout; the write
            // happens on one of the state rows inside it.
            onSelect: () => {
              setOpenSub("state");
              setSubIndex(-1);
            },
          },
          {
            key: "unassign",
            label: "Unassign",
            icon: <UserMinus className="h-3.5 w-3.5" />,
            disabled: !canUnassign,
            title: canUnassign
              ? "Clear the owner in Azure DevOps"
              : "This work item is already unassigned",
            onSelect: onUnassign,
          },
        ]
      : []),
    // ---- DESTRUCTIVE, nested items only ----------------------------------
    // Deleting a real work item is the most destructive thing this app can do,
    // so it keeps every safeguard it had and no role gate:
    // anyone who gets the write menu sees it. It still exists ONLY for a nested
    // item (`canDelete` is false for board cards — the boundary the request
    // asked for), it is still set apart by a group separator and painted as
    // destructive, its label still ends in the classic 95 ellipsis because it
    // opens a confirmation, and the actual delete still only happens after that
    // confirmation is accepted.
    //
    // Authorization is Azure DevOps', not this menu's: a user without delete
    // permission gets a real error back from the service, which is correct.
    ...(canWrite && canDelete
      ? [
          {
            key: "delete",
            label: "Delete…",
            icon: <Trash2 className="h-3.5 w-3.5" />,
            disabled: false,
            danger: true,
            separatorBefore: true,
            title:
              "Move this work item to the Azure DevOps recycle bin (an Azure DevOps administrator can restore it)",
            onSelect: onDelete,
          },
        ]
      : []),
    // ---- Tag, LAST ------------------------------------------------
    // Spread in only where the view allows tag toggles, so
    // for everyone else the entry does not exist in the DOM at all — hidden,
    // not disabled. Because it joins this SAME list, keyboard navigation, the
    // highlight and the click handlers stay in lockstep automatically, with no
    // special-casing anywhere else.
    //
    // The gate is `canToggleTags`, NOT `canWrite`: Triage's "Recently created"
    // rows get these two entries without getting Change state / Unassign, which
    // a single write capability could not express. Everywhere else the two
    // flags are the same value, so nothing about those menus changed.
    //
    // BOTH marker tags are built from the same descriptor list, so the repair
    // entry is the hot entry with a different noun: same
    // label convention, same tooltip wording, same write path. Each label names
    // what the click will DO, read from the item's CURRENT tags, so it is never
    // a guess about the tag's state.
    //
    // The labels say MARK / UNMARK rather than naming the tag, because that is
    // what the action means to the person clicking it — the underlying
    // [System.Tags] values are untouched, and the tooltip still names the exact
    // tag being written so it stays discoverable.
    //
    // The group is SET APART by an etched 95 separator above its first entry,
    // so the tag actions read as their own block rather than as two more
    // ordinary actions. The rule rides on the entry itself, which is what makes
    // it correctly conditional: for a view without tag toggles this whole spread is `[]`, so
    // the separator disappears WITH the entries — no stray rule, no gap.
    //
    // It can never double up with the Delete entry's separator above it: when
    // both groups render, Delete itself sits between the two rules, and when
    // either group is absent only one rule is left. They are therefore never
    // adjacent in any combination of `canToggleTags` / `canDelete`.
    //
    // MENU LENGTH. Configured tags stay inline only while there are few enough
    // to scan (INLINE_CONFIGURED_TAG_LIMIT); past that they collapse into ONE
    // cascading "More tags ▸" row, so the menu's height stops growing at a
    // fixed worst case no matter how many tags are configured. The flyout
    // itself is already clamped to the viewport and scrolls internally (see the
    // placement effect), so even a long list stays fully reachable.
    ...(canToggleTags
      ? [
          ...inlineTags.map((t, i) => ({
            ...tagEntry(t),
            // Only the FIRST tag entry opens the group.
            separatorBefore: i === 0,
          })),
          ...(overflowTags.length > 0
            ? [
                {
                  key: "more-tags",
                  label: "More tags",
                  icon: <Tags className="h-3.5 w-3.5" />,
                  disabled: false,
                  // Opens the group when it is the first tag entry.
                  separatorBefore: inlineTags.length === 0,
                  submenu: true,
                  title: `Apply or remove ${overflowTags.length} more configured ${
                    overflowTags.length === 1 ? "tag" : "tags"
                  } in Azure DevOps`,
                  onSelect: () => {
                    setOpenSub("more-tags");
                    setSubIndex(-1);
                  },
                },
              ]
            : []),
        ]
      : []),
  ];

  // The states this item's TYPE actually allows (the board's five for a User
  // Story, ADO's own list for a nested Task/Bug), with the item's current one
  // disabled — writing the state it already has would be a pointless round trip.
  const stateEntries = states.map((state) => ({
    state,
    disabled: state === item.state,
  }));

  /**
   * The rows of whichever flyout is OPEN, in one shape.
   *
   * Both cascading menus reduce to this, so the keyboard handling, the
   * highlight, the aria wiring and the scroll-into-view below are written once
   * and cannot drift between them. `node` is the row's inner markup, which is
   * the only thing that genuinely differs: a state row is the stacked dot +
   * name + description the category picker uses, a tag row is its icon and its
   * Mark/Unmark label.
   */
  const subRows: {
    key: string;
    disabled: boolean;
    title: string;
    stacked: boolean;
    node: ReactNode;
    onSelect: () => void;
  }[] =
    openSub === "state"
      ? stateEntries.map((entry) => {
          const description = stateDescription(entry.state);
          const meta = stateMeta(entry.state);
          return {
            key: `state-${entry.state}`,
            disabled: entry.disabled,
            stacked: true,
            title: entry.disabled
              ? `This work item is already ${entry.state}`
              : `Set [System.State] to ${entry.state} in Azure DevOps`,
            onSelect: () => onSetState(entry.state),
            node: (
              <>
                <span
                  className={cn(
                    "w95-state-dot mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/30",
                    meta.dot,
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block font-bold leading-tight">{entry.state}</span>
                  {description && (
                    // Same `.w95-menu-desc` treatment the category picker uses:
                    // grey normally, white on the navy highlight, so it stays
                    // readable in BOTH states.
                    <span className="w95-menu-desc block max-w-[15rem] text-[10px] leading-tight">
                      {description}
                    </span>
                  )}
                </span>
              </>
            ),
          };
        })
      : openSub === "more-tags"
        ? overflowTags.map((t) => {
            const entry = tagEntry(t);
            return {
              key: entry.key,
              disabled: false,
              stacked: true,
              title: entry.title,
              onSelect: entry.onSelect,
              node: (
                <>
                  <span className="mt-px shrink-0" aria-hidden="true">
                    {entry.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold leading-tight">
                      {entry.label}
                    </span>
                    {/* The exact ADO tag, which the inline entries can only
                        show in a tooltip. The flyout has the room, so a
                        configured tag names itself here. */}
                    <span className="w95-menu-desc block max-w-[15rem] truncate font-mono text-[10px] leading-tight">
                      {t.tag}
                    </span>
                  </span>
                </>
              ),
            };
          })
        : [];

  const usableSubRows = subRows
    .map((row, i) => (row.disabled ? -1 : i))
    .filter((i) => i >= 0);

  function openSubmenu(key: string, withKeyboard: boolean) {
    setOpenSub(key);
    // The first enabled row is only pre-selected for a KEYBOARD open, and it is
    // resolved against the flyout being opened rather than the one that was
    // open a moment ago.
    if (!withKeyboard) {
      setSubIndex(-1);
      return;
    }
    const rows = key === "state" ? stateEntries.map((e) => e.disabled) : overflowTags.map(() => false);
    const first = rows.findIndex((disabled) => !disabled);
    setSubIndex(first);
  }

  function closeSubmenu() {
    setOpenSub(null);
    setSubIndex(-1);
  }

  /**
   * Keep the flyout inside the viewport on BOTH axes.
   *
   * Horizontally it flips to the left of the parent menu when opening right
   * would overflow (unchanged behaviour). Vertically — the bug this fixes —
   * it used to be pure CSS (`top: -2px`), so right-clicking a card near the
   * bottom of the screen rendered the state list straight off the bottom edge.
   * Now it is measured: it stays row-aligned when it fits, flips UP to be
   * bottom-aligned with the parent row when it doesn't, and as a last resort
   * (flyout taller than the whole viewport) pins to the visible area and
   * scrolls internally so every state is still reachable.
   *
   * Runs in a LAYOUT effect, so the corrected position is committed before the
   * browser paints — the flyout never flickers at the wrong spot. Because it
   * keys off `submenuOpen` it covers BOTH ways in: hovering the parent row and
   * the → arrow key.
   */
  useLayoutEffect(() => {
    if (!submenuOpen) {
      setSubPlacement({ flipped: false, top: -2, maxHeight: null });
      return;
    }
    const place = () => {
      const el = subRef.current;
      const parent = ref.current;
      // The flyout's offset parent: the `relative` wrapper around the
      // "Change state" row, which is what its `top` is measured against.
      const anchor = el?.parentElement;
      if (!el || !parent || !anchor) return;

      const parentRect = parent.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      // Natural height, immune to any cap a previous pass applied.
      const height = Math.max(rect.height, el.scrollHeight);
      const room = window.innerHeight - MENU_MARGIN * 2;
      const shown = Math.min(height, room);

      // Preferred: top edge aligned with the parent row, 95-style.
      let top = anchorRect.top - 2;
      // No room below -> flip upward so the flyout's BOTTOM sits by the row.
      if (top + shown > window.innerHeight - MENU_MARGIN) {
        top = anchorRect.bottom + 2 - shown;
      }
      // Final clamp, so it can leave neither the bottom nor the top edge.
      top = Math.min(
        Math.max(top, MENU_MARGIN),
        Math.max(MENU_MARGIN, window.innerHeight - MENU_MARGIN - shown),
      );

      setSubPlacement({
        flipped: parentRect.right + rect.width > window.innerWidth - MENU_MARGIN,
        // Back into wrapper-relative px for the absolute positioning.
        top: top - anchorRect.top,
        maxHeight: height > room ? room : null,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [submenuOpen]);

  // When a menu had to be capped to the viewport and scrolls internally, keep
  // the arrow-key highlight in view. Guarded on the capped case so a normal,
  // fully-visible menu never scrolls anything (which would dismiss it).
  useEffect(() => {
    const capped = subPlacement.maxHeight !== null || pos.maxHeight !== null;
    if (!capped) return;
    const id =
      submenuOpen && subIndex >= 0
        ? `w95-menu-${item.id}-sub-${subRows[subIndex]?.key}`
        : activeIndex >= 0
          ? `w95-menu-${item.id}-${entries[activeIndex]?.key}`
          : null;
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subIndex, activeIndex, submenuOpen, subPlacement.maxHeight, pos.maxHeight]);

  /**
   * Keyboard navigation for BOTH levels.
   *
   * Parent: Up/Down step over the enabled entries (wrapping), Home/End jump,
   * Right opens the flyout, Enter/Space activate. The first Up/Down press is
   * what creates a highlight at all — nothing is pre-selected.
   *
   * Flyout (when open and focused): the same Up/Down/Home/End over the states,
   * Left or Escape steps back out to the parent menu, Enter/Space writes.
   */
  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // ---- flyout has the keyboard --------------------------------------
    if (submenuOpen && subIndex >= 0) {
      if (usableSubRows.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const at = usableSubRows.indexOf(subIndex);
        const step = e.key === "ArrowDown" ? 1 : -1;
        setSubIndex(
          usableSubRows[(at + step + usableSubRows.length) % usableSubRows.length],
        );
        return;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        setSubIndex(
          e.key === "Home"
            ? usableSubRows[0]
            : usableSubRows[usableSubRows.length - 1],
        );
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        closeSubmenu();
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        const row = subRows[subIndex];
        if (!row || row.disabled) return;
        e.preventDefault();
        row.onSelect();
        return;
      }
      // Escape is handled by the document listener, which closes the whole
      // menu; step out of the flyout first so it closes one level at a time.
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        closeSubmenu();
        return;
      }
      return;
    }

    // ---- parent menu has the keyboard ---------------------------------
    const usable = entries
      .map((entry, i) => (entry.disabled ? -1 : i))
      .filter((i) => i >= 0);
    if (usable.length === 0) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (submenuOpen) closeSubmenu();
      const at = usable.indexOf(activeIndex);
      const step = e.key === "ArrowDown" ? 1 : -1;
      // From "nothing selected", Down lands on the first entry and Up on the last.
      const next =
        at === -1
          ? e.key === "ArrowDown"
            ? usable[0]
            : usable[usable.length - 1]
          : usable[(at + step + usable.length) % usable.length];
      setActiveIndex(next);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (submenuOpen) closeSubmenu();
      setActiveIndex(e.key === "Home" ? usable[0] : usable[usable.length - 1]);
      return;
    }
    if (e.key === "ArrowRight") {
      const entry = entries[activeIndex];
      if (!entry?.submenu) return;
      e.preventDefault();
      openSubmenu(entry.key, true);
      return;
    }
    if (e.key === "ArrowLeft") {
      if (!submenuOpen) return;
      e.preventDefault();
      closeSubmenu();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      const entry = entries[activeIndex];
      if (!entry || entry.disabled) return;
      e.preventDefault();
      if (entry.submenu) {
        openSubmenu(entry.key, true);
        return;
      }
      entry.onSelect();
    }
  }

  /**
   * The menu's caption — the work item's TITLE, not its id.
   *
   * The id is what this used to show, and it is NOT lost: it moves into the
   * caption's tooltip (with the type, so a nested item still reads "Task
   * #123"), and every row of this menu already acts on the item the id names.
   * The title is what tells you WHICH item you right-clicked when several
   * cards look alike, which the id never did at a glance.
   *
   * `idCaption` also stays the FALLBACK: mapRow guarantees a non-empty title
   * (it substitutes "Work item <id>" when ADO returns none), but if a title
   * were ever blank or whitespace the caption would silently become an empty
   * grey bar, so it falls back rather than rendering nothing.
   */
  const idCaption = typeLabel ? `${typeLabel} ${item.id}` : `Work item ${item.id}`;
  const menuTitle = item.title.trim();
  const menuCaption = menuTitle || idCaption;
  const captionTooltip = menuTitle ? `${idCaption} — ${menuTitle}` : idCaption;

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      // Screen readers get BOTH: which item (by id and type) and its title.
      aria-label={`Actions for ${captionTooltip}`}
      aria-activedescendant={
        submenuOpen && subIndex >= 0
          ? `w95-menu-${item.id}-sub-${subRows[subIndex]?.key}`
          : activeIndex >= 0
            ? `w95-menu-${item.id}-${entries[activeIndex]?.key}`
            : undefined
      }
      onKeyDown={onMenuKeyDown}
      // Moving the mouse anywhere in the menu hands the highlight back to
      // `:hover`, so the keyboard selection can't linger somewhere else.
      onMouseMove={() => activeIndex !== -1 && setActiveIndex(-1)}
      // The menu lives over draggable cards; a stray contextmenu inside it
      // should not re-open the browser menu.
      onContextMenu={(e) => e.preventDefault()}
      className="w95-menu"
      style={{
        left: pos.x,
        top: pos.y,
        // Only present in the extreme case; otherwise the menu is its natural
        // height with no scroller, exactly as before.
        ...(pos.maxHeight !== null
          ? { maxHeight: pos.maxHeight, overflowY: "auto" as const }
          : null),
      }}
    >
      {/* The caption names the work item by TITLE, trimmed with an ellipsis to
          keep the menu narrow: `.w95-menu` has a min-width but no max, so
          without the cap a long title would stretch the whole menu across the
          screen. The max-width is what makes `truncate` actually bite; hovering
          shows the full title along with the id and type. */}
      {/* BULK header: when this menu is acting on a multi-selection, the count
          leads — on navy, so it cannot be mistaken for the single-item caption
          — and every entry below it applies to all of them. */}
      {bulkCount > 1 ? (
        <div className="max-w-[220px] bg-[#000080] px-2 py-1 text-[10px] font-bold text-white">
          Applies to {bulkCount} selected work items
        </div>
      ) : (
        <div
          className="max-w-[220px] truncate px-2 py-1 text-[10px] font-bold text-[#404040]"
          title={captionTooltip}
        >
          {menuCaption}
        </div>
      )}
      <div className="w95-menu-sep" aria-hidden="true" />
      {entries.map((entry, i) => {
        const row = (
          <button
            key={entry.key}
            id={`w95-menu-${item.id}-${entry.key}`}
            type="button"
            role={entry.submenu ? "menuitem" : "menuitem"}
            aria-haspopup={entry.submenu ? "menu" : undefined}
            aria-expanded={entry.submenu ? openSub === entry.key : undefined}
            // Entries are never focused themselves (that is what used to leave
            // the first one stuck in the highlight colour) — the menu keeps
            // focus and paints the active entry with an explicit class.
            tabIndex={-1}
            className={cn(
              "w95-menu-item",
              // The parent of an OPEN flyout stays highlighted, exactly like a
              // real 95 cascading menu — and now only the parent of the one
              // that is actually open, since there is more than one.
              ((i === activeIndex && !entry.disabled) ||
                (entry.submenu && openSub === entry.key)) &&
                "w95-menu-item--active",
              entry.danger && "w95-menu-item--danger",
            )}
            disabled={entry.disabled}
            title={entry.title}
            onClick={entry.onSelect}
            // Hovering any NON-cascading row dismisses an open flyout, the way
            // a real 95 menu collapses a sibling submenu.
            onMouseEnter={
              entry.submenu ? undefined : () => submenuOpen && closeSubmenu()
            }
          >
            {entry.icon}
            {entry.label}
            {entry.submenu && (
              <span className="w95-menu-arrow" aria-hidden="true">
                ▶
              </span>
            )}
          </button>
        );

        // A grouped entry (the destructive one) gets the etched 95 separator
        // above it, so it reads as its own group rather than one more action
        // in the list.
        if (!entry.submenu) {
          return entry.separatorBefore ? (
            <Fragment key={`${entry.key}-group`}>
              <div className="w95-menu-sep" aria-hidden="true" />
              {row}
            </Fragment>
          ) : (
            row
          );
        }

        return (
          <div
            key={entry.key}
            className="relative"
            // Classic cascading behaviour: hovering the parent row opens the
            // flyout, hovering anything else in the menu closes it.
            onMouseEnter={() => openSubmenu(entry.key, false)}
          >
            {row}
            {openSub === entry.key && (
              <div
                ref={subRef}
                role="menu"
                aria-label={entry.label}
                className={cn(
                  "w95-menu w95-submenu",
                  subPlacement.flipped && "w95-submenu--left",
                )}
                // Vertical placement is measured (see the layout effect above),
                // so it overrides the stylesheet's default `top: -2px`.
                style={{
                  top: subPlacement.top,
                  ...(subPlacement.maxHeight !== null
                    ? {
                        maxHeight: subPlacement.maxHeight,
                        overflowY: "auto" as const,
                      }
                    : null),
                }}
              >
                {/* Built from `subRows`, so the state list and the tag list
                    are the SAME flyout with different row contents — one set
                    of ids, one highlight rule, one keyboard model. */}
                {subRows.map((subRow, si) => (
                  <button
                    key={subRow.key}
                    id={`w95-menu-${item.id}-sub-${subRow.key}`}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={cn(
                      "w95-menu-item",
                      subRow.stacked && "w95-menu-item--stacked",
                      si === subIndex && !subRow.disabled && "w95-menu-item--active",
                    )}
                    disabled={subRow.disabled}
                    title={subRow.title}
                    onClick={subRow.onSelect}
                  >
                    {subRow.node}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
