import { describe, expect, it } from 'vitest';
import {
  COMMENT_MAX_LENGTH,
  CommentValidationError,
  createComment,
  listComments,
  normalizeCommentDraft,
  saveComment,
  toComment,
  wasEdited,
} from '../commentStore';
import { appStorage } from '../../../storage';
import type { IssueViewer } from '../../../types';

const viewer: IssueViewer = { id: 'octocat', login: 'octocat' };

describe('toComment', () => {
  it('maps a stored record onto the domain model', () => {
    expect(
      toComment({
        id: 'c1',
        version: '1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        feedbackId: 'f1',
        body: 'Seen it too',
        kind: 'comment',
        authorId: 'octocat',
      }),
    ).toMatchObject({ id: 'c1', issueId: 'f1', body: 'Seen it too', kind: 'comment' });
  });
});

describe('normalizeCommentDraft', () => {
  it('trims the body and keeps the kind', () => {
    expect(normalizeCommentDraft({ body: '  hi  ', kind: 'status' })).toEqual({ body: 'hi', kind: 'status' });
  });

  it('rejects a blank or over-long body', () => {
    expect(() => normalizeCommentDraft({ body: '   ', kind: 'comment' })).toThrow(CommentValidationError);
    expect(() => normalizeCommentDraft({ body: 'x'.repeat(COMMENT_MAX_LENGTH + 1), kind: 'comment' })).toThrow(
      CommentValidationError,
    );
    expect(normalizeCommentDraft({ body: 'x'.repeat(COMMENT_MAX_LENGTH), kind: 'comment' }).body).toHaveLength(
      COMMENT_MAX_LENGTH,
    );
  });
});

describe('storage round trip', () => {
  it('lists one item’s comments, oldest first', async () => {
    await createComment('f1', { body: 'first', kind: 'comment' }, viewer);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await createComment('f2', { body: 'elsewhere', kind: 'comment' }, viewer);
    await createComment('f1', { body: 'second', kind: 'question' }, viewer);
    expect((await listComments('f1')).map((c) => c.body)).toEqual(['first', 'second']);
  });

  it('stamps the author and the item', async () => {
    const comment = await createComment('f1', { body: 'hello', kind: 'comment' }, viewer);
    expect(comment).toMatchObject({ issueId: 'f1', authorLogin: 'octocat', authorId: 'octocat' });
    expect(await appStorage().feedbackComments.get(comment.id)).toMatchObject({ feedbackId: 'f1' });
  });

  it('refuses an empty draft before writing', async () => {
    await expect(createComment('f1', { body: ' ', kind: 'comment' }, viewer)).rejects.toThrow(
      CommentValidationError,
    );
    expect(await appStorage().feedbackComments.listAll()).toHaveLength(0);
  });

  it('saves an edit, re-applying it after a conflict', async () => {
    const comment = await createComment('f1', { body: 'v1', kind: 'comment' }, viewer);
    await saveComment(comment, { body: 'v2 (theirs)', kind: 'comment' });
    const saved = await saveComment(comment, { body: 'v3 (mine)', kind: 'status' });
    expect(saved).toMatchObject({ body: 'v3 (mine)', kind: 'status' });
  });

  it('explains itself when the comment was deleted mid-edit', async () => {
    const comment = await createComment('f1', { body: 'v1', kind: 'comment' }, viewer);
    await saveComment(comment, { body: 'v2', kind: 'comment' });
    await appStorage().feedbackComments.delete(comment.id);
    await expect(saveComment(comment, { body: 'v3', kind: 'comment' })).rejects.toThrow(/no longer exists/);
  });
});

describe('wasEdited', () => {
  const base = { id: 'c', issueId: 'f', body: 'b', kind: 'comment' as const, authorId: 'a' };

  it('is false when the comment has never been touched', () => {
    expect(wasEdited({ ...base, createdAt: '2026-01-01', updatedAt: '2026-01-01' })).toBe(false);
  });

  it('is true once updatedAt moves past createdAt', () => {
    expect(wasEdited({ ...base, createdAt: '2026-01-01', updatedAt: '2026-01-02' })).toBe(true);
  });

  it('is false when there is no createdAt to compare against', () => {
    expect(wasEdited({ ...base, createdAt: '', updatedAt: '2026-01-02' })).toBe(false);
  });
});
