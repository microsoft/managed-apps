import { useCallback } from 'react';
import type { MergeMethod, MergeOutcome } from '../../types';
import type { CodeFlowState } from '../codeFlowContext';
import { GitHubService } from '../../services/githubService';
import { createLogger } from '../../lib/logger';

const log = createLogger('merge');

type SetState = React.Dispatch<React.SetStateAction<CodeFlowState>>;

/**
 * The merge action.
 *
 * Kept apart from `useReviewActions` because it isn't a review: it goes over
 * REST through the connector rather than GraphQL, and it is the one action
 * in the app that is irreversible.
 */
export function useMergeActions(state: CodeFlowState, setState: SetState) {
  const pr = state.pr;

  const mergePr = useCallback(
    async (method: MergeMethod): Promise<MergeOutcome> => {
      if (!pr) throw new Error('No pull request is loaded.');
      const outcome = await GitHubService.mergePullRequest(pr.coordinates, {
        method,
        // Pin the branch we showed. If it moved, GitHub refuses rather than
        // merging commits the author never saw.
        expectedHeadSha: pr.headSha || undefined,
      });
      log.info('merged pull request');
      // Reflect the merge immediately rather than waiting up to a whole refresh
      // interval for the poll to observe it, or the topbar keeps offering to
      // merge a pull request that is already merged. The poll folds the same
      // state in when it next runs, and treats `merged` as one-way, so it can
      // only agree with this — never undo it.
      setState((s) =>
        s.pr && s.pr.coordinates.number === pr.coordinates.number
          ? { ...s, pr: { ...s.pr, merged: true, state: 'closed' } }
          : s,
      );
      return outcome;
    },
    [pr, setState],
  );

  return { mergePr };
}
