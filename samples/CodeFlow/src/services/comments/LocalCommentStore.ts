import type {
  Comment,
  CommentThread,
  CommentThreadStatus,
  GitUserRef,
} from '../../types';
import { getStoredThreadsRaw, setStoredThreadsRaw } from '../../utils/storage';
import type { CommentStore, CreateThreadInput } from './CommentStore';
import { assertCommentRange } from '../../utils/commentRange';

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Comment store kept in app storage (the PR's `reviewState` record). Used as the
 * default and as the guaranteed fallback when GitHub-synced comments are
 * unavailable.
 */
export class LocalCommentStore implements CommentStore {
  readonly backend = 'local' as const;
  readonly label = 'Local (this device)';

  async listThreads(prKey: string): Promise<CommentThread[]> {
    return getStoredThreadsRaw<CommentThread>(prKey);
  }

  async createThread(input: CreateThreadInput): Promise<CommentThread> {
    assertCommentRange(input);
    const now = new Date().toISOString();
    const comment: Comment = {
      id: uid(),
      author: input.author,
      body: input.body,
      createdAt: now,
      local: true,
    };
    const thread: CommentThread = {
      id: uid(),
      prKey: input.prKey,
      filename: input.filename,
      side: input.side,
      line: input.line,
      startLine: input.startLine,
      status: 'active',
      comments: [comment],
      createdAt: now,
      updatedAt: now,
      iterationIndex: input.iterationIndex,
    };
    const threads = await this.listThreads(input.prKey);
    threads.push(thread);
    setStoredThreadsRaw(input.prKey, threads);
    return thread;
  }

  async addComment(
    prKey: string,
    threadId: string,
    body: string,
    author: GitUserRef,
  ): Promise<CommentThread> {
    const threads = await this.listThreads(prKey);
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) throw new Error('Thread not found');
    const now = new Date().toISOString();
    thread.comments.push({ id: uid(), author, body, createdAt: now, local: true });
    thread.updatedAt = now;
    setStoredThreadsRaw(prKey, threads);
    return thread;
  }

  async editComment(
    prKey: string,
    threadId: string,
    commentId: string,
    body: string,
  ): Promise<CommentThread> {
    const threads = await this.listThreads(prKey);
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) throw new Error('Thread not found');
    const comment = thread.comments.find((c) => c.id === commentId);
    if (!comment) throw new Error('Comment not found');
    comment.body = body;
    thread.updatedAt = new Date().toISOString();
    setStoredThreadsRaw(prKey, threads);
    return thread;
  }

  async setStatus(
    prKey: string,
    threadId: string,
    status: CommentThreadStatus,
  ): Promise<CommentThread> {
    const threads = await this.listThreads(prKey);
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) throw new Error('Thread not found');
    thread.status = status;
    thread.updatedAt = new Date().toISOString();
    setStoredThreadsRaw(prKey, threads);
    return thread;
  }

  async deleteComment(prKey: string, threadId: string, commentId: string): Promise<void> {
    const threads = await this.listThreads(prKey);
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) throw new Error('Thread not found');
    if (!thread.comments.some((c) => c.id === commentId)) throw new Error('Comment not found');
    thread.comments = thread.comments.filter((c) => c.id !== commentId);
    thread.updatedAt = new Date().toISOString();
    setStoredThreadsRaw(prKey, threads.filter((t) => t.id !== threadId || t.comments.length > 0));
  }

  async deleteThread(prKey: string, threadId: string): Promise<void> {
    const threads = await this.listThreads(prKey);
    const next = threads.filter((t) => t.id !== threadId);
    setStoredThreadsRaw(prKey, next);
  }
}
