import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedDiff } from '../../../types';
import { useFileComments } from '../useFileComments';
import { lineDraftKey, writeDraft } from '../../../utils/commentDrafts';

/**
 * A restored draft for a brand-new thread has a second half to it: the line it
 * was anchored to. That anchor only ever lived in this hook's state, so after a
 * refresh the composer has to be reopened on the right line or the text has
 * nowhere to appear.
 */

const mockCtx = {
  comparison: { files: [{ filename: 'src/app.ts' }] },
  toIndex: 1,
  prKey: 'o/r#1',
  actions: { createThread: vi.fn(), addComment: vi.fn(), setThreadStatus: vi.fn() },
};

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => mockCtx,
  useFileThreads: () => [],
}));

const emptyDiff: ParsedDiff = { hunks: [], isEmpty: true };

describe('the inline composer after a refresh', () => {
  it('reopens on the line the comment was being written about', () => {
    writeDraft(lineDraftKey('o/r#1', 'src/app.ts', 'right', 12), 'this needs a test');
    const { result } = renderHook(() => useFileComments('src/app.ts', emptyDiff));
    expect(result.current.composer).toEqual({ side: 'right', line: 12 });
  });

  it('stays shut when nothing was part-written', () => {
    const { result } = renderHook(() => useFileComments('src/app.ts', emptyDiff));
    expect(result.current.composer).toBeNull();
  });

  it('does not open on a draft belonging to a different file', () => {
    writeDraft(lineDraftKey('o/r#1', 'src/other.ts', 'right', 12), 'elsewhere');
    const { result } = renderHook(() => useFileComments('src/app.ts', emptyDiff));
    expect(result.current.composer).toBeNull();
  });

  it('follows the reviewer to the next file rather than sitting on its line number', () => {
    // The anchor is a line in one file. Left alone across a file switch it
    // would reopen on whatever unrelated code sits at that line next.
    writeDraft(lineDraftKey('o/r#1', 'src/app.ts', 'right', 12), 'about app.ts');
    const { result, rerender } = renderHook(({ file }) => useFileComments(file, emptyDiff), {
      initialProps: { file: 'src/app.ts' },
    });
    expect(result.current.composer).toEqual({ side: 'right', line: 12 });

    rerender({ file: 'src/other.ts' });
    expect(result.current.composer).toBeNull();

    rerender({ file: 'src/app.ts' });
    expect(result.current.composer).toEqual({ side: 'right', line: 12 });
  });
});
