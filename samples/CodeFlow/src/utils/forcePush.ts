import type { Iteration } from '../types';

/**
 * Force-push awareness.
 *
 * GitHub has no concept of review iterations, so the app reconstructs them from
 * the commits currently reachable from the PR head. A force-push rewrites that
 * history: the commits the author previously pushed stop being reachable and
 * silently disappear from the iteration list. The app can't show a diff for a
 * state it can no longer see, but it should at least say so rather than
 * presenting a shortened list as if it were the whole story.
 *
 * Only report a warning when commit SHAs recorded on an earlier visit have
 * disappeared. Author/committer date gaps alone cannot establish a force-push:
 * cherry-picks, patches applied on someone's behalf, and local rebases before
 * the first push also produce them without removing any published iterations.
 */

/**
 * Commits written and committed at the same instant have identical timestamps.
 * A gap this large suggests the commit was replayed or amended well after it
 * was authored, not that the published branch was force-pushed. The tolerance
 * absorbs clock skew and the sub-second spread of a normal `git commit`.
 */
export const REWRITE_THRESHOLD_MS = 60_000;

/** Commit SHAs seen on a PR branch, used to notice when history is rewritten. */
export interface IterationHistory {
  /** Non-base commit SHAs observed on the branch at the last visit. */
  knownShas: string[];
  /** SHAs seen previously that have since vanished from the branch. */
  lostShas: string[];
  updatedAt: string;
}

export interface ForcePushInfo {
  /** True when previously-seen commits have vanished — proof of a force-push. */
  confirmed: boolean;
  /** How many commits we know were dropped from the branch. */
  lostCount: number;
  /** True when commit metadata suggests history was rewritten. */
  rewriteEvidence: boolean;
}

/**
 * True when `committerDate` is meaningfully later than `authorDate`. Missing or
 * unparseable dates are treated as "no evidence" so a metadata gap never
 * produces a false warning.
 */
export function isRewrittenCommit(
  authorDate?: string,
  committerDate?: string,
): boolean {
  if (!authorDate || !committerDate) return false;
  const authored = Date.parse(authorDate);
  const committed = Date.parse(committerDate);
  if (Number.isNaN(authored) || Number.isNaN(committed)) return false;
  return committed - authored > REWRITE_THRESHOLD_MS;
}

/**
 * Require observed commit loss before reporting a force-push. Commit metadata
 * is supplemental only; without losses, return `undefined` to keep the UI quiet.
 */
export function detectForcePush(
  iterations: Iteration[],
  history?: IterationHistory,
): ForcePushInfo | undefined {
  const lostCount = history?.lostShas.length ?? 0;
  if (lostCount === 0) return undefined;
  const rewriteEvidence = iterations.some((it) => !it.isBase && it.rewritten);
  return { confirmed: true, lostCount, rewriteEvidence };
}
