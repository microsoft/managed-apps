import { cn } from "@/lib/utils";

/**
 * Selectable repair-wrench marker for any configured tag.
 *
 * Drawn in exactly the same idiom as HotIndicator: a hand-plotted PIXEL WRENCH,
 * inline SVG, flat-filled 1x1 rects, `shape-rendering: crispEdges` — so it
 * stays hard-edged at any zoom like a 16-colour VGA icon. NOT an emoji glyph
 * (🔧 renders as a modern full-colour picture and instantly breaks the period
 * look) and no gradients: flat bands only, straight from the 95 palette.
 *
 * It is a classic OPEN-END SPANNER, drawn on the diagonal: a forked, C-shaped
 * jaw in the upper left — two three-pixel prongs either side of a two-pixel
 * slot — narrowing into a distinctly thinner handle that runs down to the
 * lower right. That silhouette is what makes it read as a wrench at icon size,
 * so the jaw slot and the head/handle width difference are load-bearing, not
 * decoration. Plotted on a 13x13 grid rather than the flame's 12x12: the extra
 * row buys the jaw its slot without thinning the prongs, and the two markers
 * still sit the same size beside each other.
 *
 * Four flat bands: a solid black KEYLINE around the whole silhouette (this is
 * what separates it from the silver card face and from the zebra striping), a
 * white HIGHLIGHT along the lit upper-left edge, a silver BODY, and a mid-grey
 * SHADE on the lower right — the standard 95 chrome read, light from the
 * upper left.
 *
 * Purely decorative artwork: the SVG is `aria-hidden` and the meaning is
 * carried by the accessible label + the title tooltip on the wrapper.
 */

/** One plotted pixel on the 13x13 grid: [x, y]. */
type Pixel = [number, number];

// Black keyline: the full outline of the spanner — both jaw prongs, the slot
// between them, and both long edges of the handle. Drawn FIRST and under
// everything, it is what makes the silhouette cut cleanly out of a silver card
// face and out of the zebra striping behind it.
const KEYLINE: Pixel[] = [
  [0, 0], [1, 0], [2, 0], [5, 0], [6, 0], [7, 0],
  [0, 1], [2, 1], [5, 1], [7, 1], [0, 2], [2, 2],
  [5, 2], [7, 2], [0, 3], [3, 3], [4, 3], [7, 3],
  [0, 4], [7, 4], [1, 5], [2, 5], [3, 5], [7, 5],
  [4, 6], [8, 6], [5, 7], [9, 7], [6, 8], [10, 8],
  [7, 9], [11, 9], [8, 10], [12, 10], [9, 11], [12, 11],
  [10, 12], [11, 12], [12, 12],
];

// White: the lit upper-left face — the top of both prongs and the highlight
// band running the length of the handle. The 95 light always comes from the
// upper left, so this is the edge that catches it.
const HIGHLIGHT: Pixel[] = [
  [1, 1], [6, 1], [1, 2], [6, 2], [1, 3], [5, 3],
  [1, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [9, 10], [10, 11],
];

// Silver body: the head's flat face and the core of the handle.
const BODY: Pixel[] = [
  [2, 4], [3, 4], [4, 4], [5, 4], [5, 5], [6, 6],
  [7, 7], [8, 8], [9, 9], [10, 10],
];

// Mid grey: the shaded lower-right face, opposite the highlight.
const SHADE: Pixel[] = [
  [2, 3], [6, 3], [6, 4], [6, 5], [7, 6], [8, 7],
  [9, 8], [10, 9], [11, 10], [11, 11],
];

function band(pixels: Pixel[], fill: string) {
  return pixels.map(([x, y]) => (
    <rect key={`${fill}-${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />
  ));
}

export function RepairIndicator({
  className,
  label = "Repair-wrench tag visual",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn("w95-alert w95-alert--wrench", className)}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 13 13"
        width="13"
        height="13"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        {band(KEYLINE, "#000000")}
        {band(SHADE, "#808080")}
        {band(BODY, "#c0c0c0")}
        {band(HIGHLIGHT, "#ffffff")}
      </svg>
    </span>
  );
}
