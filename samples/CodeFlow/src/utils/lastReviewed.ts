import type { Iteration, Reviewer } from '../types';

/**
 * The iteration a reviewer had selected the last time they did something that
 * counts as reviewing — marking a file seen, leaving a comment, or submitting a
 * review. Submitted reviews record their commit, not the selected comparison.
 * Recorded per PR so that returning to it can say how much has landed since.
 *
 * The SHA is the real identity; `index` is only a hint for display, because a
 * force-push renumbers every iteration but never renames a commit.
 */
export interface LastReviewed {
  /** SHA of the iteration that was being compared to. */
  sha: string;
  /** Position of that iteration when it was recorded. */
  index: number;
  /** ISO timestamp of the review, used to reconcile across devices. */
  at: string;
}

/** How far the branch has moved on since the reviewer last looked. */
export interface NewIterationsInfo {
  /** Iterations pushed since the last review. Always >= 1. */
  count: number;
  /** Where the last-reviewed iteration sits in the *current* list. */
  index: number;
  /** When that review happened. */
  at: string;
}

/** True when `value` has the shape we persist. */
export function isLastReviewed(value: unknown): value is LastReviewed {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<LastReviewed>;
  return typeof v.sha === 'string' && v.sha.length > 0 && typeof v.at === 'string';
}

/**
 * How many iterations have been pushed since the furthest reviewed commit.
 * Confirmed reviews by the current user repair missing/stale local markers.
 *
 * Returns `undefined` — meaning "nothing worth saying" — when there is no
 * record yet, when the reviewer is already on the newest iteration, or when the
 * remembered commit is no longer on the branch. That last case is a force-push,
 * where any count would be a guess; the force-push notice already covers it.
 */
export function countNewIterations(
  iterations: Iteration[],
  last: LastReviewed | undefined,
  reviews: readonly Reviewer[] = [],
): NewIterationsInfo | undefined {
  let index = last ? iterations.findIndex((it) => it.sha === last.sha) : -1;
  let at = last?.at;
  for (const review of reviews) {
    if (review.state === 'PENDING' || !review.commitId || !review.submittedAt ||
        !Number.isFinite(Date.parse(review.submittedAt))) continue;
    const reviewedIndex = iterations.findIndex((it) => !it.isBase && it.sha === review.commitId);
    if (reviewedIndex > index) {
      index = reviewedIndex;
      at = review.submittedAt;
    }
  }
  if (index < 0 || !at) return undefined;
  const count = iterations.length - 1 - index;
  if (count <= 0) return undefined;
  return { count, index, at };
}

/**
 * The record to store now, or `undefined` when the existing one already covers
 * this review.
 *
 * The marker only ever moves forward. Reviewing an older iteration — scrolling
 * back to comment on something from three pushes ago — must not rewind it, or
 * the next visit would claim there is new work the reviewer has already seen.
 * A remembered commit that has vanished from the branch is the exception: it
 * can no longer be compared against, so the current iteration replaces it.
 */
export function nextLastReviewed(
  iterations: Iteration[],
  current: LastReviewed | undefined,
  toIndex: number,
  now: string,
): LastReviewed | undefined {
  const target = iterations[toIndex];
  if (!target) return undefined;
  if (current) {
    const at = iterations.findIndex((it) => it.sha === current.sha);
    if (at >= 0 && at >= toIndex) return undefined;
  }
  return { sha: target.sha, index: toIndex, at: now };
}
