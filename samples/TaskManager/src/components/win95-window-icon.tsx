import { cn } from "@/lib/utils";
import { ICON_SIZE, iconRects } from "@/lib/win95-icon";

/**
 * The app's icon — a tiny Windows 95 window — as an inline SVG.
 *
 * The drawing itself lives in lib/win95-icon.ts as plain data, shared with the
 * favicon so there is only ever one version of it. This component just paints
 * those rects.
 *
 * DECORATIVE BY DEFAULT: in the app's title bar it sits immediately beside the
 * app name in an <h1>, so announcing it as well would only repeat that name.
 * Pass a `label` where it needs to carry meaning on its own.
 */
export function Win95WindowIcon({
  className,
  label,
}: {
  className?: string;
  /** Accessible name. Omit (the default) to hide it from assistive tech. */
  label?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`}
      width={ICON_SIZE}
      height={ICON_SIZE}
      shapeRendering="crispEdges"
      className={cn("shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {iconRects().map(({ fill, rect: [x, y, w, h] }) => (
        <rect
          key={`${fill}-${x}-${y}-${w}-${h}`}
          x={x}
          y={y}
          width={w}
          height={h}
          fill={fill}
        />
      ))}
    </svg>
  );
}
