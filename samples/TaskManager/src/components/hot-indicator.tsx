import { cn } from "@/lib/utils";

/**
 * Selectable flame marker for any configured tag.
 *
 * It is drawn as a hand-plotted PIXEL FLAME — the 95-era way of saying "this
 * one is burning". Deliberately NOT an emoji glyph (🔥 renders as a modern
 * full-colour picture and instantly breaks the period look) and not a
 * gradient: it is an inline SVG of flat-filled 1x1 rects on a 12x12 grid with
 * `shape-rendering: crispEdges`, so every edge stays hard at any zoom, exactly
 * like a 16-colour VGA icon. Three flat bands only — dark ember, orange body,
 * yellow core — from the 95 system palette.
 *
 * Purely decorative chrome: the artwork is `aria-hidden` and the meaning is
 * carried by the accessible label + the title tooltip.
 */

/** One flat band of the flame: [x, y, width] rows on the 12x12 pixel grid. */
type PixelRow = [number, number, number];

// Outer ember edge (dark red-orange keyline of the flame silhouette).
const EMBER: PixelRow[] = [
  [6, 0, 1],
  [5, 1, 2],
  [5, 2, 3],
  [4, 3, 4],
  [3, 4, 6],
  [3, 5, 6],
  [2, 6, 8],
  [2, 7, 8],
  [2, 8, 8],
  [2, 9, 8],
  [3, 10, 6],
  [4, 11, 4],
];

// Main orange body, inset one pixel from the ember edge.
const BODY: PixelRow[] = [
  [6, 2, 1],
  [5, 3, 2],
  [4, 4, 3],
  [4, 5, 4],
  [3, 6, 6],
  [3, 7, 6],
  [3, 8, 6],
  [3, 9, 6],
  [4, 10, 4],
  [5, 11, 2],
];

// The hot yellow core, low and central where a real flame is brightest.
const CORE: PixelRow[] = [
  [5, 5, 1],
  [5, 6, 2],
  [4, 7, 3],
  [4, 8, 4],
  [4, 9, 4],
  [5, 10, 2],
];

function band(rows: PixelRow[], fill: string) {
  return rows.map(([x, y, w]) => (
    <rect key={`${fill}-${x}-${y}`} x={x} y={y} width={w} height={1} fill={fill} />
  ));
}

export function HotIndicator({
  className,
  label = "Flame tag visual",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn("w95-alert", className)}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 12 12"
        width="12"
        height="12"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        {band(EMBER, "#a83000")}
        {band(BODY, "#ff8000")}
        {band(CORE, "#ffff00")}
      </svg>
    </span>
  );
}
