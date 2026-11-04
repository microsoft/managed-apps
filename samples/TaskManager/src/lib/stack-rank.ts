// Working out the [Microsoft.VSTS.Common.StackRank] value a dragged work item
// needs so it LANDS — and stays — exactly where it was dropped.
//
// The board sorts every list by StackRank ascending (compareByStackRank), so
// re-ordering within a list is purely a question of picking a number that sits
// strictly between the two cards the item was dropped between. Azure DevOps
// stores StackRank as a double and accepts fractional values — verified live
// against a real work item through the same JSON-Patch passthrough the app
// writes with: setting 16644818.5 returned HTTP 200, bumped `rev`, and echoed
// the field back as 16644818.5. So a midpoint is a legitimate rank, and the
// usual "write only the item you moved" strategy works.
//
// Two cases can't be solved with a midpoint, and both are handled explicitly
// rather than being allowed to produce NaN or a duplicate rank:
//
//   * a neighbour has NO rank at all (ADO never gave it one), or the two
//     neighbours have the SAME rank — there is no gap to bisect;
//   * the gap is real but too small to bisect (floating-point exhaustion:
//     prev + (next - prev) / 2 rounds back onto prev or next).
//
// Either way the answer is the same: RENORMALIZE that one list — write evenly
// spaced ranks across it — so the order the user sees is written down properly
// and every later drag has room to bisect again.

/** Only the two fields ranking cares about, so callers can pass work items. */
export interface RankedItem {
  id: string;
  stackRank?: number | null;
}

/** Spacing used at the ends of a list and when renormalizing. */
export const RANK_STEP = 1000;

/**
 * Starting rank for a list in which NOTHING has a rank yet. Arbitrary (ADO
 * StackRank values are opaque ordering numbers), but constant, so the same
 * situation always produces the same ranks. Real observed ranks are ~1.6e7,
 * comfortably clear of this.
 */
export const RANK_BASE = 1_000_000;

export type RankPlan =
  /** Write ONE field on the dragged item — the normal case. */
  | { kind: "single"; rank: number }
  /**
   * The list has to be re-spaced: every entry here needs its StackRank
   * written (the dragged item included). Only produced when a midpoint is
   * impossible.
   */
  | { kind: "renormalize"; ranks: { id: string; rank: number }[] };

/** The item's rank, or null when ADO never gave it a usable number. */
function rankOf(item: RankedItem | undefined): number | null {
  if (!item) return null;
  return typeof item.stackRank === "number" && Number.isFinite(item.stackRank)
    ? item.stackRank
    : null;
}

/**
 * Evenly re-space the whole destination list, with `moved` inserted at `index`.
 *
 * The first rank is anchored to the smallest rank already in the list (so the
 * list keeps roughly the position it had relative to everything else in the
 * project), or RANK_BASE when nothing in it is ranked at all.
 *
 * Items whose rank already equals the value they'd be given are dropped from
 * the plan — no point writing a field that wouldn't change — EXCEPT the moved
 * item, which is always written so the drag is never a silent no-op.
 */
function renormalize(
  others: RankedItem[],
  index: number,
  moved: RankedItem,
): RankPlan {
  const order = [...others];
  order.splice(index, 0, moved);

  const existing = order
    .map(rankOf)
    .filter((r): r is number => r !== null);
  const anchor = existing.length > 0 ? Math.round(Math.min(...existing)) : RANK_BASE;

  const ranks = order
    .map((item, i) => ({ id: item.id, rank: anchor + i * RANK_STEP }))
    .filter(
      (entry, i) => entry.id === moved.id || rankOf(order[i]) !== entry.rank,
    );

  return { kind: "renormalize", ranks };
}

/**
 * Plan the StackRank write for dropping `moved` at `index` in `others`.
 *
 * `others` is the destination list in DISPLAY order (StackRank ascending) with
 * the dragged item already removed; `index` is the insertion point in that
 * list, 0 .. others.length.
 */
export function planRank(
  others: RankedItem[],
  index: number,
  moved: RankedItem,
): RankPlan {
  const at = Math.max(0, Math.min(index, others.length));
  const hasPrev = at > 0;
  const hasNext = at < others.length;

  // Dropped into an empty list: nothing to sit between.
  if (!hasPrev && !hasNext) return { kind: "single", rank: RANK_BASE };

  const prev = hasPrev ? rankOf(others[at - 1]) : null;
  const next = hasNext ? rankOf(others[at]) : null;

  // A neighbour exists but carries no rank — there is no gap to bisect and no
  // deterministic number to invent, so write the list's order down properly.
  if ((hasPrev && prev === null) || (hasNext && next === null)) {
    return renormalize(others, at, moved);
  }

  // Both ends: the midpoint, unless the gap is zero (equal ranks) or too small
  // to bisect in floating point — either of which would hand back a duplicate.
  if (prev !== null && next !== null) {
    const mid = prev + (next - prev) / 2;
    if (Number.isFinite(mid) && mid > prev && mid < next) {
      return { kind: "single", rank: mid };
    }
    return renormalize(others, at, moved);
  }

  // Top of the list: one step above the current first card.
  if (next !== null) return { kind: "single", rank: next - RANK_STEP };
  // Bottom of the list: one step below the current last card.
  return { kind: "single", rank: (prev as number) + RANK_STEP };
}
