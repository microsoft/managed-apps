import { describe, it, expect } from 'vitest';
import { sliceLayers, overlayMarks, type MarkRange } from '../cellLayers';
import type { TokenRange } from '../../../utils/syntax/tokens';

function mark(start: number, end: number, key = `m${start}`): MarkRange {
  return { start, end, key, className: 'diff__match' };
}

function token(start: number, end: number, kind: TokenRange['kind'] = 'keyword'): TokenRange {
  return { start, end, kind };
}

/** Flattens a plan back to text, so we can assert it still spells the line. */
function textOf(parts: ReturnType<typeof sliceLayers>): string {
  return parts.map((p) => p.segments.map((s) => s.text).join('')).join('');
}

describe('sliceLayers', () => {
  it('returns nothing for an empty cell', () => {
    expect(sliceLayers('', [], [])).toEqual([]);
  });

  it('yields one plain part when there is nothing to draw', () => {
    const parts = sliceLayers('const x = 1;', [], []);
    expect(parts).toEqual([{ mark: null, segments: [{ text: 'const x = 1;', kind: null }] }]);
  });

  it('always covers the whole line', () => {
    const text = 'const value = compute(1, 2);';
    const parts = sliceLayers(text, [mark(6, 11)], [token(0, 5), token(14, 21, 'function')]);
    expect(textOf(parts)).toBe(text);
  });

  it('splits tokens at mark boundaries, not the other way round', () => {
    //          0123456789
    const text = 'abcdefghij';
    // One token spanning the whole line, one mark in the middle.
    const parts = sliceLayers(text, [mark(3, 6)], [token(0, 10, 'string')]);

    expect(parts).toHaveLength(3);
    // The mark survives as exactly one part...
    expect(parts[1].mark).not.toBeNull();
    expect(parts[1].segments).toEqual([{ text: 'def', kind: 'string' }]);
    // ...while the token is cut into three pieces that all keep its kind.
    expect(parts.flatMap((p) => p.segments)).toEqual([
      { text: 'abc', kind: 'string' },
      { text: 'def', kind: 'string' },
      { text: 'ghij', kind: 'string' },
    ]);
  });

  it('visits a token that straddles a mark boundary from both sides', () => {
    const text = 'aaaabbbbcccc';
    // Token 2..10 crosses into the mark at 6 and out again at 8.
    const parts = sliceLayers(text, [mark(6, 8)], [token(2, 10, 'number')]);
    const kinds = parts.map((p) => p.segments.map((s) => s.kind));
    expect(kinds).toEqual([[null, 'number'], ['number'], ['number', null]]);
    expect(textOf(parts)).toBe(text);
  });

  it('drops a later overlapping mark whole rather than truncating it', () => {
    // A truncated find hit would keep its id while no longer covering its match,
    // so the second mark has to disappear entirely.
    const parts = sliceLayers('0123456789', [mark(1, 5, 'a'), mark(3, 8, 'b')], []);
    const keys = parts.filter((p) => p.mark).map((p) => p.mark!.key);
    expect(keys).toEqual(['a']);
    expect(textOf(parts)).toBe('0123456789');
  });

  it('clamps ranges that run past the end of the line', () => {
    const parts = sliceLayers('abc', [mark(1, 99)], [token(0, 99, 'comment')]);
    expect(textOf(parts)).toBe('abc');
    expect(parts[1].segments).toEqual([{ text: 'bc', kind: 'comment' }]);
  });

  it('ignores empty and out-of-range ranges', () => {
    const parts = sliceLayers('abc', [mark(2, 2), mark(9, 12)], [token(-5, 0)]);
    expect(parts).toEqual([{ mark: null, segments: [{ text: 'abc', kind: null }] }]);
  });

  it('accepts marks and tokens in any order', () => {
    const jumbled = sliceLayers('0123456789', [mark(6, 8, 'b'), mark(1, 3, 'a')], [token(7, 9), token(0, 2)]);
    const ordered = sliceLayers('0123456789', [mark(1, 3, 'a'), mark(6, 8, 'b')], [token(0, 2), token(7, 9)]);
    expect(jumbled).toEqual(ordered);
  });

  it('handles adjacent marks with no gap between them', () => {
    const parts = sliceLayers('abcdef', [mark(0, 3, 'a'), mark(3, 6, 'b')], []);
    expect(parts.map((p) => p.mark?.key)).toEqual(['a', 'b']);
    expect(textOf(parts)).toBe('abcdef');
  });

  it('leaves gaps between tokens unkinded', () => {
    const parts = sliceLayers('let x', [], [token(0, 3)]);
    expect(parts[0].segments).toEqual([
      { text: 'let', kind: 'keyword' },
      { text: ' x', kind: null },
    ]);
  });
});

/** A base-layer mark, i.e. a word-diff highlight: no id, safe to split. */
function base(start: number, end: number, key = `b${start}`): MarkRange {
  return { start, end, key, className: 'diff__word-change' };
}

/** An overlay mark, i.e. a selection occurrence. */
function over(start: number, end: number, key = `o${start}`): MarkRange {
  return { start, end, key, className: 'diff__selmatch' };
}

describe('overlayMarks', () => {
  it('returns the other layer untouched when one is empty', () => {
    const marks = [base(0, 3)];
    expect(overlayMarks(marks, [])).toBe(marks);
    expect(overlayMarks([], marks)).toBe(marks);
  });

  it('keeps disjoint ranges from both layers, in order', () => {
    const merged = overlayMarks([base(6, 9)], [over(0, 3)]);
    expect(merged.map((m) => [m.start, m.end, m.className])).toEqual([
      [0, 3, 'diff__selmatch'],
      [6, 9, 'diff__word-change'],
    ]);
  });

  it('splits a base range around an overlay that lands inside it', () => {
    const merged = overlayMarks([base(0, 10)], [over(4, 6)]);
    expect(merged.map((m) => [m.start, m.end, m.className])).toEqual([
      [0, 4, 'diff__word-change'],
      [4, 6, 'diff__selmatch'],
      [6, 10, 'diff__word-change'],
    ]);
  });

  it('gives every fragment its own key', () => {
    const merged = overlayMarks([base(0, 10, 'wd')], [over(4, 6)]);
    const keys = merged.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['wd+0', 'o4', 'wd+6']);
  });

  it('trims a base range the overlay only partly covers', () => {
    expect(overlayMarks([base(0, 10)], [over(0, 4)]).map((m) => [m.start, m.end])).toEqual([
      [0, 4],
      [4, 10],
    ]);
    expect(overlayMarks([base(0, 10)], [over(6, 10)]).map((m) => [m.start, m.end])).toEqual([
      [0, 6],
      [6, 10],
    ]);
  });

  it('drops a base range the overlay swallows whole', () => {
    const merged = overlayMarks([base(2, 5)], [over(0, 10)]);
    expect(merged.map((m) => m.className)).toEqual(['diff__selmatch']);
  });

  it('handles several overlays cutting one base range', () => {
    const merged = overlayMarks([base(0, 12)], [over(2, 4), over(8, 10)]);
    expect(merged.map((m) => [m.start, m.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 8],
      [8, 10],
      [10, 12],
    ]);
  });

  it('drops an addressed base mark rather than splitting its id in two', () => {
    const hit: MarkRange = {
      start: 0,
      end: 10,
      key: 'h',
      className: 'diff__match',
      hitId: 'inline:0-0:0',
    };
    const merged = overlayMarks([hit], [over(4, 6)]);
    expect(merged.map((m) => m.className)).toEqual(['diff__selmatch']);
  });

  it('produces a layer sliceLayers can render without dropping anything', () => {
    const text = '0123456789';
    const merged = overlayMarks([base(0, 10)], [over(4, 6)]);
    const parts = sliceLayers(text, merged, []);
    expect(textOf(parts)).toBe(text);
    expect(parts.map((p) => p.mark?.className)).toEqual([
      'diff__word-change',
      'diff__selmatch',
      'diff__word-change',
    ]);
  });
});
