import { useCallback } from 'react';
import type { PrCoordinates, Reviewer, ReviewState } from '../../types';
import type { CodeFlowState, ReviewEvent } from '../codeFlowContext';
import { removeInProgressReview } from '../../utils/storage';
import { createLogger } from '../../lib/logger';
import { withReviewedIteration } from './reviewedIteration';
import { samePr } from './foldPrStatus';
import { isPrAuthor, mergeAuthorApprovals, recordAuthorApproval } from '../../services/authorApproval';
import { fetchReviews } from '../../services/comments/github/reviews';
import { addPullRequestComment, submitReviewVote } from '../../services/comments/github/reviewWriter';

const log = createLogger('review');

type SetState = React.Dispatch<React.SetStateAction<CodeFlowState>>;

const VALID_REVIEW_STATES: ReviewState[] = ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING'];

/**
 * Fetch reviewer votes from GitHub (GraphQL `reviews`, every page), retaining
 * each user's approval history alongside their latest vote.
 *
 * Returns `undefined` — never an empty array — when the votes couldn't be read,
 * so a transient failure on a polling tick can't wipe the vote pills that a
 * successful earlier fetch put in the topbar. An empty array means the PR
 * genuinely has no reviews yet.
 */
export async function fetchReviewers(coords: PrCoordinates): Promise<Reviewer[] | undefined> {
  try {
    const reviews = await fetchReviews({ owner: coords.owner, repo: coords.name, pullNumber: coords.number });

    const byUser = new Map<string, Reviewer>();
    const approvalsByUser = new Map<string, Set<string>>();
    for (const review of reviews) {
      const userKey = review.login.toLowerCase();
      const state = review.state as ReviewState;
      if (!VALID_REVIEW_STATES.includes(state)) continue;
      if (state === 'APPROVED' && review.commitId) {
        const approvals = approvalsByUser.get(userKey) ?? new Set<string>();
        approvals.add(review.commitId);
        approvalsByUser.set(userKey, approvals);
      }
      const existing = byUser.get(userKey);
      if (!existing || review.submittedAt > (existing.submittedAt ?? '')) {
        byUser.set(userKey, {
          user: { login: review.login, avatarUrl: review.avatarUrl },
          state,
          submittedAt: review.submittedAt,
          commitId: review.commitId,
        });
      }
    }
    return Array.from(byUser, ([userKey, reviewer]) => {
      const approvals = approvalsByUser.get(userKey);
      return approvals ? { ...reviewer, approvedCommitIds: [...approvals] } : reviewer;
    });
  } catch (error) {
    log.warn('could not read reviews', error);
    return undefined;
  }
}

function parsePrKeyInternal(prKey: string): { owner: string; repo: string; pullNumber: number } {
  const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(prKey);
  if (!m) throw new Error(`Invalid prKey: ${prKey}`);
  return { owner: m[1], repo: m[2], pullNumber: Number(m[3]) };
}

export function useReviewActions(
  prKeyStr: string | undefined,
  state: CodeFlowState,
  setState: SetState,
  refreshThreads: () => Promise<void>,
) {
  const addIssueComment = useCallback(
    async (body: string) => {
      if (!prKeyStr) return;
      const { owner, repo, pullNumber } = parsePrKeyInternal(prKeyStr);
      await addPullRequestComment({ owner, repo, pullNumber }, body, state.pr?.nodeId);
      setState((s) => withReviewedIteration(s, prKeyStr));
      await refreshThreads();
    },
    [prKeyStr, refreshThreads, setState, state.pr?.nodeId],
  );

  const submitReview = useCallback(
    async (event: ReviewEvent, body?: string) => {
      if (!prKeyStr || !state.pr) return;
      const pr = state.pr;
      const { owner, repo, pullNumber } = parsePrKeyInternal(prKeyStr);
      if (event === 'APPROVE' && isPrAuthor(pr, state.currentUser)) {
        const approval = await recordAuthorApproval(pr, body);
        removeInProgressReview(owner, repo, pullNumber);
        setState((prev) => {
          if (prev.status !== 'ready' || !prev.pr || !samePr(prev.pr.coordinates, pr.coordinates)) return prev;
          return {
            ...withReviewedIteration(prev, prKeyStr, approval.commitId),
            authorApproval: mergeAuthorApprovals(prev.authorApproval, approval),
          };
        });
        return;
      }
      await submitReviewVote({ owner, repo, pullNumber }, event, {
        commitOid: pr.headSha || undefined,
        body: body || undefined,
        pullRequestId: pr.nodeId,
      });
      // A finished vote (Approve / Request changes) clears the PR from the
      // in-progress queue. A plain COMMENT keeps it there — the reviewer isn't
      // done yet.
      if (event === 'APPROVE' || event === 'REQUEST_CHANGES') {
        removeInProgressReview(owner, repo, pullNumber);
      }
      const coords = pr.coordinates;
      setState((prev) => (
        prev.status === 'ready' && prev.pr && samePr(prev.pr.coordinates, coords)
          ? withReviewedIteration(prev, prKeyStr, pr.headSha)
          : prev
      ));
      void fetchReviewers(coords).then((reviewers) => {
        if (!reviewers) return;
        setState((prev) => (
          prev.status === 'ready' && prev.pr && samePr(prev.pr.coordinates, coords)
            ? { ...prev, reviewers }
            : prev
        ));
      });
    },
    [prKeyStr, state.pr, state.currentUser, setState],
  );

  return { addIssueComment, submitReview };
}
