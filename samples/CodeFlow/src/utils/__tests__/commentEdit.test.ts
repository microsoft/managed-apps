import { describe, it, expect } from 'vitest';
import { canDeleteComment, canEditComment } from '../commentEdit';
import type { Comment } from '../../types';

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: '12345',
    author: { login: 'octodev' },
    body: 'hello',
    createdAt: '2024-01-01T00:00:00Z',
    nodeId: 'PRRC_kwDOABCD',
    ...overrides,
  };
}

describe('canEditComment', () => {
  it('lets the author edit their own comment', () => {
    expect(canEditComment(comment(), { login: 'octodev' })).toBe(true);
  });

  describe('canDeleteComment', () => {
    it('shares the author-only persisted-comment eligibility of editing', () => {
      for (const candidate of [
        comment(), comment({ local: true, nodeId: undefined }),
        comment({ nodeId: undefined }), comment({ id: 'pending-1' }),
        comment({ author: { login: 'another' } }),
      ]) {
        for (const user of [undefined, { login: '' }, { login: 'OctoDev' }]) {
          expect(canDeleteComment(candidate, user)).toBe(canEditComment(candidate, user));
        }
      }
    });
  });

  it('ignores case when matching the author', () => {
    // GitHub logins are case-insensitive, and the two sides of this comparison
    // come from different APIs that disagree about casing.
    expect(canEditComment(comment({ author: { login: 'OctoDev' } }), { login: 'octodev' })).toBe(
      true,
    );
  });

  it('refuses somebody else’s comment', () => {
    expect(canEditComment(comment({ author: { login: 'someone' } }), { login: 'octodev' })).toBe(
      false,
    );
  });

  it('refuses when nobody is signed in', () => {
    expect(canEditComment(comment(), undefined)).toBe(false);
    expect(canEditComment(comment(), { login: '' })).toBe(false);
    expect(canEditComment(comment(), { login: '   ' })).toBe(false);
  });

  it('refuses a comment the server has not acknowledged yet', () => {
    // Optimistic comments carry a temporary id, so there is nothing to address.
    expect(canEditComment(comment({ id: 'pending-1700000000' }), { login: 'octodev' })).toBe(false);
  });

  it('refuses a GitHub comment with no node id', () => {
    // The edit goes out by GraphQL node id; without one there is no mutation to
    // send, so the button would only ever produce an error.
    expect(canEditComment(comment({ nodeId: undefined }), { login: 'octodev' })).toBe(false);
  });

  it('allows a local comment even with no node id', () => {
    expect(
      canEditComment(comment({ nodeId: undefined, local: true }), { login: 'octodev' }),
    ).toBe(true);
  });
});
