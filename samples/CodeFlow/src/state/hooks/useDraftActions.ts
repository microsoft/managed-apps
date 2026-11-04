import { useCallback } from 'react';
import type { CodeFlowState } from '../codeFlowContext';
import { publishDraft as publishDraftPr } from '../../services/draft';
import { createLogger } from '../../lib/logger';

const log = createLogger('draft');

type SetState = React.Dispatch<React.SetStateAction<CodeFlowState>>;

/**
 * The author-side action on a draft: publish it.
 *
 * Throws on failure, the way {@link useReviewActions.submitReview} does, so the
 * button can put the reason in front of the person who pressed it.
 */
export function useDraftActions(state: CodeFlowState, setState: SetState) {
  const publishDraft = useCallback(async () => {
    const pr = state.pr;
    if (!pr) return;
    await publishDraftPr(pr.coordinates, pr.nodeId);

    // Clear the flag locally rather than waiting for a refresh. The poll only
    // re-reads the summary when the head sha moves (see `usePrPolling`), and
    // publishing doesn't push a commit — so without this the badge would keep
    // saying "Draft" until the reviewer reopened the PR.
    setState((prev) => {
      if (!prev.pr) return prev;
      const same =
        prev.pr.coordinates.owner === pr.coordinates.owner &&
        prev.pr.coordinates.name === pr.coordinates.name &&
        prev.pr.coordinates.number === pr.coordinates.number;
      if (!same) return prev;
      return { ...prev, pr: { ...prev.pr, draft: false } };
    });
    log.info('draft published');
  }, [state.pr, setState]);

  return { publishDraft };
}
