import { describe, it, expect } from 'vitest';
import {
  classifyAll,
  classifyInProgress,
  enrichedToItem,
  indexByPrKey,
  prKeyOf,
  prListSignature,
  type ClassifyContext,
} from '../dashboardReview';
import type { PrListItem } from '../../types';
import type { InProgressReview } from '../storage';

function item(number: number, extra: Partial<PrListItem> = {}): PrListItem {
  return {
    coordinates: { owner: 'o', name: 'r', number },
    title: `PR #${number}`,
    ...extra,
  };
}

function entry(number: number, startedAt = '2026-01-19T00:00:00Z'): InProgressReview {
  return { owner: 'o', name: 'r', number, title: `stored #${number}`, startedAt };
}

function ctx(over: Partial<ClassifyContext> = {}): ClassifyContext {
  return {
    reviewed: new Map(),
    requested: new Map(),
    authored: new Map(),
    ...over,
  };
}

describe('prKeyOf / indexByPrKey', () => {
  it('builds the canonical owner/repo#number key', () => {
    expect(prKeyOf({ owner: 'octo', name: 'app', number: 7 })).toBe('octo/app#7');
  });

  it('indexes search results by pr key', () => {
    const index = indexByPrKey([item(1), item(2)]);
    expect([...index.keys()]).toEqual(['o/r#1', 'o/r#2']);
    expect(index.get('o/r#2')?.title).toBe('PR #2');
  });
});

describe('classifyInProgress', () => {
  it('buckets a PR the user has already reviewed as waiting', () => {
    const result = classifyInProgress(
      entry(1),
      ctx({ reviewed: indexByPrKey([item(1, { title: 'live title' })]) }),
    );
    expect(result.bucket).toBe('waiting');
    expect(result.live?.title).toBe('live title');
    expect(result.reason).toBeUndefined();
  });

  it('buckets an unreviewed PR as action', () => {
    const result = classifyInProgress(entry(1), ctx());
    expect(result.bucket).toBe('action');
    expect(result.reason).toBe('Not reviewed yet');
  });

  it('attaches live data from the review-requested search', () => {
    const result = classifyInProgress(
      entry(1),
      ctx({ requested: indexByPrKey([item(1, { updatedAt: '2026-01-19T12:00:00Z' })]) }),
    );
    expect(result.bucket).toBe('action');
    expect(result.live?.updatedAt).toBe('2026-01-19T12:00:00Z');
  });

  it('attaches live data from the authored search', () => {
    const result = classifyInProgress(entry(1), ctx({ authored: indexByPrKey([item(1)]) }));
    expect(result.live).toBeDefined();
  });

  it('prefers the reviewed search when a PR appears in more than one', () => {
    const result = classifyInProgress(
      entry(1),
      ctx({
        reviewed: indexByPrKey([item(1, { title: 'from reviewed' })]),
        requested: indexByPrKey([item(1, { title: 'from requested' })]),
      }),
    );
    expect(result.live?.title).toBe('from reviewed');
  });

  it('keeps a PR visible even when no search returned it', () => {
    // Fails open: the searches are capped and qualifier-scoped, so absence is
    // not proof the PR is closed.
    const result = classifyInProgress(entry(1), ctx());
    expect(result.bucket).toBe('action');
  });
});

describe('classifyAll', () => {
  it('classifies every entry and preserves order', () => {
    const result = classifyAll(
      [entry(1), entry(2), entry(3)],
      ctx({ reviewed: indexByPrKey([item(3)]) }),
    );
    expect(result.map((r) => r.entry.number)).toEqual([1, 2, 3]);
    expect(result.map((r) => r.bucket)).toEqual(['action', 'action', 'waiting']);
  });

  it('makes no network-shaped assumptions with empty searches', () => {
    const result = classifyAll([entry(1), entry(2)], ctx());
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.bucket === 'action')).toBe(true);
  });
});

describe('enrichedToItem', () => {
  it('uses live search data when available', () => {
    const enriched = classifyInProgress(
      entry(1),
      ctx({ reviewed: indexByPrKey([item(1, { title: 'fresh', draft: true })]) }),
    );
    const built = enrichedToItem(enriched);
    expect(built.title).toBe('fresh');
    expect(built.draft).toBe(true);
  });

  it('falls back to the stored title when no search returned the PR', () => {
    const built = enrichedToItem(classifyInProgress(entry(1), ctx()));
    expect(built.title).toBe('stored #1');
    expect(built.coordinates).toEqual({ owner: 'o', name: 'r', number: 1 });
  });

  it('falls back to a placeholder when nothing has a title', () => {
    const built = enrichedToItem(
      classifyInProgress(
        { owner: 'o', name: 'r', number: 9, startedAt: '2026-01-19T00:00:00Z' },
        ctx(),
      ),
    );
    expect(built.title).toBe('PR #9');
  });
});

describe('prListSignature', () => {
  it('is order-independent', () => {
    const a = prListSignature([
      { owner: 'o', name: 'r', number: 2 },
      { owner: 'o', name: 'r', number: 1 },
    ]);
    const b = prListSignature([
      { owner: 'o', name: 'r', number: 1 },
      { owner: 'o', name: 'r', number: 2 },
    ]);
    expect(a).toBe(b);
  });

  it('changes when membership changes', () => {
    const a = prListSignature([{ owner: 'o', name: 'r', number: 1 }]);
    const b = prListSignature([{ owner: 'o', name: 'r', number: 2 }]);
    expect(a).not.toBe(b);
  });
});
