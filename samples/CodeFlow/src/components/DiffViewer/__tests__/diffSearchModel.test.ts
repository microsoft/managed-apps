import { describe, it, expect } from 'vitest';
import { parsePatch } from '../../../utils/diffParser';
import { compileMatcher } from '../../../utils/diffSearch';
import {
  buildSearchCells,
  computeHits,
  groupHitsByCell,
  cellKeyOf,
  DEFAULT_HIT_CAP,
} from '../diffSearchModel';

// A small patch: one context, one deletion, one addition.
const PATCH = [
  '@@ -1,3 +1,3 @@',
  ' const alpha = 1;',
  '-const beta = alpha;',
  '+const beta = alpha + alpha;',
  ' const gamma = 3;',
].join('\n');

const diff = parsePatch(PATCH);

function matcher(query: string, opts = {}) {
  const res = compileMatcher(query, {
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    ...opts,
  });
  if (!res.ok) throw new Error(res.error);
  return res.matcher;
}

describe('buildSearchCells — inline', () => {
  it('emits one cell per code line, skipping hunk/meta', () => {
    const cells = buildSearchCells(diff, 'inline');
    expect(cells.map((c) => c.column)).toEqual(['inline', 'inline', 'inline', 'inline']);
    // rowKeys follow `${hunkIndex}-${lineIndex}`; index 0 is the hunk header.
    expect(cells.map((c) => c.rowKey)).toEqual(['0-1', '0-2', '0-3', '0-4']);
    expect(cells[1].text).toBe('const beta = alpha;');
  });
});

describe('buildSearchCells — split', () => {
  it('emits left and right cells for aligned rows', () => {
    const cells = buildSearchCells(diff, 'split');
    const columns = cells.map((c) => c.column);
    expect(columns).toContain('left');
    expect(columns).toContain('right');
    // The deleted line is only on the left; the added line only on the right.
    const leftTexts = cells.filter((c) => c.column === 'left').map((c) => c.text);
    const rightTexts = cells.filter((c) => c.column === 'right').map((c) => c.text);
    expect(leftTexts).toContain('const beta = alpha;');
    expect(rightTexts).toContain('const beta = alpha + alpha;');
  });

  it('searches context lines on both sides (VSCode diff-editor parity)', () => {
    const cells = buildSearchCells(diff, 'split');
    const hits = computeHits(cells, matcher('alpha')).hits;
    // 'alpha' appears: context left+right (alpha=1 has 'alpha'? no) ...
    // Occurrences of 'alpha': line1 context "const alpha = 1;" (both sides),
    // deleted "const beta = alpha;" (left), added "...alpha + alpha;" (right x2).
    const byColumn = hits.reduce<Record<string, number>>((acc, h) => {
      acc[h.column] = (acc[h.column] ?? 0) + 1;
      return acc;
    }, {});
    expect(byColumn.left).toBeGreaterThan(0);
    expect(byColumn.right).toBeGreaterThan(0);
  });

  it('skips the hidden column when only one side is shown', () => {
    const leftOnly = buildSearchCells(diff, 'split', 'left');
    expect(leftOnly.every((c) => c.column === 'left')).toBe(true);
    expect(leftOnly.length).toBeGreaterThan(0);

    const rightOnly = buildSearchCells(diff, 'split', 'right');
    expect(rightOnly.every((c) => c.column === 'right')).toBe(true);
    expect(rightOnly.length).toBeGreaterThan(0);
  });

  it('treats an omitted side mode as both sides', () => {
    expect(buildSearchCells(diff, 'split')).toEqual(buildSearchCells(diff, 'split', 'both'));
  });
});

describe('computeHits', () => {
  it('returns ordered, uniquely-identified hits', () => {
    const cells = buildSearchCells(diff, 'inline');
    const { hits, capped } = computeHits(cells, matcher('alpha'));
    expect(capped).toBe(false);
    // ids unique
    expect(new Set(hits.map((h) => h.id)).size).toBe(hits.length);
    // the added line contains two 'alpha' occurrences with distinct ordinals
    const addedHits = hits.filter((h) => h.rowKey === '0-3');
    expect(addedHits.length).toBe(2);
    expect(addedHits[0].start).toBeLessThan(addedHits[1].start);
  });

  it('returns nothing for a null (empty-query) matcher', () => {
    const cells = buildSearchCells(diff, 'inline');
    expect(computeHits(cells, null).hits).toEqual([]);
  });

  it('honors the cap and flags truncation', () => {
    const cells = buildSearchCells(diff, 'inline');
    const { hits, capped } = computeHits(cells, matcher('const'), 1);
    expect(hits.length).toBe(1);
    expect(capped).toBe(true);
  });

  it('has a sane default cap', () => {
    expect(DEFAULT_HIT_CAP).toBeGreaterThan(100);
  });
});

describe('groupHitsByCell', () => {
  it('groups hits under their cell key', () => {
    const cells = buildSearchCells(diff, 'inline');
    const { hits } = computeHits(cells, matcher('alpha'));
    const grouped = groupHitsByCell(hits);
    expect(grouped.get(cellKeyOf('inline', '0-3'))?.length).toBe(2);
  });
});
