import { describe, it, expect } from 'vitest';
import { computeDiffBlocks, countDiffBlocks } from '../diffBlocks';
import { parsePatch } from '../../../utils/diffParser';

/** Two separate hunks: a 3-line rewrite, then a single added line. */
const PATCH = [
  '@@ -1,5 +1,5 @@',
  ' one',
  '-two',
  '-three',
  '+TWO',
  ' four',
  ' five',
  '@@ -20,3 +20,4 @@',
  ' twenty',
  '+twenty-one',
  ' twenty-two',
].join('\n');

describe('computeDiffBlocks', () => {
  it('treats a run of consecutive changed lines as one block (inline)', () => {
    const blocks = computeDiffBlocks(parsePatch(PATCH), 'inline');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].size).toBe(3);
    expect(blocks[1].size).toBe(1);
  });

  it('keys inline blocks by the first changed row (hunk-line index)', () => {
    const blocks = computeDiffBlocks(parsePatch(PATCH), 'inline');
    // hunk 0, line 2 => header(0), ' one'(1), '-two'(2)
    expect(blocks[0].rowKey).toBe('0-2');
    // hunk 1, line 2 => header(0), ' twenty'(1), '+twenty-one'(2)
    expect(blocks[1].rowKey).toBe('1-2');
  });

  it('produces the same block count in split view', () => {
    const blocks = computeDiffBlocks(parsePatch(PATCH), 'split');
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.size)).toEqual([2, 1]);
  });

  it('keys split blocks by side-by-side row index', () => {
    const blocks = computeDiffBlocks(parsePatch(PATCH), 'split');
    // rows: hunk(0), ' one'(1), del/add(2), del/-(3) ...
    expect(blocks[0].rowKey).toBe('2');
  });

  it('does not split a delete/add pair separated by a no-newline marker', () => {
    const patch = ['@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+B'].join('\n');
    expect(computeDiffBlocks(parsePatch(patch), 'inline')).toHaveLength(1);
    expect(computeDiffBlocks(parsePatch(patch), 'split')).toHaveLength(1);
  });

  it('separates blocks split by context lines', () => {
    const patch = ['@@ -1,4 +1,4 @@', '-a', ' b', '-c', '+C'].join('\n');
    expect(computeDiffBlocks(parsePatch(patch), 'inline')).toHaveLength(2);
  });

  it('returns no blocks for a context-only diff', () => {
    const patch = ['@@ -1,2 +1,2 @@', ' a', ' b'].join('\n');
    expect(computeDiffBlocks(parsePatch(patch), 'inline')).toEqual([]);
  });
});

describe('countDiffBlocks', () => {
  it('counts blocks straight from a patch', () => {
    expect(countDiffBlocks(PATCH)).toBe(2);
  });

  it('returns 0 for a missing patch (binary or too large)', () => {
    expect(countDiffBlocks(undefined)).toBe(0);
    expect(countDiffBlocks('')).toBe(0);
  });
});
