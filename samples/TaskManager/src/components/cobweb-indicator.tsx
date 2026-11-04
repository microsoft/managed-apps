import { cn } from "@/lib/utils";
import { ANCIENT_YEARS } from "@/lib/work-items-data";

/**
 * The "this one has been here a while" marker — a corner COBWEB, shown on any
 * work item whose [System.CreatedDate] is at least ANCIENT_YEARS old (see
 * isAncientWorkItem), in every view that renders work item CARDS: the board's
 * engineer lists and backlog columns, the Completed tab, My Work's cards, and
 * both Triage lists.
 *
 * It is DECORATION, not a status signal — a small joke about age, deliberately
 * built so it cannot be mistaken for one of the real markers:
 *
 *  • It is flat mid-grey (#808080), not a signal colour. The flame owns
 *    orange/yellow and the caution tape owns yellow/black; grey says "dust",
 *    which is exactly the point, and it stays legible on every card surface
 *    this app has — both zebra bands, both grey-red bug tints, and the greyed
 *    finished rows — without shouting on any of them.
 *  • It sits in the CORNER, not in the marker slot beside the title. The flame
 *    and the wrench mean "act on this"; the web means "nobody has". Keeping it
 *    out of their slot keeps that distinction visible.
 *
 * Drawn in the same idiom as HotIndicator and RepairIndicator: a hand-plotted
 * inline SVG of flat-filled 1x1 rects with `shape-rendering: crispEdges`, so
 * every edge stays hard at any zoom like a 16-colour VGA icon. NOT an emoji
 * glyph (🕸 renders as a modern full-colour picture and instantly breaks the
 * period look) and no gradients.
 *
 * THE SILHOUETTE is a corner web on a 14x14 grid, anchored into the TOP-RIGHT
 * corner at (13,0) — the corner it would actually be strung across. Radial
 * threads fan out from that anchor, and quarter-circle arcs about it cross
 * them; the arcs are what make it read as a WEB rather than a fan of lines.
 *
 * FOUR VARIANTS are plotted, so a wall of ancient work items doesn't look
 * rubber-stamped. They are the same web in the same family — same grid, same
 * anchor, same single grey, same corner-dense falloff — differing along one
 * clear axis each, which is what keeps them distinguishable at 14px:
 *
 *  • CLASSIC  — 5 radials, arcs at r=4/8/12.               76 px, the baseline.
 *  • SPARSE   — 4 radials, just 2 widely spaced arcs.      60 px, airier.
 *  • TATTERED — the outer arc is TORN (three pixels gone), a loose end hangs
 *    from the tear, and the shallow radial is snapped short. 73 px, neglected.
 *  • DENSE    — a 6th radial and 4 tighter arcs.           82 px, tighter weave.
 *
 * A spider on a drop-line was plotted and rejected: at 14px, in one flat tone,
 * nine pixels of body and legs read as a smudge rather than a spider, and it
 * put the heaviest ink at the BOTTOM-LEFT — the part furthest into the card,
 * which is precisely where this thing has to stay out of the way.
 *
 * Every plot is drawn on the grid it is rendered at, 1 unit = 1 CSS pixel: this
 * is hand-plotted pixel art, and scaling it by a fraction would land 1-unit
 * rects on non-integer boundaries, so an even hard-edged line would render as
 * an uneven one — some pixels fat, some dropped entirely.
 *
 * Density is highest AT the corner and thins going inward in every variant,
 * which is both how a real web hangs and what makes the placement safe: the
 * dense end sits in the card's padding, and what reaches inward is only ever
 * one or two pixels per row.
 *
 * ⚠️ THE BOTTOM-LEFT REGION IS DELIBERATELY EMPTY, AND SOMETHING DEPENDS ON IT.
 * In EVERY variant, no pixel below y=7 is left of x=3. The Triage "Recently
 * created" rows are the one place whose top-right corner is already occupied —
 * their created-on stamp is a right-aligned column starting at the top of the
 * row, whose right edge is the row's 12px padding — and at 14px the web's BOX
 * overlaps that column by 3px. It stays off the text only because no ink falls
 * in those 3 columns below the stamp's top edge. ADD OR RE-PLOT A VARIANT AND
 * THIS HAS TO BE RE-CHECKED for it, or the age and date get grey pixels on
 * them. It is a property of the plots, not of the placement, so it cannot be
 * enforced anywhere but here.
 *
 * WHICH VARIANT a work item gets is derived from its ID, so it is stable: the
 * same item shows the same web on the Board, in My Work, in Triage and on the
 * Completed tab, across refreshes, re-sorts and re-renders. Nothing about it
 * depends on render order, array position or randomness — see variantFor().
 *
 * WHERE IT FITS, measured against each card's own padding and type:
 *
 *  • Board and Completed cards are the densest (`px-1.5 py-0.5`): the web
 *    spans y=1..15 and their meta row — which carries the right-aligned
 *    category tag — starts at ~16.5px, so it clears the tag by ~1.5px. Their
 *    top-right corner is otherwise free, because the tag is on the meta row
 *    and not on the title line.
 *  • My Work cards (`px-2 py-1.5`) clear by ~8.8px, Triage's "Needs
 *    rerouting" rows (`px-4 py-3`) by ~14.8px — and on the latter the web sits
 *    entirely inside the 16px right padding, clear of the reroute picker.
 *
 * NESTED ROWS still get no web at all, and this change doesn't alter that:
 * they are 18px strips whose right-hand end carries a state badge, so the
 * blocker there was never the web's SIZE but that the corner is occupied by
 * something the web would sit on top of.
 *
 * Positioned and made click-through by `.w95-cobweb` in win95.css.
 */

/** One plotted pixel on the 14x14 grid: [x, y]. */
type Pixel = [number, number];

interface CobwebVariant {
  /** For reading the code by, only. Never shown, and never announced. */
  name: string;
  /** Radial threads fanning from the anchor. */
  threads: Pixel[];
  /** The arcs crossing them. Thread pixels are excluded so nothing is
   *  painted twice. */
  arcs: Pixel[];
}

// The top and right edges are the two threads every variant hangs from, so
// they are written once rather than copied into each plot.
const TOP_EDGE: Pixel[] = [
  [13, 0], [12, 0], [11, 0], [10, 0], [9, 0], [8, 0], [7, 0],
  [6, 0], [5, 0], [4, 0], [3, 0], [2, 0], [1, 0], [0, 0],
];
const RIGHT_EDGE: Pixel[] = [
  [13, 1], [13, 2], [13, 3], [13, 4], [13, 5], [13, 6], [13, 7],
  [13, 8], [13, 9], [13, 10], [13, 11], [13, 12], [13, 13],
];
/** The 45° radial, in all four. */
const DIAGONAL: Pixel[] = [
  [12, 1], [11, 2], [10, 3], [9, 4], [8, 5], [7, 6], [6, 7], [5, 8], [4, 9],
];
/** Between the 45° and the right edge. */
const STEEPER: Pixel[] = [[12, 2], [11, 4], [10, 6], [9, 8], [8, 10]];
/** Between the 45° and the top edge. */
const SHALLOWER: Pixel[] = [[11, 1], [9, 2], [7, 3], [5, 4], [3, 5]];

const CLASSIC: CobwebVariant = {
  name: "classic",
  threads: [...TOP_EDGE, ...RIGHT_EDGE, ...DIAGONAL, ...STEEPER, ...SHALLOWER],
  arcs: [
    // r=4, tucked into the corner
    [9, 1], [10, 2], [11, 3], [12, 4],
    // r=8, across the middle
    [5, 1], [5, 2], [6, 3], [6, 4], [7, 5], [8, 6], [9, 7], [10, 7], [11, 8], [12, 8],
    // r=12, the outermost sweep
    [1, 1], [1, 2], [1, 3], [2, 4], [2, 5], [3, 6], [3, 7], [4, 8], [5, 9],
    [6, 10], [7, 10], [8, 11], [9, 11], [10, 12], [11, 12], [12, 12],
  ],
};

/** Four radials and only two arcs, spaced wide — an old, slack web. */
const SPARSE: CobwebVariant = {
  name: "sparse",
  threads: [...TOP_EDGE, ...RIGHT_EDGE, ...DIAGONAL, ...STEEPER],
  arcs: [
    // r=5
    [8, 1], [8, 2], [9, 3], [10, 4], [12, 5], [11, 5],
    // r=11
    [2, 1], [2, 2], [2, 3], [3, 4], [3, 5], [4, 6], [5, 7], [6, 8], [7, 9],
    [9, 10], [12, 11], [11, 11], [10, 11],
  ],
};

/**
 * A web that has given up: the outermost arc is TORN — (3,6), (3,7) and (4,8)
 * are simply not there — a loose end dangles below the tear, and the shallow
 * radial is snapped off after three pixels instead of reaching the edge.
 */
const TATTERED: CobwebVariant = {
  name: "tattered",
  threads: [
    ...TOP_EDGE, ...RIGHT_EDGE, ...DIAGONAL, ...STEEPER,
    // the shallow radial, snapped short
    [11, 1], [9, 2], [7, 3],
  ],
  arcs: [
    // r=4
    [9, 1], [10, 2], [11, 3], [12, 4],
    // r=8
    [5, 1], [5, 2], [6, 3], [6, 4], [7, 5], [8, 6], [10, 7], [9, 7], [12, 8], [11, 8],
    // r=12, torn open on the left flank
    [1, 1], [1, 2], [1, 3], [2, 4], [2, 5], [5, 9], [7, 10], [6, 10], [9, 11],
    [8, 11], [12, 12], [11, 12], [10, 12],
    // the loose end left hanging from the tear
    [5, 10], [5, 11],
  ],
};

/** Six radials and four tighter arcs — a busier, better-kept weave. */
const DENSE: CobwebVariant = {
  name: "dense",
  threads: [
    ...TOP_EDGE, ...RIGHT_EDGE, ...DIAGONAL, ...STEEPER, ...SHALLOWER,
    // the sixth radial, steepest of all, hugging the right edge
    [12, 3], [11, 6], [10, 9], [9, 12],
  ],
  arcs: [
    // r=3
    [10, 1],
    // r=6
    [7, 1], [7, 2], [8, 3], [10, 5], [12, 6],
    // r=9
    [4, 1], [4, 2], [5, 3], [6, 5], [6, 6], [8, 7], [7, 7], [10, 8], [12, 9], [11, 9],
    // r=12
    [1, 1], [1, 2], [1, 3], [2, 4], [2, 5], [3, 6], [3, 7], [4, 8], [5, 9],
    [7, 10], [6, 10], [9, 11], [8, 11], [12, 12], [11, 12], [10, 12],
  ],
};

const VARIANTS: CobwebVariant[] = [CLASSIC, SPARSE, TATTERED, DENSE];

/**
 * A work item id -> one of the variants, stably.
 *
 * FNV-1a over the id string, then murmur3's finalizer. The finalizer is the
 * point, not decoration: Azure DevOps ids are SEQUENTIAL, and picking with
 * `id % 4` on sequential ids gives a perfect repeating 0,1,2,3,0,1,2,3 —
 * which, down a list sorted by id or by a rank that tracks it, reads as an
 * obvious stripe rather than as variety. Plain FNV-1a is barely better here:
 * its last step multiplies by a constant that is 3 mod 4, so the low bits stay
 * tied to the last DIGIT of the id and the same march comes back (measured:
 * 62% of ids matched the one four places away, against 25% for no pattern).
 * The finalizer avalanches the high bits down into the low ones, which takes
 * that to 24-26% at every lag from 1 to 10, with the four variants coming out
 * even across a 4000-id block.
 *
 * It reads only the id — never the render order, the array index, the item's
 * position in a list, or anything random — so the same work item wears the
 * same web everywhere it appears and after every refresh.
 */
function hashId(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function variantFor(seed: string): CobwebVariant {
  return VARIANTS[hashId(seed) % VARIANTS.length] ?? CLASSIC;
}

function band(pixels: Pixel[], fill: string) {
  return pixels.map(([x, y]) => (
    <rect key={`${fill}-${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />
  ));
}

export function CobwebIndicator({
  /**
   * The work item's id — what the variant is picked from. REQUIRED, and
   * required on purpose: defaulting it would quietly give some view a single
   * fixed web while every other view varied, and that would be invisible until
   * someone noticed one list looked rubber-stamped.
   */
  seed,
  className,
  label = `Gathering dust — nobody has touched this in over ${ANCIENT_YEARS} years. Mind the cobwebs.`,
}: {
  seed: string;
  className?: string;
  label?: string;
}) {
  // Says what the web MEANS, then the fact behind it — same shape of label as
  // the flame's and the wrench's, with the joke kept to the tail end so the
  // information still comes first.
  //
  // IDENTICAL FOR EVERY VARIANT. Which web an item drew is decoration and
  // carries no information, so it is not announced, not in the tooltip, and
  // not otherwise distinguishable to assistive tech — that would be inventing
  // a distinction the app doesn't mean.
  const variant = variantFor(seed);
  return (
    <span
      className={cn("w95-cobweb", className)}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 14 14"
        width="14"
        height="14"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        {/* One flat tone for the whole web, in every variant. The structure
            does the work here, not the colour — a second tone reads as noise
            even at 14px, and any colour at all would make it look like a
            status. Varying the COLOUR between variants would be exactly that
            mistake, which is why they vary only in weave. */}
        {band(variant.threads, "#808080")}
        {band(variant.arcs, "#808080")}
      </svg>
    </span>
  );
}
