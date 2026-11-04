import { describe, it, expect } from 'vitest';
import type { PrSummary } from '../../../types';
import { foldPrStatus, samePr } from '../foldPrStatus';

const COORDS = { owner: 'o', name: 'r', number: 1 };

function pr(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    coordinates: COORDS,
    title: 'Test PR',
    state: 'open',
    draft: false,
    merged: false,
    baseRef: 'main',
    baseSha: 'base',
    headRef: 'feature',
    headSha: 'head',
    ...overrides,
  };
}

describe('samePr', () => {
  it('matches on the full coordinate triple', () => {
    expect(samePr(COORDS, { ...COORDS })).toBe(true);
  });

  it.each([
    ['owner', { owner: 'other' }],
    ['repo', { name: 'other' }],
    ['number', { number: 2 }],
  ])('rejects a difference in %s', (_label, diff) => {
    expect(samePr(COORDS, { ...COORDS, ...diff })).toBe(false);
  });
});

describe('foldPrStatus', () => {
  it('adopts a merge that happened elsewhere', () => {
    const next = foldPrStatus(pr(), { state: 'closed', merged: true, draft: false });

    expect(next.merged).toBe(true);
    expect(next.state).toBe('closed');
  });

  it('adopts a close that happened elsewhere', () => {
    const next = foldPrStatus(pr(), { state: 'closed', merged: false, draft: false });

    expect(next).toMatchObject({ state: 'closed', merged: false });
  });

  it('adopts a draft being published elsewhere', () => {
    const next = foldPrStatus(pr({ draft: true }), {
      state: 'open',
      merged: false,
      draft: false,
    });

    expect(next.draft).toBe(false);
  });

  it('lets a closed pull request be reopened', () => {
    const next = foldPrStatus(pr({ state: 'closed' }), {
      state: 'open',
      merged: false,
      draft: false,
    });

    expect(next.state).toBe('open');
  });

  // The merge button patches `merged` the instant GitHub accepts the merge. A
  // request that was already in flight at that moment answers about the past,
  // and must not put the badge back to "Open" until the next tick.
  it('never un-merges a pull request', () => {
    const next = foldPrStatus(pr({ merged: true, state: 'closed' }), {
      state: 'open',
      merged: false,
      draft: false,
    });

    expect(next).toMatchObject({ merged: true, state: 'closed' });
  });

  it('keeps merged, closed and draft consistent with each other', () => {
    const next = foldPrStatus(pr({ draft: true }), {
      state: 'open',
      merged: true,
      draft: true,
    });

    expect(next).toMatchObject({ merged: true, state: 'closed', draft: false });
  });

  it('folds in a freshly computed mergeability', () => {
    const next = foldPrStatus(pr({ mergeable: undefined, mergeableState: 'unknown' }), {
      state: 'open',
      merged: false,
      draft: false,
      mergeable: true,
      mergeableState: 'clean',
    });

    expect(next).toMatchObject({ mergeable: true, mergeableState: 'clean' });
  });

  it('leaves the shas and title alone, since only a reload can move those safely', () => {
    const next = foldPrStatus(pr({ title: 'Original' }), {
      state: 'closed',
      merged: true,
      draft: false,
    });

    expect(next).toMatchObject({ title: 'Original', baseSha: 'base', headSha: 'head' });
  });

  it('keeps the previous updatedAt when the response omits one', () => {
    const next = foldPrStatus(pr({ updatedAt: 'then', merged: false }), {
      state: 'closed',
      merged: true,
      draft: false,
    });

    expect(next.updatedAt).toBe('then');
  });

  it('returns the same object when nothing moved, so a quiet poll causes no re-render', () => {
    const before = pr({ mergeable: true, mergeableState: 'clean', updatedAt: 'now' });
    const next = foldPrStatus(before, {
      state: 'open',
      merged: false,
      draft: false,
      mergeable: true,
      mergeableState: 'clean',
      updatedAt: 'now',
    });

    expect(next).toBe(before);
  });

  it('does not mutate the pull request it was given', () => {
    const before = pr();
    foldPrStatus(before, { state: 'closed', merged: true, draft: false });

    expect(before).toMatchObject({ state: 'open', merged: false });
  });
});
