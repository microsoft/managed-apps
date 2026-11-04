import type { Iteration } from '../types';

/**
 * Merge-commit awareness for iteration comparisons.
 *
 * GitHub has no concept of review iterations, so the app reconstructs them from
 * the PR's commit list (base = Iteration 0, each commit = Iteration 1..N) and
 * compares two of them with a single `compare(base, head)` call.
 *
 * That call is a *three-dot* comparison: GitHub diffs from the merge base of
 * the two endpoints, not from the left endpoint itself. For the full PR range
 * that is exactly right. For a sub-range it quietly degenerates, because both
 * endpoints sit on the same branch — their merge base *is* the left endpoint,
 * so three-dot collapses to two-dot.
 *
 * Normally that's harmless. It stops being harmless when the author merges
 * another branch into their PR. A merge commit has two parents, and the second
 * one is the tip of whatever was merged in. Diffing across it therefore replays
 * every change that arrived with the merge — hundreds of files the author never
 * touched — burying the handful they did. On a real PR we measured a range
 * ending on a merge rendering 86 files, 81 of which the PR does not touch at
 * all, while hiding 32 of the PR's own 37 files completely.
 *
 * The fix is to move the *left* side of the comparison off the branch and onto
 * the mainline the merge brought in. Diffing "what was merged in" against "the
 * branch after the merge" yields precisely the branch's own contribution: the
 * author's commits plus any conflict resolutions they made while merging. On
 * that same PR it produces 37 files, every one of which appears in the PR's own
 * base..head diff.
 *
 * Two deliberate consequences worth knowing:
 *
 * 1. The result is the PR's cumulative content as of the right-hand iteration
 *    rather than a strict incremental delta. A true diff-of-diffs isn't
 *    expressible as one GitHub comparison, and a merge commit's own increment
 *    is only its conflict resolutions. Callers surface this to the reviewer
 *    rather than hiding it.
 * 2. A file whose conflict was resolved by taking the merged-in side verbatim
 *    disappears from the diff. That is correct: the PR contributes nothing to
 *    it, and it is likewise absent from the PR's own base..head diff.
 */

/**
 * SHA of the branch tip a merge commit pulled in, or `undefined` for an
 * ordinary commit. Git orders parents as [the branch merged *into*, the branch
 * merged *in*], so the second parent is the incoming mainline.
 */
export function mergedInSha(iteration: Iteration | undefined): string | undefined {
  const parents = iteration?.parents;
  if (!parents || parents.length < 2) return undefined;
  return parents[1] || undefined;
}

/** True when this iteration is a merge commit. */
export function isMergeIteration(iteration: Iteration | undefined): boolean {
  return mergedInSha(iteration) !== undefined;
}

/**
 * The commit that everything up to `index` should be measured against: the
 * mainline brought in by the most recent merge at or before `index`, falling
 * back to the PR's base when the branch has no merges yet.
 */
export function mainlineBaseOf(
  iterations: Iteration[],
  index: number,
  prBaseSha: string,
): string {
  const start = Math.min(index, iterations.length - 1);
  for (let i = start; i > 0; i--) {
    const merged = mergedInSha(iterations[i]);
    if (merged) return merged;
  }
  return prBaseSha;
}

/** The two SHAs to hand to `compare`, and whether the left side was moved. */
export interface CompareRange {
  baseSha: string;
  headSha: string;
  /** True when the left side was replaced by a merged-in mainline commit. */
  substituted: boolean;
}

/**
 * Choose the endpoints for comparing iterations `lo`..`hi`.
 *
 * When both ends share the same mainline base no merge sits between them, so
 * the literal commit-to-commit comparison is already correct and is left alone.
 * That covers the common case *and* a range starting at the merge itself, which
 * stays a minimal incremental diff.
 */
export function resolveCompareRange(
  iterations: Iteration[],
  lo: number,
  hi: number,
  prBaseSha: string,
): CompareRange {
  const from = iterations[lo];
  const to = iterations[hi];
  const headSha = to?.sha ?? '';
  if (!from || !to) {
    return { baseSha: from?.sha ?? prBaseSha, headSha, substituted: false };
  }

  const loBase = mainlineBaseOf(iterations, lo, prBaseSha);
  const hiBase = mainlineBaseOf(iterations, hi, prBaseSha);
  if (loBase === hiBase) {
    return { baseSha: from.sha, headSha, substituted: false };
  }
  return { baseSha: hiBase, headSha, substituted: true };
}

/** True when the selection covers the whole PR (base .. latest iteration). */
export function isFullRange(
  iterations: Iteration[],
  fromIndex: number,
  toIndex: number,
): boolean {
  if (iterations.length === 0) return false;
  return (
    Math.min(fromIndex, toIndex) === 0 &&
    Math.max(fromIndex, toIndex) === iterations.length - 1
  );
}

/** What the reviewer needs to be told when the comparison was rebased. */
export interface MergeBaseInfo {
  /** The merge commit responsible for the substitution. */
  merge: Iteration;
  /** Left-hand endpoint the reviewer actually selected. */
  fromIndex: number;
  /** Right-hand endpoint the reviewer actually selected. */
  toIndex: number;
  /**
   * True when the merge is the right-hand endpoint rather than sitting inside
   * the range. Descriptive only — the diff is cumulative either way, because a
   * merge commit's own increment (its conflict resolutions) isn't expressible
   * as a two-endpoint comparison, so the notice reads the same for both.
   */
  atHead: boolean;
}

/**
 * Report when the rendered diff isn't the literal range the reviewer picked.
 * Returns `undefined` when there's nothing to say — the full-PR view is always
 * correct, and a sub-range that doesn't cross a merge is compared as selected.
 */
export function detectMergeBaseSubstitution(
  iterations: Iteration[],
  fromIndex: number,
  toIndex: number,
  prBaseSha: string,
): MergeBaseInfo | undefined {
  if (isFullRange(iterations, fromIndex, toIndex)) return undefined;

  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  if (!resolveCompareRange(iterations, lo, hi, prBaseSha).substituted) return undefined;

  for (let i = hi; i > 0; i--) {
    const candidate = iterations[i];
    if (isMergeIteration(candidate)) {
      return { merge: candidate, fromIndex: lo, toIndex: hi, atHead: candidate.index === hi };
    }
  }
  return undefined;
}
