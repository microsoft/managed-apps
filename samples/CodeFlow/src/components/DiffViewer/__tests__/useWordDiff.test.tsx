import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWordDiff } from '../useWordDiff';
import type { ParsedDiff } from '../../../types';

function makeDiff(lines: Array<{ type: 'add' | 'del' | 'context'; content: string }>): ParsedDiff {
  return {
    isEmpty: false,
    hunks: [
      {
        header: '@@ -1,3 +1,3 @@',
        oldStart: 1,
        oldLines: lines.length,
        newStart: 1,
        newLines: lines.length,
        lines: [
          { type: 'hunk', content: '@@ -1,3 +1,3 @@' },
          ...lines.map((l, i) => ({
            type: l.type,
            content: l.content,
            ...(l.type === 'del' ? { oldLineNo: i + 1 } : {}),
            ...(l.type === 'add' ? { newLineNo: i + 1 } : {}),
            ...(l.type === 'context' ? { oldLineNo: i + 1, newLineNo: i + 1 } : {}),
          })),
        ],
      },
    ],
  };
}

describe('useWordDiff — inline mode', () => {
  it('returns hasHighlights=false for empty diff', () => {
    const diff: ParsedDiff = { hunks: [], isEmpty: true };
    const { result } = renderHook(() => useWordDiff(diff, 'inline', 'both'));
    expect(result.current.hasHighlights).toBe(false);
  });

  it('returns hasHighlights=false for context-only diff', () => {
    const diff = makeDiff([{ type: 'context', content: 'unchanged' }]);
    const { result } = renderHook(() => useWordDiff(diff, 'inline', 'both'));
    expect(result.current.hasHighlights).toBe(false);
  });

  it('returns hasHighlights=true when a del/add pair exists with differences', () => {
    const diff = makeDiff([
      { type: 'del', content: 'class Foo' },
      { type: 'add', content: 'class Bar' },
    ]);
    const { result } = renderHook(() => useWordDiff(diff, 'inline', 'both'));
    expect(result.current.hasHighlights).toBe(true);
  });

  it('render returns plain text for a context line with no highlights', () => {
    const diff = makeDiff([
      { type: 'context', content: 'hello' },
    ]);
    const { result } = renderHook(() => useWordDiff(diff, 'inline', 'both'));
    const output = result.current.render('inline', '0-1', 'hello');
    expect(output).toBe('hello');
  });

  it('render returns marks for a changed word', () => {
    // del line is at hunk body index 0 → `0-1`, add is at 1 → `0-2`
    const diff = makeDiff([
      { type: 'del', content: 'class Foo' },
      { type: 'add', content: 'class Bar' },
    ]);
    const { result } = renderHook(() => useWordDiff(diff, 'inline', 'both'));
    // del line: hunk 0, body index 0 → rowKey '0-1' (hunk header is body[0])
    const delOutput = result.current.render('inline', '0-1', 'class Foo');
    // add line: body index 1 → rowKey '0-2'
    const addOutput = result.current.render('inline', '0-2', 'class Bar');
    // Both should be arrays (nodes) since changes were found
    expect(Array.isArray(delOutput)).toBe(true);
    expect(Array.isArray(addOutput)).toBe(true);
  });
});

describe('useWordDiff — split mode', () => {
  it('returns hasHighlights=true when a del/add pair exists', () => {
    const diff = makeDiff([
      { type: 'del', content: 'foo = 1' },
      { type: 'add', content: 'foo = 2' },
    ]);
    const { result } = renderHook(() => useWordDiff(diff, 'split', 'both'));
    expect(result.current.hasHighlights).toBe(true);
  });

  it('render returns marks for the right (add) column', () => {
    const diff = makeDiff([
      { type: 'del', content: 'foo = 1' },
      { type: 'add', content: 'foo = 2' },
    ]);
    const { result } = renderHook(() => useWordDiff(diff, 'split', 'both'));
    // Row 1 is the first pair (row 0 is the hunk header)
    const addOutput = result.current.render('right', '1', 'foo = 2');
    expect(Array.isArray(addOutput)).toBe(true);
  });

  it('render returns plain text when no word diff exists for a cell', () => {
    const diff = makeDiff([
      { type: 'context', content: 'no change' },
    ]);
    const { result } = renderHook(() => useWordDiff(diff, 'split', 'both'));
    const output = result.current.render('left', '0', 'no change');
    expect(output).toBe('no change');
  });
});
