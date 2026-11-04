import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { appStorage } from '../../storage';

const readDeepLink = vi.fn();
vi.mock('../deepLink', () => ({
  readDeepLink: (...a: unknown[]) => readDeepLink(...a),
}));

const { rememberOpenPr, resolveOpenTarget, resetOpenPrMemory } = await import('../openPrMemory');

const LINKED = { owner: 'o', repo: 'r', number: 7 };
const coords = (number: number) => ({ owner: 'o', name: 'r', number });

beforeEach(() => {
  vi.clearAllMocks();
  readDeepLink.mockReturnValue(null);
  resetOpenPrMemory();
});

describe('resolveOpenTarget', () => {
  it('uses the URL when this tab has not navigated yet', () => {
    readDeepLink.mockReturnValue(LINKED);
    expect(resolveOpenTarget()).toEqual(LINKED);
  });

  it('returns the PR opened after the deep link, not the deep link', () => {
    readDeepLink.mockReturnValue(LINKED);
    rememberOpenPr(coords(8));
    expect(resolveOpenTarget()).toEqual({ owner: 'o', repo: 'r', number: 8 });
  });

  it('keeps the file target when the reviewer is still on the linked PR', () => {
    const withFile = { ...LINKED, file: 'src/a.ts' };
    readDeepLink.mockReturnValue(withFile);
    rememberOpenPr(coords(7));
    expect(resolveOpenTarget()).toEqual(withFile);
  });

  it('opens the dashboard once the reviewer has left the PR', () => {
    readDeepLink.mockReturnValue(LINKED);
    rememberOpenPr(coords(8));
    rememberOpenPr(null);
    expect(resolveOpenTarget()).toBeNull();
  });

  it('lets a newly pasted deep link beat the record', () => {
    readDeepLink.mockReturnValue(LINKED);
    rememberOpenPr(coords(8));

    // A fresh navigation re-reads the URL, which now names a different PR.
    resetAnchorOnly();
    const pasted = { owner: 'o', repo: 'r', number: 99 };
    readDeepLink.mockReturnValue(pasted);
    expect(resolveOpenTarget()).toEqual(pasted);
  });

  it('remembers a PR opened without any deep link', () => {
    rememberOpenPr(coords(8));
    expect(resolveOpenTarget()).toEqual({ owner: 'o', repo: 'r', number: 8 });
  });

  it('falls back to the URL when the stored record is junk', () => {
    appStorage().session.set('openPr', 'not a record');
    readDeepLink.mockReturnValue(LINKED);
    expect(resolveOpenTarget()).toEqual(LINKED);
  });
});

/** Drop the captured URL anchor while keeping the stored record, as a reload does. */
function resetAnchorOnly(): void {
  const saved = appStorage().session.get('openPr', z.unknown());
  resetOpenPrMemory();
  if (saved !== undefined) appStorage().session.set('openPr', saved);
}
