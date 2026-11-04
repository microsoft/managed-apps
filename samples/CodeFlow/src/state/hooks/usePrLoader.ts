import { useCallback, useEffect, useRef, useState } from 'react';
import { GitHubService, mergePullRequestFiles } from '../../services/githubService';
import { loadThreadsWithFallback } from '../../services/comments';
import type { CommentStore } from '../../services/comments/CommentStore';
import type { PrCoordinates } from '../../types';
import type { CodeFlowState, ViewMode } from '../codeFlowContext';
import { rangeIdOf } from '../codeFlowContext';
import {
  prKey as makePrKey,
  pushRecentPr,
  getClosedThreads,
  getClosedAttribution,
  addInProgressReview,
  removeInProgressReview,
  pruneFlaggedPrs,
  addFlaggedPr,
  recordIterationShas,
  getLastReviewed,
  refreshPrState,
} from '../../utils/storage';
import { detectForcePush } from '../../utils/forcePush';
import { foldPrStatus, samePr } from './foldPrStatus';
import { getSettings } from '../../settings/settingsStore';
import { useSettings } from '../../settings/useSettings';
import { computeSeenForRange } from './useFileSelection';
import { fetchReviewers } from './useReviewActions';
import { fetchAuthorApproval, mergeAuthorApprovals } from '../../services/authorApproval';

type SetState = React.Dispatch<React.SetStateAction<CodeFlowState>>;

const INITIAL: CodeFlowState = {
  status: 'idle',
  iterations: [],
  fromIndex: 0,
  toIndex: 0,
  comparisonLoading: false,
  seen: {},
  threads: [],
  threadsLoading: false,
  closed: {},
  closedBy: {},
  viewMode: 'inline',
  reviewers: [],
};

export function usePrLoader(
  setState: SetState,
  patch: (p: Partial<CodeFlowState>) => void,
  storeRef: React.MutableRefObject<CommentStore>,
  setBackendLabel: (label: string) => void,
) {
  const loadSeq = useRef(0);

  const loadPr = useCallback(
    async (coords: PrCoordinates) => {
      const seq = ++loadSeq.current;
      patch({ status: 'loading', error: undefined, pendingPr: coords });
      try {
        // Identity: the GitHub connector's authenticated user is the one that
        // matches review votes and comment authorship, so it wins. The
        // managed-apps host identity is only a fallback for when the connector
        // can't say who we are.
        const [pr, gitHubUser, hostUser] = await Promise.all([
          GitHubService.getPullRequest(coords),
          GitHubService.getAuthenticatedUser().catch(() => undefined),
          GitHubService.getCurrentUser().catch(() => undefined),
        ]);
        const currentUser = gitHubUser ?? hostUser;
        const repo = { owner: coords.owner, name: coords.name };
        const [fullRange, prFiles] = await Promise.all([
          GitHubService.compare(repo, pr.baseSha, pr.headSha),
          GitHubService.listPullRequestFiles(coords),
        ]);
        const iterations = await GitHubService.getIterations(pr, fullRange);
        if (seq !== loadSeq.current) return;

        // GitHub's compare endpoint caps its file list (about 300 files). The
        // pull request's own file list is complete, so any file compare left
        // out is added (without a patch) rather than silently missing.
        fullRange.files = mergePullRequestFiles(fullRange.files, prFiles);

        const fromIndex = 0;
        const toIndex = iterations.length - 1;
        const key = makePrKey(coords);

        // Re-read this PR's stored state before deriving seen marks, so changes
        // made in another tab (or by others, with a shared provider) are used.
        await refreshPrState(key);
        if (seq !== loadSeq.current) return;

        const newRangeId = rangeIdOf(iterations, fromIndex, toIndex);
        const seen = computeSeenForRange(key, newRangeId, fullRange.files);
        const closed = getClosedThreads(key);
        const closedBy = getClosedAttribution(key);

        // Fold this visit's commit list into the recorded history so commits
        // dropped by a force-push since the last visit can be reported.
        const history = recordIterationShas(
          key,
          iterations.filter((it) => !it.isBase).map((it) => it.sha),
        );
        const forcePush = detectForcePush(iterations, history);
        const lastReviewed = getLastReviewed(key);

        // Comments live on GitHub; only a genuine read failure falls back to
        // comments kept in this browser.
        const loaded = await loadThreadsWithFallback(key);
        if (seq !== loadSeq.current) return;
        storeRef.current = loaded.store;
        setBackendLabel(loaded.store.label);
        const threads = loaded.threads;
        const selectedFile = fullRange.files[0]?.filename;

        pushRecentPr({
          owner: coords.owner,
          name: coords.name,
          number: coords.number,
          title: pr.title,
          viewedAt: new Date().toISOString(),
        });

        // Auto-track this PR as an in-progress review. Cleared when the
        // reviewer submits an Approve or Request-changes vote (see
        // useReviewActions.submitReview).
        //
        // The dashboard no longer polls each tracked PR's state, so opening a
        // finished PR is the cheapest reliable moment to drop it from the
        // dashboard's lists — we already have its live state right here.
        if (pr.merged || pr.state !== 'open') {
          removeInProgressReview(coords.owner, coords.name, coords.number);
          pruneFlaggedPrs(
            (f) =>
              f.owner === coords.owner &&
              f.name === coords.name &&
              f.number === coords.number,
          );
        } else {
          addInProgressReview({
            owner: coords.owner,
            name: coords.name,
            number: coords.number,
            title: pr.title,
          });
          // Opt-in (on by default): following a PR the moment you open it, so
          // it stays reachable from the dashboard's Flagged list afterwards.
          if (getSettings().autoFlagOpenedPrs) {
            addFlaggedPr({
              owner: coords.owner,
              name: coords.name,
              number: coords.number,
              title: pr.title,
            });
          }
        }

        // Always fetch reviewer votes when loading a PR. `undefined` means the
        // fetch failed, which must not clobber whatever is already on screen.
        void fetchReviewers(coords).then((reviewers) => {
          if (!reviewers || seq !== loadSeq.current) return;
          setState((prev) => (
            prev.status === 'ready' && prev.pr && samePr(prev.pr.coordinates, coords)
              ? { ...prev, reviewers }
              : prev
          ));
        });

        if (seq !== loadSeq.current) return;
        setState(() => ({
          ...INITIAL,
          status: 'ready' as const,
          pr,
          iterations,
          fullRange,
          fromIndex,
          toIndex,
          comparison: fullRange,
          comparisonLoading: false,
          selectedFile,
          seen,
          closed,
          closedBy,
          threads,
          currentUser,
          forcePush,
          lastReviewed,
          lastRefreshAt: Date.now(),
          // Opening a PR is what the "default layout" setting describes, so it
          // wins here even if the reviewer toggled the layout on a previous PR.
          viewMode: getSettings().defaultViewMode,
          threadsLoading: false,
        }));
        void fetchAuthorApproval(pr).then((authorApproval) => {
          if (authorApproval === undefined || seq !== loadSeq.current) return;
          setState((prev) => {
            if (seq !== loadSeq.current || prev.status !== 'ready' || !prev.pr ||
                !samePr(prev.pr.coordinates, coords)) return prev;
            return {
              ...prev,
              authorApproval: authorApproval
                ? mergeAuthorApprovals(prev.authorApproval, authorApproval)
                : prev.authorApproval ?? null,
            };
          });
        });
      } catch (e) {
        if (seq !== loadSeq.current) return;
        patch({
          status: 'error',
          error: e instanceof Error ? e.message : 'Failed to load pull request',
          pendingPr: undefined,
        });
      }
    },
    [patch, setState, storeRef, setBackendLabel],
  );

  const reset = useCallback(() => {
    loadSeq.current += 1;
    setState((s) => ({ ...INITIAL, viewMode: s.viewMode as ViewMode }));
  }, [setState]);

  return { loadPr, reset, loadSeq };
}

/**
 * Poll for new/updated comments, reviewer votes, new pushes, and changes to the
 * pull request's own status.
 *
 * The cadence comes from the reviewer's `refreshIntervalSeconds` setting, which
 * defaults to five minutes and where `0` means "don't poll at all" — both worth
 * honouring, because every tick costs three GitHub round-trips and some
 * reviewers would rather refresh by hand.
 *
 * Ticks are also suppressed while the tab is hidden. A review left open in a
 * background tab has nobody watching it, but it was still spending three calls
 * a tick, indefinitely — at the old thirty-second default, around 360 an hour.
 * That is invisible against an authenticated quota of 5,000 an hour and fatal
 * against the 60 an hour GitHub gives an unauthenticated connection, which is
 * the state a lapsed connector connection silently falls into.
 */
export function usePrPolling(
  prKeyStr: string | undefined,
  state: CodeFlowState,
  refreshThreads: () => Promise<void>,
  loadPr: (coords: PrCoordinates) => Promise<void>,
  setState: SetState,
) {
  const intervalSeconds = useSettings().settings.refreshIntervalSeconds;
  // Bumped by a manual refresh so the automatic timer restarts from now rather
  // than firing again moments later.
  const [restart, setRestart] = useState(0);
  const coords = state.pr?.coordinates;
  const authorApproval = state.authorApproval;

  // The pull request currently on screen, mirrored where a poll response can
  // read it directly. A state updater is the obvious place to compare head
  // shas — it is handed the live state — but it is the wrong place to *decide*
  // anything, because React only runs an updater eagerly while no other update
  // is pending. A poll fires three requests at once and every one of them sets
  // state when it lands, so whichever of them answers first leaves the fiber
  // dirty and the pull request updater is deferred to the render phase. Any
  // decision recorded by that updater is then read back before it has been
  // made. That is what left a pushed commit missing from the iteration list
  // for as long as the reviewer kept the pull request open: not a fetch that
  // failed, but a reload that was decided on and never requested.
  const livePrRef = useRef(state.pr);
  useEffect(() => {
    livePrRef.current = state.pr;
  }, [state.pr]);

  // A reload takes several round-trips, which is long enough for the next tick
  // to observe the same moved head and ask for it all over again.
  const reloadingRef = useRef(false);

  const poll = useCallback(async () => {
    if (!coords) return;
    const polledPr = livePrRef.current;
    setState((prev) => ({ ...prev, lastRefreshAt: Date.now() }));
    await Promise.all([
      refreshThreads(),
      fetchReviewers(coords).then((reviewers) => {
        if (!reviewers) return;
        setState((prev) => (
          prev.status === 'ready' && prev.pr && samePr(prev.pr.coordinates, coords)
            ? { ...prev, reviewers }
            : prev
        ));
      }),
      polledPr && fetchAuthorApproval(polledPr).then((freshApproval) => {
        if (freshApproval === undefined) return;
        setState((prev) => (
          prev.status === 'ready' && prev.pr && samePr(prev.pr.coordinates, coords) &&
          prev.authorApproval === authorApproval
            ? { ...prev, authorApproval: freshApproval }
            : prev
        ));
      }),
      GitHubService.getPullRequest(coords).then((freshPr) => {
        // An in-flight poll can land after the reviewer has moved on. Its
        // answer is about a pull request that is no longer on screen.
        const live = livePrRef.current;
        if (!live || !samePr(live.coordinates, coords)) return;

        // A moved head invalidates the iterations, the comparison and the seen
        // marks all at once, so it goes through a full reload rather than a
        // field-by-field fold.
        if (freshPr.headSha !== live.headSha) {
          if (reloadingRef.current) return;
          reloadingRef.current = true;
          void loadPr(coords).finally(() => {
            reloadingRef.current = false;
          });
          return;
        }

        setState((prev) => {
          if (!prev.pr || !samePr(prev.pr.coordinates, coords)) return prev;
          // The head moved between the check above and this updater running.
          // The reload that saw it owns the rest of the state; folding a status
          // read from the old head onto it would only undo part of that.
          if (prev.pr.headSha !== freshPr.headSha) return prev;
          return { ...prev, pr: foldPrStatus(prev.pr, freshPr) };
        });
      }),
    ]).catch(() => { /* ignore transient fetch failures */ });
  }, [coords, authorApproval, refreshThreads, loadPr, setState]);

  const refreshNow = useCallback(async () => {
    setRestart((n) => n + 1);
    await poll();
  }, [poll]);

  useEffect(() => {
    if (!prKeyStr || !coords || intervalSeconds <= 0) return;

    // Whether a tick was skipped because nobody was looking, so returning to
    // the tab shows current data immediately instead of after another interval.
    let missed = false;

    const id = setInterval(() => {
      if (document.hidden) {
        missed = true;
        return;
      }
      void poll();
    }, intervalSeconds * 1000);

    const onVisible = () => {
      if (document.hidden || !missed) return;
      missed = false;
      void poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [prKeyStr, coords, poll, intervalSeconds, restart]);

  return { refreshNow };
}
