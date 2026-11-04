import type { AutoMergeStatus } from '../../services/autoMerge';
import type { GitUserRef, PrSummary } from '../../types';

/**
 * Whether the auto-merge control should appear, and if so whether it can be
 * pressed.
 *
 * Same two-level shape as the merge gate, and for the same reason: invisible
 * means "not your decision", while visible-but-not-ready always carries a
 * `reason` saying what is in the way. Auto-merge leans on that second state far
 * more heavily, because GitHub refuses it for several unrelated reasons that a
 * hidden button would leave the author guessing about.
 */
export interface AutoMergeGate {
  visible: boolean;
  ready: boolean;
  /** Why it can't be armed yet, phrased for a tooltip. */
  reason?: string;
}

/** What {@link evaluateAutoMergeGate} needs. */
export interface AutoMergeGateInput {
  pr?: PrSummary;
  currentUser?: GitUserRef;
  autoMerge?: AutoMergeStatus;
  autoMergeLoading?: boolean;
}

const HIDDEN: AutoMergeGate = { visible: false, ready: false };

/** Logins differ only by display case; GitHub itself treats them as equal. */
function sameUser(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Whether this pull request's auto-merge state is worth reading at all.
 *
 * The state costs a GraphQL round trip on every poll, and only the author can
 * act on it, so a reviewer's session shouldn't pay for it. Kept next to the
 * gate rather than in the hook that uses it so the two answers can't drift:
 * anything the gate would hide is something nothing needs to fetch.
 */
export function shouldTrackAutoMerge(pr?: PrSummary, currentUser?: GitUserRef): boolean {
  if (!pr) return false;
  if (pr.merged || pr.state === 'closed') return false;
  return sameUser(currentUser?.login, pr.author?.login);
}

/**
 * Decide whether the signed-in user may arm or disarm auto-merge right now.
 *
 * Author-only, like merging and publishing: arming auto-merge is a commitment
 * to land someone's branch unattended, and a review tool is the wrong place to
 * be able to make that commitment on their behalf.
 *
 * Once it is on, the button is always ready — turning it back off is the one
 * thing that should never be blocked, whatever else is true of the branch.
 * Turning it on defers to GitHub's own `viewerCanEnableAutoMerge`, which is the
 * only answer that accounts for repository settings, branch protection and the
 * "already mergeable, so there is nothing to wait for" case at once. A local
 * rule would be guessing at three things GitHub has already computed.
 */
export function evaluateAutoMergeGate(input: AutoMergeGateInput): AutoMergeGate {
  const { pr, currentUser, autoMerge, autoMergeLoading } = input;
  if (!shouldTrackAutoMerge(pr, currentUser)) return HIDDEN;

  if (autoMerge?.enabled) return { visible: true, ready: true };

  if (pr?.draft) {
    return {
      visible: true,
      ready: false,
      reason: 'GitHub can’t auto-merge a draft. Publish it first.',
    };
  }
  if (autoMergeLoading || !autoMerge) {
    return { visible: true, ready: false, reason: 'Reading auto-merge status…' };
  }
  if (autoMerge.viewerCanEnable === false) {
    return {
      visible: true,
      ready: false,
      reason:
        pr?.mergeableState === 'clean'
          ? 'Nothing is holding this up — merge it now instead.'
          : 'GitHub won’t allow auto-merge here. It may be turned off for this repository.',
    };
  }
  return { visible: true, ready: true };
}

/** How each strategy is named in prose, as opposed to on a radio button. */
const LABELS: Record<NonNullable<AutoMergeStatus['method']>, string> = {
  merge: 'merge commit',
  squash: 'squash',
  rebase: 'rebase',
};

/**
 * One line saying what auto-merge will do, or `undefined` when it is off.
 *
 * Names the person who armed it, because they are not always the author — a
 * reviewer with write access can arm it too, and an author who finds their own
 * pull request merging itself deserves to know who asked for that.
 */
export function describeAutoMerge(autoMerge?: AutoMergeStatus): string | undefined {
  if (!autoMerge?.enabled) return undefined;
  const how = autoMerge.method ? ` with a ${LABELS[autoMerge.method]}` : '';
  const who = autoMerge.enabledBy ? ` Armed by @${autoMerge.enabledBy}.` : '';
  return `This pull request will merge${how} as soon as its requirements are met.${who}`;
}
