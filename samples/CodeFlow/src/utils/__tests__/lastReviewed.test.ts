import { describe, it, expect } from 'vitest';
import type { Iteration, Reviewer, ReviewState } from '../../types';
import {
  countNewIterations,
  isLastReviewed,
  nextLastReviewed,
  type LastReviewed,
} from '../lastReviewed';

function commit(index: number, sha: string): Iteration {
  return {
    index,
    sha,
    shortSha: sha.slice(0, 6),
    label: `Iteration ${index}`,
    message: `Change ${index}`,
    isBase: false,
  };
}

const BASE: Iteration = {
  index: 0,
  sha: 'base000',
  shortSha: 'base00',
  label: 'Iteration 0',
  message: 'Base (main)',
  isBase: true,
};

// Base + three pushes.
const iterations: Iteration[] = [BASE, commit(1, 'aaa111'), commit(2, 'bbb222'), commit(3, 'ccc333')];

const NOW = '2026-03-01T10:00:00Z';

describe('isLastReviewed', () => {
  it('accepts the shape we persist', () => {
    expect(isLastReviewed({ sha: 'aaa111', index: 1, at: NOW })).toBe(true);
  });

  it('rejects anything without a usable sha or timestamp', () => {
    expect(isLastReviewed(null)).toBe(false);
    expect(isLastReviewed('aaa111')).toBe(false);
    expect(isLastReviewed({ index: 1, at: NOW })).toBe(false);
    expect(isLastReviewed({ sha: '', index: 1, at: NOW })).toBe(false);
    expect(isLastReviewed({ sha: 'aaa111', index: 1 })).toBe(false);
  });

  it('tolerates a missing index, which is only a display hint', () => {
    expect(isLastReviewed({ sha: 'aaa111', at: NOW })).toBe(true);
  });
});

describe('countNewIterations', () => {
  it('counts the pushes that landed after the reviewed one', () => {
    const last: LastReviewed = { sha: 'aaa111', index: 1, at: NOW };
    expect(countNewIterations(iterations, last)).toEqual({ count: 2, index: 1, at: NOW });
  });

  it('says nothing when there is no record yet', () => {
    expect(countNewIterations(iterations, undefined)).toBeUndefined();
  });

  it('says nothing when the reviewer is already on the newest iteration', () => {
    expect(countNewIterations(iterations, { sha: 'ccc333', index: 3, at: NOW })).toBeUndefined();
  });

  it('says nothing when the remembered commit is gone from the branch', () => {
    // Force-push: the count would be a guess, and the force-push notice covers it.
    expect(countNewIterations(iterations, { sha: 'deadbee', index: 2, at: NOW })).toBeUndefined();
  });

  it('says nothing when there are no iterations at all', () => {
    expect(countNewIterations([], { sha: 'aaa111', index: 1, at: NOW })).toBeUndefined();
  });

  it('reports the position in the current list, not the remembered one', () => {
    // A rebase can shift an iteration without renaming it; the SHA is identity.
    const stale: LastReviewed = { sha: 'bbb222', index: 9, at: NOW };
    expect(countNewIterations(iterations, stale)).toEqual({ count: 1, index: 2, at: NOW });
  });

  const review: Reviewer = {
    user: { login: 'octocat' }, state: 'APPROVED', commitId: 'bbb222', submittedAt: NOW,
  };

  it.each<ReviewState>(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'])(
    'uses a submitted %s review when the local marker is stale',
    (state) => {
      const last: LastReviewed = { sha: 'aaa111', index: 1, at: '2026-02-01T00:00:00Z' };
      expect(countNewIterations(iterations, last, [{ ...review, state }]))
        .toEqual({ count: 1, index: 2, at: NOW });
    },
  );

  it('does not rewind local progress for a more recent review of an older commit', () => {
    const last: LastReviewed = { sha: 'ccc333', index: 3, at: '2026-02-01T00:00:00Z' };
    expect(countNewIterations(iterations, last, [review])).toBeUndefined();
  });

  it('chooses the furthest exact reviewed commit regardless of response order', () => {
    const earlier = { ...review, commitId: 'aaa111' };
    for (const reviews of [[review, earlier], [earlier, review]]) {
      expect(countNewIterations(iterations, undefined, reviews)).toEqual({ count: 1, index: 2, at: NOW });
    }
  });

  it('can replace a lost local marker with a surviving submitted review', () => {
    const last: LastReviewed = { sha: 'lost', index: 9, at: NOW };
    expect(countNewIterations(iterations, last, [review])).toEqual({ count: 1, index: 2, at: NOW });
  });

  it.each([
    { ...review, state: 'PENDING' as const },
    { ...review, commitId: 'bbb222-rewritten' },
    { ...review, commitId: 'bbb' },
    { ...review, commitId: 'base000' },
    { ...review, commitId: undefined },
    { ...review, submittedAt: undefined },
    { ...review, submittedAt: 'invalid' },
  ])('ignores unsubmitted or unidentifiable review evidence: %j', (entry) => {
    expect(countNewIterations(iterations, undefined, [entry])).toBeUndefined();
  });
});

describe('nextLastReviewed', () => {
  it('records the iteration being compared to', () => {
    expect(nextLastReviewed(iterations, undefined, 2, NOW)).toEqual({
      sha: 'bbb222',
      index: 2,
      at: NOW,
    });
  });

  it('advances the marker when review moves forward', () => {
    const current: LastReviewed = { sha: 'aaa111', index: 1, at: '2026-02-01T00:00:00Z' };
    expect(nextLastReviewed(iterations, current, 3, NOW)).toEqual({
      sha: 'ccc333',
      index: 3,
      at: NOW,
    });
  });

  it('does not rewind when reviewing an older iteration', () => {
    // Scrolling back to comment on an earlier push must not resurrect work the
    // reviewer has already seen.
    const current: LastReviewed = { sha: 'ccc333', index: 3, at: '2026-02-01T00:00:00Z' };
    expect(nextLastReviewed(iterations, current, 1, NOW)).toBeUndefined();
  });

  it('does not rewrite the record for the iteration already marked', () => {
    const current: LastReviewed = { sha: 'bbb222', index: 2, at: '2026-02-01T00:00:00Z' };
    expect(nextLastReviewed(iterations, current, 2, NOW)).toBeUndefined();
  });

  it('replaces a remembered commit that has vanished from the branch', () => {
    const current: LastReviewed = { sha: 'deadbee', index: 3, at: '2026-02-01T00:00:00Z' };
    expect(nextLastReviewed(iterations, current, 1, NOW)).toEqual({
      sha: 'aaa111',
      index: 1,
      at: NOW,
    });
  });

  it('records nothing when the target iteration does not exist', () => {
    expect(nextLastReviewed(iterations, undefined, 9, NOW)).toBeUndefined();
    expect(nextLastReviewed([], undefined, 0, NOW)).toBeUndefined();
  });
});
