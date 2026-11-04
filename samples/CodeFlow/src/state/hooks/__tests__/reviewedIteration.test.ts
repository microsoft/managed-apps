import { describe, it, expect } from 'vitest';
import type { CodeFlowState } from '../../codeFlowContext';
import type { Iteration } from '../../../types';
import { withReviewedIteration } from '../reviewedIteration';
import { getLastReviewed } from '../../../utils/storage';

const PR = 'owner/repo#1';

function iter(index: number, sha: string, isBase = false): Iteration {
  return { index, sha, shortSha: sha.slice(0, 6), label: `Iteration ${index}`, isBase };
}

const iterations = [iter(0, 'base000', true), iter(1, 'aaa111'), iter(2, 'bbb222')];

function state(partial: Partial<CodeFlowState> = {}): CodeFlowState {
  return {
    iterations,
    fromIndex: 0,
    toIndex: 2,
    ...partial,
  } as CodeFlowState;
}

describe('withReviewedIteration', () => {
  it('records the iteration under review and puts it in state', () => {
    const next = withReviewedIteration(state(), PR);
    expect(next.lastReviewed).toMatchObject({ sha: 'bbb222', index: 2 });
    expect(getLastReviewed(PR)).toEqual(next.lastReviewed);
  });

  it('returns the same state object when nothing changed', () => {
    // StrictMode runs every updater twice and keeps the second result, so the
    // replay must not produce a different — or empty — record.
    const first = withReviewedIteration(state(), PR);
    const second = withReviewedIteration(first, PR);
    expect(second).toBe(first);
    expect(second.lastReviewed).toEqual(first.lastReviewed);
  });

  it('leaves state alone when there is no iteration to record', () => {
    const empty = state({ iterations: [], toIndex: 0 });
    expect(withReviewedIteration(empty, PR)).toBe(empty);
  });

  it('carries the stored record into state when the marker did not move', () => {
    // Reviewing an older iteration must not blank out what was already known.
    withReviewedIteration(state(), PR);
    const fresh = withReviewedIteration(state({ toIndex: 1 }), PR);
    expect(fresh.lastReviewed).toMatchObject({ sha: 'bbb222' });
  });

  it('keeps markers separate per PR', () => {
    withReviewedIteration(state(), PR);
    withReviewedIteration(state({ toIndex: 1 }), 'owner/repo#2');
    expect(getLastReviewed(PR)?.sha).toBe('bbb222');
    expect(getLastReviewed('owner/repo#2')?.sha).toBe('aaa111');
  });

  it('records an explicit reviewed commit without changing the selected comparison', () => {
    const next = withReviewedIteration(state({ toIndex: 1 }), PR, 'bbb222');
    expect(next.lastReviewed).toMatchObject({ sha: 'bbb222', index: 2 });
    expect(next.toIndex).toBe(1);
    expect(withReviewedIteration(next, PR, 'bbb222')).toBe(next);
    expect(withReviewedIteration(next, PR, 'aaa111')).toBe(next);
    expect(getLastReviewed(PR)).toEqual(next.lastReviewed);
  });

  it('does not substitute the selected iteration for a force-pushed submitted commit', () => {
    const current = state();
    expect(withReviewedIteration(current, PR, 'lost')).toBe(current);
    expect(getLastReviewed(PR)).toBeUndefined();
  });
});
