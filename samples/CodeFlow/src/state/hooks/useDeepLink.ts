import { useEffect, useRef, useState } from 'react';
import { updateUrlTarget, type DeepLinkTarget } from '../../utils/deepLink';
import { rememberOpenPr, resolveOpenTarget } from '../../utils/openPrMemory';
import type { CommentThread } from '../../types';
import type { CodeFlowActions, CodeFlowState, LoadStatus } from '../codeFlowContext';

/**
 * The deep-link target while it is still resolving, or `null` once the load has
 * settled. Callers render a splash off this so a deep link never looks like it
 * silently dropped the reviewer on the dashboard.
 *
 * It latches on the first settle: after that the reviewer owns navigation, so
 * returning to the dashboard must not resurrect the splash.
 */
export function useDeepLinkPending(status: LoadStatus): DeepLinkTarget | null {
  const [target] = useState<DeepLinkTarget | null>(() => resolveOpenTarget());
  const [settled, setSettled] = useState(false);

  // Adjusting state during render (rather than in an effect) keeps the splash
  // from painting for one extra frame after the PR is ready.
  if (!settled && (status === 'ready' || status === 'error')) setSettled(true);

  return settled ? null : target;
}

/**
 * Find the thread a deep link points at. Links may carry a thread id, a GitHub
 * thread node id, or the id of any comment inside the thread — reviewers copy
 * links from different surfaces, so accept all three.
 */
export function findThreadForDeepLink(
  threads: CommentThread[],
  commentId: string,
): CommentThread | undefined {
  return threads.find(
    (t) =>
      t.id === commentId ||
      t.threadNodeId === commentId ||
      t.comments.some((c) => String(c.id) === commentId),
  );
}

/**
 * Open the PR named by the deep link on startup, then apply the file or
 * comment target once the PR (and its threads, which arrive asynchronously) have
 * loaded. Each step runs at most once so it never fights manual navigation.
 *
 * Also keeps the URL and the tab's record pointing at whatever PR is open now,
 * so a refresh lands on the PR the reviewer navigated to rather than the one the
 * original link named.
 */
export function useDeepLink(state: CodeFlowState, actions: CodeFlowActions): void {
  // Read once on mount; from here on this hook is what changes the URL.
  const [target] = useState<DeepLinkTarget | null>(() => resolveOpenTarget());

  const loadStartedRef = useRef(false);
  const fileAppliedRef = useRef(false);
  const commentAppliedRef = useRef(false);
  const openedPrRef = useRef(false);

  useEffect(() => {
    if (!target || loadStartedRef.current) return;
    loadStartedRef.current = true;
    void actions.loadPr({ owner: target.owner, name: target.repo, number: target.number });
  }, [target, actions]);

  const openPr = state.pr?.coordinates;

  useEffect(() => {
    if (openPr) {
      openedPrRef.current = true;
      rememberOpenPr(openPr);
      // Keep the deep link's file/comment tail while it still points at this PR;
      // once the reviewer moves on it belongs to a PR they are no longer in.
      const isLinkedPr =
        !!target &&
        target.owner === openPr.owner &&
        target.repo === openPr.name &&
        target.number === openPr.number;
      updateUrlTarget(
        isLinkedPr
          ? target
          : { owner: openPr.owner, repo: openPr.name, number: openPr.number },
      );
      return;
    }
    // Only clear once a PR has actually been open, so the idle first render
    // doesn't wipe the record before the deep link has loaded anything.
    if (openedPrRef.current && state.status === 'idle') {
      rememberOpenPr(null);
      updateUrlTarget(null);
    }
  }, [openPr, state.status, target]);

  useEffect(() => {
    if (!target || state.status !== 'ready' || !state.pr) return;

    const coords = state.pr.coordinates;
    const isTargetPr =
      coords.owner === target.owner &&
      coords.name === target.repo &&
      coords.number === target.number;
    if (!isTargetPr) return;

    if (target.file && !fileAppliedRef.current) {
      const known = (state.fullRange?.files ?? []).some((f) => f.filename === target.file);
      if (known) {
        fileAppliedRef.current = true;
        actions.selectFile(target.file);
      }
    }

    if (target.commentId && !commentAppliedRef.current) {
      const thread = findThreadForDeepLink(state.threads, target.commentId);
      if (thread) {
        commentAppliedRef.current = true;
        actions.focusThread(thread.id);
      }
    }
  }, [target, state.status, state.pr, state.threads, state.fullRange, actions]);
}
