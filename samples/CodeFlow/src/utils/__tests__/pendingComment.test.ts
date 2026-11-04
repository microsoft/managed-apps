import { describe, it, expect } from 'vitest';
import { PENDING_ID_PREFIX, isPendingCommentId, newPendingId } from '../pendingComment';

describe('pendingComment', () => {
  it('mints ids that are recognisably optimistic', () => {
    expect(isPendingCommentId(newPendingId())).toBe(true);
    expect(newPendingId().startsWith(PENDING_ID_PREFIX)).toBe(true);
  });

  it('does not mistake a real GitHub id for an optimistic one', () => {
    expect(isPendingCommentId('PRRC_kwDOABCD')).toBe(false);
    expect(isPendingCommentId('123456')).toBe(false);
  });

  it('mints a fresh id each time, so two posts never collide', () => {
    const ids = new Set(Array.from({ length: 50 }, newPendingId));
    expect(ids.size).toBe(50);
  });

  it('tolerates an empty id rather than throwing', () => {
    expect(isPendingCommentId('')).toBe(false);
  });
});
