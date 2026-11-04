/**
 * Replies on notes/feedback items, stored in the `feedbackComments` collection
 * of app storage.
 */

import { appStorage, type FeedbackCommentRecord } from '../../storage';
import { withConflictRetry, type Stored } from '../../storage/core';
import type {
  FeedbackComment,
  FeedbackCommentDraft,
  FeedbackCommentKind,
  IssueViewer,
} from '../../types';

export const COMMENT_MAX_LENGTH = 10_000;

const KINDS: readonly FeedbackCommentKind[] = ['comment', 'status', 'question'];

function asKind(value: unknown): FeedbackCommentKind {
  return KINDS.includes(value as FeedbackCommentKind)
    ? (value as FeedbackCommentKind)
    : 'comment';
}

/** Map a stored record onto the domain model the UI works with. */
export function toComment(record: Stored<FeedbackCommentRecord>): FeedbackComment {
  return {
    id: record.id,
    version: record.version,
    issueId: record.feedbackId,
    body: record.body,
    kind: asKind(record.kind),
    authorId: record.authorId,
    authorLogin: record.authorLogin,
    authorName: record.authorName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toRecord(comment: FeedbackComment): FeedbackCommentRecord {
  return {
    feedbackId: comment.issueId,
    body: comment.body,
    kind: comment.kind,
    authorId: comment.authorId,
    ...(comment.authorLogin ? { authorLogin: comment.authorLogin } : {}),
    ...(comment.authorName ? { authorName: comment.authorName } : {}),
  };
}

/** Raised when a draft can't be stored, so the composer can explain why. */
export class CommentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommentValidationError';
  }
}

/**
 * Trim and bounds-check a draft. An empty comment is rejected here with a friendly
 * message rather than by schema validation.
 */
export function normalizeCommentDraft(draft: FeedbackCommentDraft): FeedbackCommentDraft {
  const body = draft.body.trim();
  if (!body) throw new CommentValidationError('Write something first.');
  if (body.length > COMMENT_MAX_LENGTH) {
    throw new CommentValidationError(
      `Comments are limited to ${COMMENT_MAX_LENGTH.toLocaleString()} characters.`,
    );
  }
  return { body, kind: asKind(draft.kind) };
}

/** Every comment on one item, oldest first. */
export async function listComments(issueId: string): Promise<FeedbackComment[]> {
  const records = await appStorage().feedbackComments.listAll({
    where: [{ field: 'feedbackId', op: 'eq', value: issueId }],
    orderBy: [{ field: 'createdAt', direction: 'asc' }],
  });
  return records.map(toComment);
}

/** Post a new comment attributed to the signed-in user. */
export async function createComment(
  issueId: string,
  draft: FeedbackCommentDraft,
  viewer: IssueViewer,
): Promise<FeedbackComment> {
  const clean = normalizeCommentDraft(draft);
  const record: FeedbackCommentRecord = {
    feedbackId: issueId,
    body: clean.body,
    kind: clean.kind,
    authorId: viewer.id,
    ...(viewer.login ? { authorLogin: viewer.login } : {}),
    ...(viewer.name ? { authorName: viewer.name } : {}),
  };
  return toComment(await appStorage().feedbackComments.create(record));
}

/** Save an edit, re-applying it to a fresh copy if someone changed it first. */
export async function saveComment(
  comment: FeedbackComment,
  draft: FeedbackCommentDraft,
): Promise<FeedbackComment> {
  const clean = normalizeCommentDraft(draft);
  const comments = appStorage().feedbackComments;
  return withConflictRetry(async (attempt) => {
    let base = comment;
    if (attempt > 1) {
      const fresh = await comments.get(comment.id);
      if (!fresh) throw new Error('That comment no longer exists.');
      base = toComment(fresh);
    }
    const next = { ...base, body: clean.body, kind: clean.kind };
    return toComment(await comments.put(comment.id, toRecord(next), { ifVersion: base.version }));
  }, { attempts: 2 });
}

/** True when the comment has been edited since it was posted. */
export function wasEdited(comment: FeedbackComment): boolean {
  return Boolean(comment.createdAt) && comment.updatedAt > comment.createdAt;
}
