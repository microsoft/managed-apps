import type { ChecksSummary, GitUserRef, MergeMethod, PrSummary } from '../../types';
import { tallyRequired } from '../../services/checks/checksQuery';

/**
 * Whether the merge control should appear at all, and if so whether it can be
 * pressed.
 *
 * `visible: false` is a stronger statement than `ready: false`. Invisible means
 * "this is not your decision to make" — you are not the author, or the PR is
 * already finished. Visible-but-not-ready means "yours, but not yet", and
 * always carries a `reason` saying what is missing.
 */
export interface MergeGate {
  visible: boolean;
  ready: boolean;
  /** Why it can't be merged yet, phrased for a tooltip. */
  reason?: string;
}

/**
 * What {@link evaluateMergeGate} needs. Note the absence of check results:
 * they inform {@link describeCheckWarning}, and deliberately have no say in
 * whether the button works.
 */
export interface MergeGateInput {
  pr?: PrSummary;
  currentUser?: GitUserRef;
}

const HIDDEN: MergeGate = { visible: false, ready: false };

/** Logins differ only by display case; GitHub itself treats them as equal. */
function sameUser(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Decide whether the signed-in user may merge this PR right now.
 *
 * Deliberately restrictive about *who*: only the author sees the button, so
 * nobody can land someone else's work from a review tool.
 *
 * Deliberately permissive about *what*. Only two things block the button, and
 * both are cases GitHub itself cannot merge no matter who asks: a draft, and a
 * branch with conflicts. Check results are **not** among them. Unmet required
 * checks are a warning, not a client-side veto — see {@link describeCheckWarning}.
 * Optional checks are informational and do not warn on the confirmation panel.
 *
 * That is the whole point of merging from here. GitHub already refuses the
 * merge server-side when a branch protection rule genuinely requires green
 * checks, so a second gate in the client can only ever produce false negatives:
 * one flaky or irrelevant failure, or a rollup this app could not read, and the
 * author is pushed back out to GitHub to do the very thing this button exists
 * to save them.
 */
export function evaluateMergeGate(input: MergeGateInput): MergeGate {
  const { pr, currentUser } = input;
  if (!pr) return HIDDEN;
  // Only the author. A reviewer who wants this should be asking the author.
  if (!sameUser(currentUser?.login, pr.author?.login)) return HIDDEN;
  if (pr.merged) return HIDDEN;
  if (pr.state === 'closed') return HIDDEN;

  if (pr.draft) {
    return { visible: true, ready: false, reason: 'This pull request is still a draft.' };
  }
  if (pr.mergeable === false) {
    return {
      visible: true,
      ready: false,
      reason: 'This branch has conflicts that must be resolved first.',
    };
  }
  return { visible: true, ready: true };
}

/**
 * What the confirmation panel should say about the checks, or `undefined` when
 * there is nothing worth saying.
 *
 * This is the counterpart to {@link evaluateMergeGate}'s silence on checks:
 * advice at the moment of decision, rather than a locked button with a tooltip.
 * Absent or still-loading checks produce nothing, because "we could not tell"
 * is not evidence of a problem and must not be dressed up as one.
 */
export function describeCheckWarning(
  checks?: ChecksSummary,
  checksLoading?: boolean,
): string | undefined {
  if (checksLoading || !checks || checks.total === 0) return undefined;
  const required = tallyRequired(checks.checks);
  const parts: string[] = [];
  if (required.failed > 0) {
    parts.push(`${required.failed} required check${required.failed === 1 ? '' : 's'} failing`);
  }
  if (required.pending > 0) {
    parts.push(`${required.pending} required check${required.pending === 1 ? '' : 's'} still running`);
  }
  if (parts.length === 0) return undefined;
  return `${parts.join(', ')}. You can merge anyway — GitHub will refuse if a branch rule says otherwise.`;
}

/** The three strategies GitHub offers, in the order its own UI lists them. */
export const MERGE_METHODS: readonly { value: MergeMethod; label: string; hint: string }[] = [
  { value: 'merge', label: 'Merge commit', hint: 'Keep every commit and add a merge commit' },
  { value: 'squash', label: 'Squash', hint: 'Combine every commit into one' },
  { value: 'rebase', label: 'Rebase', hint: 'Replay each commit onto the base branch' },
];
