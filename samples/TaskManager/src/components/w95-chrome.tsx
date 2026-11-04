import { cn } from "@/lib/utils";
import { Maximize2, Minimize2 } from "lucide-react";
import { type ReactNode } from "react";

export function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
  className,
  iconOnly = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count?: number;
  /** Extra layout classes (e.g. `sm:ml-auto` to right-align a tab). */
  className?: string;
  /**
   * Show the icon alone, with no text in the strip.
   *
   * The tab is still NAMED: `label` moves to `aria-label` and to the `title`
   * tooltip, so assistive tech announces it exactly as before and hovering
   * says what it is. `.w95-tab--icon` squares up the horizontal padding, which
   * was sized for a text label — without it the tab keeps 12px either side of
   * a 14px glyph and reads as a stretched, oddly empty box. Everything else is
   * untouched: same bevel, same active state, same real <button>, so keyboard
   * focus and activation are unchanged.
   */
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      className={cn(
        "w95-tab",
        active && "w95-tab--active",
        iconOnly && "w95-tab--icon",
        className,
      )}
    >
      {icon}
      {!iconOnly && label}
      {typeof count === "number" && count > 0 && (
        <span className="w95-field px-1 text-[10px] font-bold">{count}</span>
      )}
    </button>
  );
}

/**
 * Section heading with the 95 icon tile — now a SINGLE ROW: the subtitle sits
 * inline beside the title instead of stacked under it, and the tile shrinks to
 * the line height. That takes the header from two text lines + 1.5 units of
 * padding down to one tight line, and the reclaimed vertical space goes
 * straight to the scrolling list below it (the regions are flex children, so
 * whatever the header gives up the list viewport gains).
 *
 * `flex-nowrap` + `truncate` keep it one row even on a narrow viewport — the
 * subtitle elides rather than wrapping the header back to two lines.
 */
export function SectionHeading({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-1 flex min-w-0 flex-nowrap items-center gap-2 border-b-2 border-[#808080] px-1 pb-0.5">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center bg-[#000080] text-white">
        {icon}
      </span>
      <h2 className="shrink-0 text-[12px] font-bold leading-tight">{title}</h2>
      <p className="min-w-0 flex-1 truncate text-[11px] leading-tight text-[#404040]">
        {subtitle}
      </p>
      {action}
    </div>
  );
}

/**
 * Compact variant of SectionHeading: a single line — title with the subtitle
 * inline beside it, and no icon tile — used where header height is worth more
 * than the decoration (the Backlog region).
 *
 * `px-1` gives the title the same left inset as the icon-tile heading above it,
 * so the two region headers line up with each other (and with the bevelled
 * cards below) instead of the Backlog title sitting flush against the left edge.
 */
export function InlineSectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-1 flex min-w-0 flex-nowrap items-center gap-x-2 border-b-2 border-[#808080] px-1 pb-0.5">
      <h2 className="shrink-0 text-[12px] font-bold leading-tight">{title}</h2>
      <p className="min-w-0 flex-1 truncate text-[11px] leading-tight text-[#404040]">
        {subtitle}
      </p>
    </div>
  );
}

/**
 * The 95 maximize / restore control that sits at the right of an engineer or
 * category window's title bar.
 *
 * It is the OBVIOUS way back out of a maximized section, alongside the
 * double-click gesture on the caption and the Escape key: a maximized window
 * shows the restore glyph, so someone who never discovers the double-click can
 * still get the board back with one click.
 *
 * Both `onDoubleClick` and `onClick` stop propagating: the title bar around it
 * carries the double-click gesture, and a fast double press on this BUTTON
 * would otherwise toggle twice and look like it did nothing.
 */
export function MaximizeButton({
  maximized,
  label,
  onClick,
}: {
  maximized: boolean;
  /** Names the window in the tooltip / accessible name, e.g. "Ana's window". */
  label: string;
  onClick: () => void;
}) {
  const title = maximized
    ? `Restore ${label} (or press Escape)`
    : `Maximize ${label}`;
  return (
    <button
      type="button"
      className="w95-titlebtn ml-1 shrink-0"
      aria-label={title}
      aria-pressed={maximized}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {maximized ? (
        <Minimize2 className="h-3 w-3" />
      ) : (
        <Maximize2 className="h-3 w-3" />
      )}
    </button>
  );
}
