import { describe, expect, it } from 'vitest';
import { compareFileContents, MAX_COMPARE_CHARACTERS, MAX_COMPARE_LINES } from '../fileComparison';
import { alignLines } from '../lineAlignment';

const body = (left: string, right: string) => compareFileContents(left, right).diff.hunks.flatMap((hunk) => hunk.lines);

describe('compareFileContents', () => {
  it('compares actual SQL versions with context and correct line numbers', () => {
    const result = compareFileContents(
      'CREATE PROC UpdateSales_V2\nAS\nSELECT amount\nGO\n',
      'CREATE PROC UpdateSales_V3\nAS\nSELECT amount * 2\nGO\n',
    );
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(2);
    expect(result.diff.hunks[0].lines).toEqual([
      { type: 'del', content: 'CREATE PROC UpdateSales_V2', oldLineNo: 1 },
      { type: 'add', content: 'CREATE PROC UpdateSales_V3', newLineNo: 1 },
      { type: 'context', content: 'AS', oldLineNo: 2, newLineNo: 2 },
      { type: 'del', content: 'SELECT amount', oldLineNo: 3 },
      { type: 'add', content: 'SELECT amount * 2', newLineNo: 3 },
      { type: 'context', content: 'GO', oldLineNo: 4, newLineNo: 4 },
    ]);
  });

  it('aligns insertions, deletions and repeated lines rather than comparing by index', () => {
    const lines = body('a\nrepeat\nremoved\nrepeat\nz\n', 'new\na\nrepeat\nrepeat\nz\n');
    expect(lines.filter((line) => line.type === 'add')).toEqual([{ type: 'add', content: 'new', newLineNo: 1 }]);
    expect(lines.filter((line) => line.type === 'del')).toEqual([{ type: 'del', content: 'removed', oldLineNo: 3 }]);
    expect(lines.at(-1)).toEqual({ type: 'context', content: 'z', oldLineNo: 5, newLineNo: 5 });
  });

  it.each([
    ['', '', 0, 0],
    ['', 'new\n', 1, 0],
    ['old\n', '', 0, 1],
    ['\n', '', 0, 1],
    ['same\n', 'same\n', 0, 0],
    ['same\r\n', 'same\n', 0, 0],
    ['same', 'same\n', 1, 1],
    ['same\n', 'same', 1, 1],
  ])('handles empty files and final newlines: %j / %j', (left, right, additions, deletions) => {
    const result = compareFileContents(left, right);
    expect(result.additions).toBe(additions);
    expect(result.deletions).toBe(deletions);
    expect(result.diff.hunks[0]?.oldLines ?? 0).toBe(left.match(/\n|[^\n]+$/g)?.length ?? 0);
    expect(result.diff.hunks[0]?.newLines ?? 0).toBe(right.match(/\n|[^\n]+$/g)?.length ?? 0);
  });

  it('makes missing final newlines explicit without inventing a blank line', () => {
    expect(body('a', 'a\n')).toEqual([
      { type: 'del', content: 'a', oldLineNo: 1 },
      { type: 'add', content: 'a', newLineNo: 1 },
      { type: 'meta', content: 'Left file has no newline at end of file.' },
    ]);
  });

  it('preserves both inputs and sequential line numbers for many repeated-line combinations', () => {
    const inputs = ['', 'a\n', 'b\n', 'a\nb\n', 'b\na\n', 'a\na\nb\n', 'b\na\nb\n', 'a\nb\na\n', '\na\n'];
    for (const left of inputs) {
      for (const right of inputs) {
        const lines = body(left, right);
        const old = lines.filter((line) => line.type === 'del' || line.type === 'context');
        const fresh = lines.filter((line) => line.type === 'add' || line.type === 'context');
        expect(old.map((line) => `${line.content}\n`).join('')).toBe(left);
        expect(fresh.map((line) => `${line.content}\n`).join('')).toBe(right);
        expect(old.map((line) => line.oldLineNo)).toEqual(old.map((_, i) => i + 1));
        expect(fresh.map((line) => line.newLineNo)).toEqual(fresh.map((_, i) => i + 1));
      }
    }
  });

  it('trims common edges so long similar files fit the alignment budget', () => {
    const prefix = 'context\n'.repeat(2000);
    const suffix = 'tail\n'.repeat(2000);
    const result = compareFileContents(`${prefix}old\n${suffix}`, `${prefix}new\n${suffix}`);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });

  it('bounds content, rendered lines and alignment work with explicit errors', () => {
    expect(() => compareFileContents('a'.repeat(MAX_COMPARE_CHARACTERS), '')).not.toThrow();
    expect(() => compareFileContents('a'.repeat(MAX_COMPARE_CHARACTERS), 'a')).toThrow('2,000,000 characters');
    expect(() => compareFileContents('\n'.repeat(MAX_COMPARE_LINES), '')).not.toThrow();
    expect(() => compareFileContents('\n'.repeat(MAX_COMPARE_LINES), '\n')).toThrow('10,000 lines');
    expect(() => compareFileContents('left\n'.repeat(1500), 'right\n'.repeat(1500))).toThrow('too many differing lines');
    expect(() => compareFileContents('a\0b', 'text')).toThrow('Binary');
    expect(() => compareFileContents('text', '\0')).toThrow('Binary');
  });

  it('retains the exact shared alignment allocation boundary', () => {
    expect(alignLines(Array<string>(1999).fill('a'), Array<string>(999).fill('b'))).not.toBeNull();
    expect(alignLines(Array<string>(2000).fill('a'), Array<string>(999).fill('b'))).toBeNull();
  });
});
