import { describe, it, expect } from 'vitest';
import { parsePatch, buildFullFileDiff, toSideBySideRows } from '../diffParser';

describe('parsePatch', () => {
  it('returns empty for null/undefined/empty input', () => {
    expect(parsePatch(null)).toEqual({ hunks: [], isEmpty: true });
    expect(parsePatch(undefined)).toEqual({ hunks: [], isEmpty: true });
    expect(parsePatch('')).toEqual({ hunks: [], isEmpty: true });
  });

  it('parses a single hunk with additions and deletions', () => {
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' line1',
      '-old line2',
      '+new line2',
      '+added line3',
      ' line3',
    ].join('\n');

    const result = parsePatch(patch);
    expect(result.isEmpty).toBe(false);
    expect(result.hunks).toHaveLength(1);

    const hunk = result.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(3);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(4);

    // First line is the hunk header itself
    expect(hunk.lines[0].type).toBe('hunk');

    // Context line
    expect(hunk.lines[1]).toEqual({ type: 'context', oldLineNo: 1, newLineNo: 1, content: 'line1' });

    // Deletion
    expect(hunk.lines[2]).toEqual({ type: 'del', oldLineNo: 2, content: 'old line2' });

    // Additions
    expect(hunk.lines[3]).toEqual({ type: 'add', newLineNo: 2, content: 'new line2' });
    expect(hunk.lines[4]).toEqual({ type: 'add', newLineNo: 3, content: 'added line3' });

    // Context after
    expect(hunk.lines[5]).toEqual({ type: 'context', oldLineNo: 3, newLineNo: 4, content: 'line3' });
  });

  it('parses multiple hunks', () => {
    const patch = [
      '@@ -1,2 +1,2 @@',
      '-a',
      '+b',
      ' c',
      '@@ -10,2 +10,3 @@',
      ' x',
      '+y',
      ' z',
    ].join('\n');

    const result = parsePatch(patch);
    expect(result.hunks).toHaveLength(2);
    expect(result.hunks[0].oldStart).toBe(1);
    expect(result.hunks[1].oldStart).toBe(10);
    expect(result.hunks[1].newLines).toBe(3);
  });

  it('handles hunk with function context in header', () => {
    const patch = '@@ -5,3 +5,4 @@ function foo() {\n context\n+added\n context2\n context3';
    const result = parsePatch(patch);
    expect(result.hunks[0].lines[0].type).toBe('hunk');
    expect(result.hunks[0].lines[0].content).toBe('function foo() {');
  });

  it('handles "no newline at end of file" meta lines', () => {
    const patch = '@@ -1,2 +1,2 @@\n-old\n+new\n\\ No newline at end of file';
    const result = parsePatch(patch);
    const meta = result.hunks[0].lines.find((l) => l.type === 'meta');
    expect(meta).toBeDefined();
    expect(meta!.content).toBe('No newline at end of file');
  });

  it('handles empty context lines (GitHub omits leading space)', () => {
    const patch = '@@ -1,3 +1,3 @@\n line1\n\n line3';
    const result = parsePatch(patch);
    // The empty line should be treated as context
    expect(result.hunks[0].lines[2].type).toBe('context');
  });

  it('handles hunk with single-line old/new counts (no comma)', () => {
    const patch = '@@ -1 +1,2 @@\n-single\n+line1\n+line2';
    const result = parsePatch(patch);
    expect(result.hunks[0].oldStart).toBe(1);
    expect(result.hunks[0].oldLines).toBe(1);
    expect(result.hunks[0].newStart).toBe(1);
    expect(result.hunks[0].newLines).toBe(2);
  });
});

describe('buildFullFileDiff', () => {
  it('shows entire file as context when no patch', () => {
    const fullContent = 'line1\nline2\nline3';
    const result = buildFullFileDiff(null, fullContent);
    expect(result.isEmpty).toBe(false);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].lines).toHaveLength(3);
    expect(result.hunks[0].lines[0]).toEqual({
      type: 'context', oldLineNo: 1, newLineNo: 1, content: 'line1',
    });
    expect(result.hunks[0].lines[2]).toEqual({
      type: 'context', oldLineNo: 3, newLineNo: 3, content: 'line3',
    });
  });

  it('fills gaps before, between, and after hunks', () => {
    // File has 6 lines, patch only touches line 3
    const fullContent = 'a\nb\nX\nd\ne\nf';
    const patch = '@@ -3,1 +3,1 @@\n-c\n+X';

    const result = buildFullFileDiff(patch, fullContent);
    expect(result.isEmpty).toBe(false);
    const lines = result.hunks[0].lines;

    // Lines before the hunk should be context
    expect(lines[0]).toMatchObject({ type: 'context', newLineNo: 1, content: 'a' });
    expect(lines[1]).toMatchObject({ type: 'context', newLineNo: 2, content: 'b' });

    // The hunk change itself
    expect(lines[2]).toMatchObject({ type: 'del', content: 'c' });
    expect(lines[3]).toMatchObject({ type: 'add', content: 'X' });

    // Lines after the hunk
    expect(lines[4]).toMatchObject({ type: 'context', newLineNo: 4, content: 'd' });
    expect(lines[5]).toMatchObject({ type: 'context', newLineNo: 5, content: 'e' });
    expect(lines[6]).toMatchObject({ type: 'context', newLineNo: 6, content: 'f' });
  });
});

describe('toSideBySideRows', () => {
  it('returns empty for empty diff', () => {
    expect(toSideBySideRows({ hunks: [], isEmpty: true })).toEqual([]);
  });

  it('pairs context lines with both sides', () => {
    const diff = parsePatch('@@ -1,2 +1,2 @@\n ctx1\n ctx2');
    const rows = toSideBySideRows(diff);
    // First row is hunk header
    expect(rows[0].type).toBe('hunk');
    // Context rows have both left and right
    expect(rows[1].type).toBe('pair');
    expect(rows[1].left).toBeDefined();
    expect(rows[1].right).toBeDefined();
    expect(rows[1].left?.content).toBe('ctx1');
  });

  it('zips consecutive deletions and additions', () => {
    const diff = parsePatch('@@ -1,2 +1,2 @@\n-old1\n-old2\n+new1\n+new2');
    const rows = toSideBySideRows(diff);
    // Skip hunk header
    expect(rows[1].left?.content).toBe('old1');
    expect(rows[1].right?.content).toBe('new1');
    expect(rows[2].left?.content).toBe('old2');
    expect(rows[2].right?.content).toBe('new2');
  });

  it('leaves unpaired additions with undefined left', () => {
    const diff = parsePatch('@@ -1,1 +1,3 @@\n-old\n+new1\n+new2\n+new3');
    const rows = toSideBySideRows(diff);
    // First pair: old1 vs new1
    expect(rows[1].left?.content).toBe('old');
    expect(rows[1].right?.content).toBe('new1');
    // Extra additions: left is undefined
    expect(rows[2].left).toBeUndefined();
    expect(rows[2].right?.content).toBe('new2');
    expect(rows[3].left).toBeUndefined();
    expect(rows[3].right?.content).toBe('new3');
  });

  it('leaves unpaired deletions with undefined right', () => {
    const diff = parsePatch('@@ -1,3 +1,1 @@\n-del1\n-del2\n-del3\n+kept');
    const rows = toSideBySideRows(diff);
    expect(rows[1].left?.content).toBe('del1');
    expect(rows[1].right?.content).toBe('kept');
    expect(rows[2].left?.content).toBe('del2');
    expect(rows[2].right).toBeUndefined();
    expect(rows[3].left?.content).toBe('del3');
    expect(rows[3].right).toBeUndefined();
  });
});
