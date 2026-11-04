import type {
  CommentBackend,
  CommentThread,
  CommentThreadStatus,
  DiffSide,
  GitUserRef,
} from '../../types';

export interface CreateThreadInput {
  prKey: string;
  filename: string;
  side: DiffSide;
  line: number;
  /** Inclusive first line on `side`, strictly before `line`. */
  startLine?: number;
  body: string;
  author: GitUserRef;
  iterationIndex?: number;
  /** Commit SHA the comment targets (required for GitHub API). */
  commitSha?: string;
  /**
   * Source text of the anchored line or range. Only used when it turns out to be
   * outside the diff, so the fallback file-level comment can quote it.
   */
  lineText?: string;
}

/**
 * Pluggable persistence for PR comment threads. The app talks only to this
 * interface so the storage backend (local-only vs. GitHub-synced via GraphQL) can
 * be swapped without touching the UI.
 */
export interface CommentStore {
  /** Identifies which backend is active, for UI affordances. */
  readonly backend: CommentBackend;
  /** Human-friendly label describing the backend (e.g. for a status badge). */
  readonly label: string;

  listThreads(prKey: string): Promise<CommentThread[]>;
  createThread(input: CreateThreadInput): Promise<CommentThread>;
  addComment(
    prKey: string,
    threadId: string,
    body: string,
    author: GitUserRef,
    /**
     * The thread as the UI currently knows it. Optional, but passing it saves
     * the backend a lookup — and tells it which kind of thread this is, which
     * decides how a reply has to be written.
     */
    known?: CommentThread,
  ): Promise<CommentThread>;
  setStatus(
    prKey: string,
    threadId: string,
    status: CommentThreadStatus,
  ): Promise<CommentThread>;
  /**
   * Rewrite the body of a comment already in the thread.
   *
   * Resolves with the thread as it now stands. Rejects when the backend can't
   * make the edit — GitHub only lets the author edit, and a comment read back
   * without a node id can't be addressed at all — so the caller can undo its
   * optimistic update and say why.
   */
  editComment(
    prKey: string,
    threadId: string,
    commentId: string,
    body: string,
    /** The thread as the UI knows it, saving the backend a round trip. */
    known?: CommentThread,
  ): Promise<CommentThread>;
  /** Delete one comment, preserving other replies. Rejects if the write fails. */
  deleteComment(
    prKey: string,
    threadId: string,
    commentId: string,
    known?: CommentThread,
  ): Promise<void>;
  deleteThread(prKey: string, threadId: string): Promise<void>;
}
