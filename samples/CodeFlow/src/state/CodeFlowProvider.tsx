import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getCommentStore } from '../services/comments';
import {
  prKey as makePrKey,
} from '../utils/storage';
import { DESCRIPTION_FILE } from '../types';
import type { CodeFlowState } from './codeFlowContext';
import {
  CodeFlowContext,
  rangeIdOf,
  type CodeFlowActions,
  type CodeFlowContextValue,
} from './codeFlowContext';
import { useFileSelection } from './hooks/useFileSelection';
import { useLineFocus } from './hooks/useLineFocus';
import { useIterations } from './hooks/useIterations';
import { useCommentActions } from './hooks/useCommentActions';
import { useReviewActions } from './hooks/useReviewActions';
import { useMergeActions } from './hooks/useMergeActions';
import { usePrLoader, usePrPolling } from './hooks/usePrLoader';
import { useDeepLink } from './hooks/useDeepLink';
import { useChecks } from './hooks/useChecks';
import { useAutoMerge } from './hooks/useAutoMerge';
import { useDraftActions } from './hooks/useDraftActions';
import { MentionCandidatesProvider } from '../components/MarkdownToolbar/MentionCandidatesProvider';

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
  // Replaced by the reviewer's `defaultViewMode` setting as soon as a PR loads.
  viewMode: 'inline',
  reviewers: [],
};

export function CodeFlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CodeFlowState>(INITIAL);
  const initialStore = useMemo(() => getCommentStore(), []);
  const storeRef = useRef(initialStore);
  const [backendLabel, setBackendLabel] = useState<string>(initialStore.label);
  const compareSeq = useRef(0);

  const patch = useCallback((p: Partial<CodeFlowState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  const prKeyStr = state.pr ? makePrKey(state.pr.coordinates) : undefined;
  const rangeId = rangeIdOf(state.iterations, state.fromIndex, state.toIndex);

  // Compose hooks
  const { loadPr, reset } = usePrLoader(setState, patch, storeRef, setBackendLabel);
  const { selectIterations } = useIterations(state, patch, compareSeq);
  const { selectFile, selectFolder, toggleSeen, markAllSeen } = useFileSelection(prKeyStr, setState);
  const { refreshThreads, createThread, addComment, editComment, deleteComment, setThreadStatus, setThreadClosed, deleteThread } = useCommentActions(prKeyStr, state, setState, storeRef);
  const { addIssueComment, submitReview } = useReviewActions(prKeyStr, state, setState, refreshThreads);
  const { mergePr } = useMergeActions(state, setState);

  const setViewMode = useCallback((mode: CodeFlowState['viewMode']) => patch({ viewMode: mode }), [patch]);

  // Navigate to a thread and request the diff viewer scroll/expand it. PR-level
  // (non-file) threads map to the Description pseudo-file so they still resolve.
  const focusSeq = useRef(0);
  const focusThread = useCallback((threadId: string) => {
    const seq = ++focusSeq.current;
    setState((s) => {
      const thread = s.threads.find((t) => t.id === threadId);
      if (!thread) return { ...s, focusRequest: { threadId, seq } };
      const changed = new Set((s.comparison?.files ?? []).map((f) => f.filename));
      const isFileThread =
        !!thread.filename &&
        thread.filename !== '(unknown)' &&
        changed.has(thread.filename);
      const target = isFileThread ? thread.filename : DESCRIPTION_FILE;
      return {
        ...s,
        selectedFile: target,
        selectedFolder: undefined,
        focusRequest: { threadId, seq },
      };
    });
  }, [setState]);

  // Navigate to a search hit, and retire the request once the viewer is done
  // with it. Both halves live in `useLineFocus` — see the note there on why an
  // unconsumed request is a bug rather than a harmless leftover.
  const { focusLine, consumeLineFocus } = useLineFocus(setState);

  // Polling for updates
  const { refreshNow } = usePrPolling(prKeyStr, state, refreshThreads, loadPr, setState);

  // Checks ride along with the poll cadence via `lastRefreshAt`.
  const { refreshChecks } = useChecks(
    state.pr?.coordinates,
    state.pr?.headSha,
    state.lastRefreshAt,
    setState,
  );

  // Author-side actions on the PR itself, as opposed to the review of it.
  const { publishDraft } = useDraftActions(state, setState);

  // Auto-merge rides the same poll cadence as checks, and is only read at all
  // for the author, who is the only person offered the control.
  const { enableAutoMerge, disableAutoMerge } = useAutoMerge(state, setState);

  const actions: CodeFlowActions = useMemo(
    () => ({
      loadPr,
      reset,
      selectIterations,
      selectFile,
      selectFolder,
      focusThread,
      focusLine,
      consumeLineFocus,
      toggleSeen,
      markAllSeen,
      setViewMode,
      createThread,
      addComment,
      editComment,
      deleteComment,
      addIssueComment,
      setThreadStatus,
      setThreadClosed,
      deleteThread,
      submitReview,
      publishDraft,
      refreshNow,
      refreshChecks,
      mergePr,
      enableAutoMerge,
      disableAutoMerge,
    }),
    [
      loadPr,
      reset,
      selectIterations,
      selectFile,
      selectFolder,
      focusThread,
      focusLine,
      consumeLineFocus,
      toggleSeen,
      markAllSeen,
      setViewMode,
      createThread,
      addComment,
      editComment,
      deleteComment,
      addIssueComment,
      setThreadStatus,
      setThreadClosed,
      deleteThread,
      submitReview,
      publishDraft,
      refreshNow,
      refreshChecks,
      mergePr,
      enableAutoMerge,
      disableAutoMerge,
    ],
  );

  // Open whatever a deep link points at (PR, file, comment) on startup.
  useDeepLink(state, actions);

  // Annotate raw store threads with the shared "closed" overlay so every
  // consumer (file list, summary, inline badges, thread view) sees it uniformly
  // without the store having to know about it.
  const annotatedThreads = useMemo(
    () =>
      state.threads.map((t) =>
        state.closed[t.id] ? { ...t, closed: true, closedBy: state.closedBy[t.id] } : t,
      ),
    [state.threads, state.closed, state.closedBy],
  );

  const value: CodeFlowContextValue = {
    ...state,
    threads: annotatedThreads,
    actions,
    prKey: prKeyStr,
    rangeId,
    commentBackendLabel: backendLabel,
  };

  return (
    <CodeFlowContext.Provider value={value}>
      <MentionCandidatesProvider>{children}</MentionCandidatesProvider>
    </CodeFlowContext.Provider>
  );
}
