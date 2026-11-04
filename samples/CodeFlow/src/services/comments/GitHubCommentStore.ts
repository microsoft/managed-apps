import type { CommentThread, CommentThreadStatus, GitUserRef } from '../../types';
import type { CommentStore, CreateThreadInput } from './CommentStore';
import { isNodeId, parsePrKey } from './github/helpers';
import { fetchConversation } from './github/conversation';
import { parseIssueComments, parseReviewThreads } from './github/threadParser';
import { createReviewThread, replyToIssueComment, replyToThread } from './github/reviewWriter';
import { updateCommentBody } from './github/commentEditor';
import { deleteGithubComment } from './github/commentDeleter';
import { setThreadResolution } from './github/threadResolution';

function deletionKey(prKey: string, thread: CommentThread, commentId: string): string {
  return `${prKey}:${thread.isIssueComment ? 'issue' : 'review'}:${commentId}`;
}

/**
 * Comment store backed by GitHub itself: real pull request review threads and
 * PR-level comments, read and written through the connector's GraphQL
 * operation (`SearchGithubWithQuery`).
 */
export class GitHubCommentStore implements CommentStore {
  readonly backend = 'github' as const;
  readonly label = 'GitHub (synced)';
  private readonly deletedComments = new Map<string, number>();

  async listThreads(prKey: string): Promise<CommentThread[]> {
    const coords = parsePrKey(prKey);
    const { reviewThreads, issueComments } = await fetchConversation(coords);
    const allThreads = [...parseReviewThreads(prKey, reviewThreads), ...parseIssueComments(prKey, issueComments)];

    // Reads (including ones already in flight) can briefly lag a successful
    // delete. Keep the pin for the whole window: an older read can finish after
    // a fresh one.
    const now = Date.now();
    for (const [key, until] of this.deletedComments) {
      if (until <= now) this.deletedComments.delete(key);
    }
    return allThreads.flatMap((thread) => {
      const comments = thread.comments.filter(
        (comment) => !this.deletedComments.has(deletionKey(prKey, thread, comment.id)),
      );
      return comments.length ? [{ ...thread, comments }] : [];
    });
  }

  async createThread(input: CreateThreadInput): Promise<CommentThread> {
    return createReviewThread(input, parsePrKey(input.prKey));
  }

  private async findThread(prKey: string, threadId: string, known?: CommentThread): Promise<CommentThread | undefined> {
    if (known) return known;
    const threads = await this.listThreads(prKey);
    return threads.find((t) => t.id === threadId);
  }

  async addComment(
    prKey: string,
    threadId: string,
    body: string,
    author: GitUserRef,
    known?: CommentThread,
  ): Promise<CommentThread> {
    const thread = known ?? (isNodeId(threadId) ? undefined : await this.findThread(prKey, threadId));

    // PR-level ("Description") comments are issue comments, which GitHub does
    // not thread, so they take their own route.
    if (thread?.isIssueComment) {
      return replyToIssueComment(parsePrKey(prKey), thread, body, author, prKey, (k) => this.listThreads(k));
    }

    const threadNodeId = thread?.threadNodeId || (isNodeId(threadId) ? threadId : undefined);
    if (!threadNodeId) throw new Error('Could not add the reply: GitHub did not return an id for this thread.');
    return replyToThread(threadNodeId, body, author, prKey, (k) => this.listThreads(k), thread);
  }

  /**
   * Rewrite a comment on GitHub. The hidden marker preamble that was stripped
   * for display is put back first, so an edit never drops an out-of-diff anchor
   * or detaches a Description reply from its parent.
   */
  async editComment(
    prKey: string,
    threadId: string,
    commentId: string,
    body: string,
    known?: CommentThread,
  ): Promise<CommentThread> {
    const thread = await this.findThread(prKey, threadId, known);
    if (!thread) throw new Error('Thread not found');
    const comment = thread.comments.find((c) => c.id === commentId);
    if (!comment) throw new Error('Comment not found');
    if (!comment.nodeId) {
      throw new Error('This comment cannot be edited: GitHub did not return an id for it.');
    }

    const prefix = comment.bodyPrefix ?? '';
    const stored = await updateCommentBody(thread.isIssueComment ? 'issue' : 'review', comment.nodeId, prefix + body);
    const next = stored.startsWith(prefix) ? stored.slice(prefix.length) : stored;

    // Rebuilt rather than mutated: `known` comes straight out of React state.
    return {
      ...thread,
      updatedAt: new Date().toISOString(),
      comments: thread.comments.map((c) => (c.id === commentId ? { ...c, body: next } : c)),
    };
  }

  async setStatus(prKey: string, threadId: string, status: CommentThreadStatus): Promise<CommentThread> {
    const threads = await this.listThreads(prKey);
    const thread = threads.find((t) => t.id === threadId);
    // `||` rather than `??`: a thread parsed without a node id carries ''.
    const nodeId = thread?.threadNodeId || threadId;

    await setThreadResolution(nodeId, status === 'resolved');

    if (thread) return { ...thread, status };

    // The write has already landed, so failing here would revert a change the
    // reviewer can see on GitHub. Report the little we know instead.
    const now = new Date().toISOString();
    return {
      id: threadId,
      threadNodeId: nodeId,
      prKey,
      filename: '(unknown)',
      side: 'right',
      line: 0,
      status,
      comments: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  async deleteComment(prKey: string, threadId: string, commentId: string, known?: CommentThread): Promise<void> {
    const thread = await this.findThread(prKey, threadId, known);
    if (!thread || thread.id !== threadId || thread.prKey !== prKey) {
      throw new Error('Thread not found');
    }
    const comment = thread.comments.find((c) => c.id === commentId);
    if (!comment) throw new Error('Comment not found');
    if (!comment.nodeId) {
      throw new Error('This comment cannot be deleted: GitHub did not return an id for it.');
    }
    await deleteGithubComment(thread.isIssueComment ? 'issue' : 'review', comment.nodeId);
    this.deletedComments.set(deletionKey(prKey, thread, commentId), Date.now() + 30_000);
  }

  async deleteThread(_prKey: string, _threadId: string): Promise<void> {
    throw new Error('Deleting an entire GitHub thread is not supported. Delete your individual comments instead.');
  }
}
