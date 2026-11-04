import { createContext } from 'react';
import type { AutoMergeStatus } from '../services/autoMerge';
import type { CreateThreadInput } from '../services/comments';
import type { ForcePushInfo } from '../utils/forcePush';
import type { LastReviewed } from '../utils/lastReviewed';
import type { ClosedEntry } from '../utils/sharedClosed';
import type {
  AuthorApproval,
  ChecksSummary,
  CommentThread,
  CommentThreadStatus,
  ComparisonResult,
  DiffSide,
  GitUserRef,
  Iteration,
  MergeMethod,
  MergeOutcome,
  PrCoordinates,
  PrSummary,
  Reviewer,
} from '../types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ViewMode = 'inline' | 'split';

export interface CodeFlowState {
  status: LoadStatus;
  error?: string;
  pr?: PrSummary;
  /**
   * The PR a `loadPr` call is currently fetching. Set for the whole load and
   * cleared when it settles, so the shell can name what it's opening on the
   * splash screen instead of leaving the reviewer on the dashboard.
   */
  pendingPr?: PrCoordinates;
  iterations: Iteration[];
  fullRange?: ComparisonResult;
  fromIndex: number;
  toIndex: number;
  comparison?: ComparisonResult;
  comparisonLoading: boolean;
  selectedFile?: string;
  selectedFolder?: string;
  seen: Record<string, boolean>;
  threads: CommentThread[];
  threadsLoading: boolean;
  /**
   * "Closed" review flags, keyed by thread id. Shared by everyone reviewing the
   * PR — see {@link src/utils/sharedClosed.ts}. Not a GitHub concept.
   */
  closed: Record<string, boolean>;
  /** Who closed each closed thread, keyed by thread id. */
  closedBy: Record<string, ClosedEntry>;
  currentUser?: GitUserRef;
  viewMode: ViewMode;
  reviewers: Reviewer[];
  /** Shared app-only author vote, deliberately separate from GitHub reviews. */
  authorApproval?: AuthorApproval | null;
  /**
   * When the PR was last polled for comments/votes/pushes, so the topbar can
   * show how long is left until the next automatic refresh.
   */
  lastRefreshAt?: number;
  /**
   * Set when previously observed commits have disappeared, so the UI can admit
   * that some iterations aren't available rather than silently showing a
   * shortened list. Commit timestamps alone do not trigger this warning.
   */
  forcePush?: ForcePushInfo;
  /**
   * The iteration this reviewer had selected the last time they marked a file
   * seen or left a comment, so the bar can say how much has landed since.
   */
  lastReviewed?: LastReviewed;
  /**
   * Request to focus/scroll to a specific comment thread. `seq` changes on each
   * request so repeated clicks on the same thread re-trigger the scroll effect.
   */
  focusRequest?: { threadId: string; seq: number };
  /**
   * Request to scroll a specific diff line into view, as issued by a
   * cross-file search result. Addressed by side + line number rather than a row
   * key, because the target file may not be open yet and the row key depends on
   * how it ends up being rendered. `seq` changes on each request so clicking
   * the same result twice re-triggers the scroll.
   *
   * A request is *consumed* once the viewer has finished with it — landed,
   * given up, or been overtaken — see {@link CodeFlowActions.consumeLineFocus}.
   * Without that it would outlive the navigation that made it, and merely
   * returning to the file later would replay the jump.
   */
  lineFocusRequest?: { filename: string; side: DiffSide; line: number; seq: number };
  /**
   * CI checks reported against the PR's head commit. Absent while they load and
   * when they can't be read — the review works without them, so a failure here
   * hides the pill rather than surfacing an error.
   */
  checks?: ChecksSummary;
  checksLoading?: boolean;
  /**
   * Whether GitHub is holding this PR to merge itself once its requirements
   * are met. Only read for the author — see {@link useAutoMerge} — so it is
   * absent for everyone else, and while the first read is in flight.
   */
  autoMerge?: AutoMergeStatus;
  autoMergeLoading?: boolean;
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface CodeFlowActions {
  loadPr(coords: PrCoordinates): Promise<void>;
  reset(): void;
  selectIterations(fromIndex: number, toIndex: number): Promise<void>;
  selectFile(filename: string): void;
  selectFolder(folderPath: string): void;
  /**
   * Navigate to a thread's file (or the Description pseudo-file for PR-level
   * threads) and scroll/expand it into view.
   */
  focusThread(threadId: string): void;
  /**
   * Navigate to a file and scroll one of its lines into view — what clicking a
   * cross-file search result does.
   */
  focusLine(filename: string, side: DiffSide, line: number): void;
  /**
   * Retire the line-focus request numbered `seq`, once the viewer has landed on
   * it, given up on it, or had it overtaken by a later navigation.
   *
   * Takes the sequence number so that a request already replaced by a newer one
   * cannot clear it on its way out — the late arrival retires nothing.
   */
  consumeLineFocus(seq: number): void;
  toggleSeen(filename: string): void;
  markAllSeen(seen: boolean): void;
  setViewMode(mode: ViewMode): void;
  createThread(input: Omit<CreateThreadInput, 'prKey' | 'author'>): Promise<void>;
  addComment(threadId: string, body: string): Promise<void>;
  /**
   * Rewrite one of your own comments. Rejects with GitHub's reason when it
   * refuses, so the editor can show it and keep the draft.
   */
  editComment(threadId: string, commentId: string, body: string): Promise<void>;
  /** Delete one of your saved comments, not the conversation or its replies. */
  deleteComment(threadId: string, commentId: string): Promise<void>;
  addIssueComment(body: string): Promise<void>;
  setThreadStatus(threadId: string, status: CommentThreadStatus): Promise<void>;
  /** Toggle the local-only "closed" review flag for a thread. */
  setThreadClosed(threadId: string, closed: boolean): void;
  deleteThread(threadId: string): Promise<void>;
  submitReview(event: ReviewEvent, body?: string): Promise<void>;
  /**
   * Take this pull request out of draft. Rejects with the reason when GitHub
   * refuses, so the caller can show it.
   */
  publishDraft(): Promise<void>;
  /** Poll immediately for comments, votes and new pushes, restarting the timer. */
  refreshNow(): Promise<void>;
  /** Re-read the PR's checks, e.g. after the reviewer proves presence. */
  refreshChecks(): Promise<void>;
  /**
   * Merge the loaded PR. Rejects with GitHub's own message when it refuses —
   * the caller is expected to show it rather than swallow it.
   */
  mergePr(method: MergeMethod): Promise<MergeOutcome>;
  /**
   * Ask GitHub to merge this PR by itself once its requirements are met.
   * Rejects with GitHub's own refusal, which is the only thing that explains
   * why a repository or branch won't allow it.
   */
  enableAutoMerge(method: MergeMethod): Promise<void>;
  /** Cancel a pending auto-merge. Rejects with the reason when GitHub won't. */
  disableAutoMerge(): Promise<void>;
}

export type CodeFlowContextValue = CodeFlowState & {
  actions: CodeFlowActions;
  prKey?: string;
  rangeId: string;
  commentBackendLabel: string;
};

export const CodeFlowContext = createContext<CodeFlowContextValue | null>(null);

/** Stable range id for the currently selected iteration pair. */
export function rangeIdOf(
  iterations: Iteration[],
  fromIndex: number,
  toIndex: number,
): string {
  const a = iterations[fromIndex]?.sha ?? String(fromIndex);
  const b = iterations[toIndex]?.sha ?? String(toIndex);
  return `${a.slice(0, 12)}..${b.slice(0, 12)}`;
}
