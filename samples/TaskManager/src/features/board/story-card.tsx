import { CobwebIndicator } from "@/components/cobweb-indicator";
import { TagChips } from "@/components/tag-chips";
import { useTagVisualFrameClasses } from "@/lib/tag-visuals";
import { useIsMenuTarget } from "@/hooks/use-menu-target";
import { cn } from "@/lib/utils";
import { areaMeta, isAncientWorkItem, stateMeta, type WorkItem } from "@/lib/work-items-data";
import { GripVertical, Loader2, Search } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * One card's slot in a list, and the drop geometry that makes re-ordering
 * possible: the top half of a card means "insert above me", the bottom half
 * "insert below me". While a drag hovers, the chosen edge draws a hard 2px
 * navy insertion line (absolutely positioned, so no card ever shifts).
 *
 * MULTI-COLUMN (a maximized window): the list is a grid whose cards flow in
 * READING ORDER — left to right, then down — so the list index and what the eye
 * sees still agree, but the axis that separates "before me" from "after me"
 * does not: two cards side by side are separated HORIZONTALLY. With
 * `multiColumn` the split is therefore taken on the card's horizontal midpoint
 * (left half = insert at my index, right half = insert after me), which is the
 * exact reading-order position — including at a row's end, where the right half
 * of the last card in a row is the same insertion point as the left half of the
 * first card in the next row. The insertion line turns vertical to match, so
 * what is drawn is always where the item will actually land.
 *
 * Pointer movement bubbles to the region's edge auto-scroll handler. Pointer-up
 * is resolved once at Board level with `elementFromPoint`, so the slot only owns
 * its insertion-line feedback and cannot trigger a duplicate section drop.
 */
export function CardDropSlot({
  index,
  dragActive,
  multiColumn,
  children,
}: {
  index: number;
  dragActive: boolean;
  /** Is this card sitting in a multi-column (maximized) list? */
  multiColumn: boolean;
  children: ReactNode;
}) {
  const [line, setLine] = useState<"start" | "end" | null>(null);
  const lineRef = useRef<"start" | "end" | null>(null);
  useEffect(() => {
    if (!dragActive && lineRef.current !== null) {
      lineRef.current = null;
      setLine(null);
    }
  }, [dragActive]);
  const indexFor = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const past = multiColumn
      ? e.clientX > rect.left + rect.width / 2
      : e.clientY > rect.top + rect.height / 2;
    return past ? index + 1 : index;
  };
  return (
    <div
      className="relative"
      data-board-drop-slot={index}
      data-board-drop-multi-column={multiColumn}
      onPointerMove={(e) => {
        if (!dragActive || e.buttons !== 1) return;
        const next = indexFor(e) === index ? "start" : "end";
        if (lineRef.current !== next) {
          lineRef.current = next;
          setLine(next);
        }
      }}
      onPointerLeave={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const leftSlot =
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom;
        if (leftSlot && lineRef.current !== null) {
          lineRef.current = null;
          setLine(null);
        }
      }}
    >
      {dragActive && line === "start" && (
        <span
          className={cn(
            "w95-dropline",
            multiColumn ? "w95-dropline--left" : "w95-dropline--top",
          )}
          aria-hidden="true"
        />
      )}
      {children}
      {dragActive && line === "end" && (
        <span
          className={cn(
            "w95-dropline",
            multiColumn ? "w95-dropline--right" : "w95-dropline--bottom",
          )}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export function StoryCard({
  item,
  onDragStart,
  onDragEnd,
  onDropAtPoint,
  onOpen,
  onPrefetch,
  onCancelPrefetch,
  onContextMenu,
  dragging,
  busyLabel,
  zebra = false,
  matchNeedle = null,
  enlarged = false,
  showTagVisuals = true,
}: {
  item: WorkItem;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropAtPoint: (clientX: number, clientY: number) => void;
  onOpen: () => void;
  onPrefetch: () => void;
  onCancelPrefetch: () => void;
  // Right-click on the card: opens the Win95 context menu at the pointer.
  onContextMenu: (x: number, y: number) => void;
  dragging: boolean;
  // Non-null while a write for this work item is in flight with Azure DevOps.
  busyLabel: string | null;
  /**
   * The active filter text (already trimmed + lowercased), or null when no
   * filter is running. Used only to explain a match the card can't show: see
   * `secondaryFieldMatch` below.
   */
  matchNeedle?: string | null;
  // Odd rows render a slightly lighter face so a long list of identically
  // grey 95 cards stays readable. Purely cosmetic — the raised bevel, the
  // category border accent, drag/busy states are all untouched.
  zebra?: boolean;
  /** Larger, single-column presentation used by a maximized engineer window. */
  enlarged?: boolean;
  /** Board-level display control; details and tag data remain unchanged. */
  showTagVisuals?: boolean;
}) {
  const area = areaMeta(item.area);
  const state = stateMeta(item.state);
  const busy = Boolean(busyLabel);
  const suppressOpenAfterDrag = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const tagVisualFrameClass = useTagVisualFrameClasses(item);
  // Created 3+ years ago -> the corner cobweb. Decoration only; it reads the
  // same created date the stamp does, and an item with no parseable date never
  // gets one.
  const ancient = isAncientWorkItem(item);
  // Is THIS the card whose right-click menu is currently open? Read from the
  // menu's own state, so it needs no prop and cannot drift out of step.
  const menuTarget = useIsMenuTarget(item.id);
  // A filtered card whose title doesn't contain the search text matched in its
  // description, raw tags, or configured tag label. That content may not be
  // visible on the compact card, so explain why the result is present.
  const secondaryFieldMatch = matchNeedle
    ? !item.title.toLowerCase().includes(matchNeedle)
    : false;
  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );
  return (
    <div
      onPointerDown={(e) => {
        if (busy || e.button !== 0 || !e.isPrimary) return;
        dragCleanupRef.current?.();

        const pointerId = e.pointerId;
        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;
        const previousUserSelect = document.body.style.userSelect;

        const cleanup = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", cancel);
          window.removeEventListener("blur", blur);
          document.body.style.userSelect = previousUserSelect;
          document.body.classList.remove("w95-pointer-dragging");
          dragCleanupRef.current = null;
        };
        const move = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          if (
            !dragging &&
            Math.hypot(event.clientX - startX, event.clientY - startY) < 5
          ) {
            return;
          }
          if (!dragging) {
            dragging = true;
            suppressOpenAfterDrag.current = true;
            document.body.style.userSelect = "none";
            document.body.classList.add("w95-pointer-dragging");
            onDragStart();
          }
          event.preventDefault();
        };
        const finish = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          cleanup();
          if (dragging) onDropAtPoint(event.clientX, event.clientY);
          window.setTimeout(() => {
            suppressOpenAfterDrag.current = false;
          }, 0);
        };
        const cancel = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          cancelGesture();
        };
        const cancelGesture = () => {
          cleanup();
          if (dragging) onDragEnd();
          window.setTimeout(() => {
            suppressOpenAfterDrag.current = false;
          }, 0);
        };
        const blur = () => cancelGesture();

        dragCleanupRef.current = cleanup;
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("blur", blur);
      }}
      onClick={(event) => {
        if (suppressOpenAfterDrag.current) {
          event.preventDefault();
          return;
        }
        onOpen();
      }}
      onPointerEnter={onPrefetch}
      onPointerLeave={onCancelPrefetch}
      // Right-click opens the 95 context menu (Copy link / Open in ADO /
      // Change state / Unassign)
      // instead of the browser's own menu. It never starts a drag and never
      // reaches the card's click handler, so the detail dialog stays closed.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return; // a write is already in flight for this work item
        onContextMenu(e.clientX, e.clientY);
      }}
      title={
        busy
          ? `${busyLabel} — writing to Azure DevOps…`
          : "Click to open · right-click for actions · drag to another list to assign, or between cards to re-order (writes to Azure DevOps)"
      }
      className={cn(
        // Denser type + tighter vertical padding than before, so noticeably
        // more work items fit in each (now scrollable) list.
        // `relative` is the positioning context for the corner cobweb below.
        "w95-item w95-interactive group relative flex cursor-pointer items-start border-l-4",
        enlarged ? "gap-2 px-3 py-2" : "gap-1 px-1.5 py-0.5",
        // Zebra striping: the light band is brightened from #d6d3ce to #e4e1dc
        // so alternating rows read more clearly against the 95 #c0c0c0 face.
        zebra ? "bg-[#e4e1dc]" : "bg-[#c0c0c0]",
        "shadow-[inset_-1px_-1px_0_0_#0a0a0a,inset_1px_1px_0_0_#ffffff,inset_-2px_-2px_0_0_#808080,inset_2px_2px_0_0_#dfdfdf]",
        area?.border,
        dragging && "opacity-50",
        busy && "cursor-wait",
        // This card's right-click menu is open -> 95 selection ring + wash.
        // Purely visual, and it clears when the menu does.
        menuTarget && "w95-menutarget",
        showTagVisuals && tagVisualFrameClass,
      )}
    >
      {/* Ancient item -> cobweb in the top-right corner. Absolutely positioned
          and click-through, so it adds no layout and the card behaves exactly
          as it did without it. The id picks WHICH of the four webs it wears,
          so this card shows the same one here, in My Work and in Triage. */}
      {ancient && <CobwebIndicator seed={item.id} />}
      {/* `self-center` overrides the row's `items-start`, so the drag handle
          sits on the card's vertical mid-line (across both the title line and
          the meta row) instead of hugging the top edge. */}
      <GripVertical
        className={cn(
          "shrink-0 self-center text-[#808080]",
          enlarged ? "h-5 w-5" : "h-3 w-3",
        )}
      />
      {/* Compact layout: one tight title line + a single inlined meta row, so
          more work items fit on screen while staying readable and draggable. */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "flex items-start gap-1 font-bold leading-tight",
            enlarged ? "text-[15px]" : "text-[10px]",
          )}
        >
          <span className="min-w-0">{item.title}</span>
        </p>
        <div
          className={cn(
            "flex flex-wrap items-center gap-y-0.5 leading-none",
            enlarged ? "mt-2 gap-x-2" : "mt-0.5 gap-x-1.5",
          )}
        >
          <span
            className={cn(
              "inline-flex items-center gap-1 px-1 py-px font-medium ring-1 ring-black/20",
              enlarged ? "text-[12px]" : "text-[9px]",
              state.badge,
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", state.dot)} />
            {item.state}
          </span>
          {showTagVisuals && <TagChips item={item} />}
          {/* Why this card is in a filtered list when its title shows no sign
              of the search text. Same 95 chip shape as the badges either side
              of it, so it reads as part of the meta row rather than an alert. */}
          {secondaryFieldMatch && (
            <span
              className={cn(
                "inline-flex items-center gap-1 bg-[#dfdfdf] px-1 py-px font-medium text-[#000080] ring-1 ring-black/20",
                enlarged ? "text-[12px]" : "text-[9px]",
              )}
              title="Matched in this work item's description, tags, or configured tag label rather than its title"
            >
              <Search className="h-2.5 w-2.5" />
              in details or tags
            </span>
          )}
          {busy && (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#000080]">
              <Loader2 className="h-3 w-3 animate-spin" />
              {busyLabel}…
            </span>
          )}
          {/* Category tag is snapped to the RIGHT edge of the card; the
              state and configured tags stay left. `ml-auto` eats the free space, so it
              still trails the row cleanly when the meta wraps. */}
          <span
            className={cn(
              "ml-auto shrink-0 px-1 py-px font-medium ring-1 ring-black/20",
              enlarged ? "text-[12px]" : "text-[9px]",
              area?.tag,
            )}
          >
            {area?.name}
          </span>
        </div>
      </div>
      {/* The square "Open in ADO" button that used to sit here is GONE: the
          Azure DevOps link now lives in the right-click menu ("Open in Azure
          DevOps" and "Copy link") for every card in the app, which gives the
          card its full width back for the title and meta row. Nothing is lost —
          both actions are one right-click away, and the detail dialog still
          carries the link too. */}
    </div>
  );
}
