import { describe, it, expect } from 'vitest';
import {
  isRewrittenCommit,
  detectForcePush,
  REWRITE_THRESHOLD_MS,
  type IterationHistory,
} from '../forcePush';
import type { Iteration } from '../../types';

function iter(index: number, sha: string, rewritten?: boolean): Iteration {
  return {
    index,
    sha,
    shortSha: sha.slice(0, 7),
    label: `Iteration ${index}`,
    message: `commit ${index}`,
    isBase: false,
    rewritten,
  };
}

const base: Iteration = {
  index: 0,
  sha: 'base000',
  shortSha: 'base000',
  label: 'Base',
  message: 'Base (main)',
  isBase: true,
};

function history(partial: Partial<IterationHistory>): IterationHistory {
  return {
    knownShas: [],
    lostShas: [],
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('isRewrittenCommit', () => {
  it('treats identical author and committer dates as untouched', () => {
    expect(
      isRewrittenCommit('2026-08-06T19:18:16Z', '2026-08-06T19:18:16Z'),
    ).toBe(false);
  });

  it('ignores skew below the threshold', () => {
    const authored = Date.parse('2026-08-06T19:18:16Z');
    const committed = new Date(authored + REWRITE_THRESHOLD_MS - 1).toISOString();
    expect(isRewrittenCommit('2026-08-06T19:18:16Z', committed)).toBe(false);
  });

  it('flags a commit committed long after it was authored', () => {
    // Real example from PR 31179: authored 19:18, re-committed 21:11 by a rebase.
    expect(
      isRewrittenCommit('2026-08-06T19:18:16Z', '2026-08-06T21:11:17Z'),
    ).toBe(true);
  });

  it('reports no evidence when a date is missing', () => {
    expect(isRewrittenCommit(undefined, '2026-08-06T21:11:17Z')).toBe(false);
    expect(isRewrittenCommit('2026-08-06T19:18:16Z', undefined)).toBe(false);
    expect(isRewrittenCommit(undefined, undefined)).toBe(false);
  });

  it('reports no evidence when a date is unparseable', () => {
    expect(isRewrittenCommit('not-a-date', '2026-08-06T21:11:17Z')).toBe(false);
    expect(isRewrittenCommit('2026-08-06T19:18:16Z', 'not-a-date')).toBe(false);
  });

  it('does not flag a commit committed before it was authored', () => {
    expect(
      isRewrittenCommit('2026-08-06T21:11:17Z', '2026-08-06T19:18:16Z'),
    ).toBe(false);
  });
});

describe('detectForcePush', () => {
  it('returns undefined when there is nothing to report', () => {
    expect(detectForcePush([base, iter(1, 'aaa')], history({ knownShas: ['aaa'] }))).toBeUndefined();
  });

  it('returns undefined when no history has been recorded yet', () => {
    expect(detectForcePush([base, iter(1, 'aaa')])).toBeUndefined();
  });

  it('confirms a force-push when previously seen commits have vanished', () => {
    const info = detectForcePush(
      [base, iter(1, 'ccc')],
      history({ knownShas: ['ccc'], lostShas: ['aaa', 'bbb'] }),
    );
    expect(info).toEqual({ confirmed: true, lostCount: 2, rewriteEvidence: false });
  });

  it.each([
    ['first visit', undefined, ['aaa']],
    ['unchanged commits', history({ knownShas: ['aaa'] }), ['aaa']],
    ['ordinary push', history({ knownShas: ['aaa', 'bbb'] }), ['aaa', 'bbb']],
  ] as const)('does not infer a force-push from commit dates on %s', (_name, recorded, shas) => {
    // A cherry-pick or local rebase before the first push has this same gap.
    const rewritten = isRewrittenCommit('2026-08-06T19:18:16Z', '2026-08-06T21:11:17Z');
    expect(rewritten).toBe(true);
    const iterations = [base, ...shas.map((sha, i) => iter(i + 1, sha, rewritten))];
    expect(detectForcePush(iterations, recorded)).toBeUndefined();
  });

  it('combines both signals when they agree', () => {
    const info = detectForcePush(
      [base, iter(1, 'ccc', true)],
      history({ knownShas: ['ccc'], lostShas: ['aaa'] }),
    );
    expect(info).toEqual({ confirmed: true, lostCount: 1, rewriteEvidence: true });
  });

  it('ignores a rewritten flag on the base entry', () => {
    const rewrittenBase: Iteration = { ...base, rewritten: true };
    expect(detectForcePush(
      [rewrittenBase, iter(1, 'aaa')],
      history({ knownShas: ['aaa'], lostShas: ['bbb'] }),
    )).toEqual({ confirmed: true, lostCount: 1, rewriteEvidence: false });
  });
});
