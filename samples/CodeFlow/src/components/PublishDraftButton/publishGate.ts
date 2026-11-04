import type { GitUserRef, PrSummary } from '../../types';

/**
 * Whether the publish control should appear.
 *
 * There is no "visible but not ready" state here, unlike the merge gate: a
 * draft is either yours to publish or it isn't. Nothing about the branch — a
 * conflict, a red check — stops GitHub taking a pull request out of draft, so
 * a disabled-with-a-tooltip variant would only ever be inventing a rule.
 */
export interface PublishGate {
  visible: boolean;
}

/** What {@link evaluatePublishGate} needs. */
export interface PublishGateInput {
  pr?: PrSummary;
  currentUser?: GitUserRef;
}

const HIDDEN: PublishGate = { visible: false };

/** Logins differ only by display case; GitHub itself treats them as equal. */
function sameUser(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Decide whether the signed-in user may publish this draft right now.
 *
 * Restricted to the author, for the same reason the merge control is: taking
 * someone else's work out of draft announces it as finished on their behalf,
 * and a review tool is the wrong place to be able to do that. A reviewer who
 * wants it published should be saying so in a comment.
 *
 * A merged or closed pull request is never publishable — GitHub's own mutation
 * refuses — and neither is one that is already open for review.
 */
export function evaluatePublishGate(input: PublishGateInput): PublishGate {
  const { pr, currentUser } = input;
  if (!pr) return HIDDEN;
  if (!pr.draft) return HIDDEN;
  if (pr.merged) return HIDDEN;
  if (pr.state === 'closed') return HIDDEN;
  if (!sameUser(currentUser?.login, pr.author?.login)) return HIDDEN;
  return { visible: true };
}
