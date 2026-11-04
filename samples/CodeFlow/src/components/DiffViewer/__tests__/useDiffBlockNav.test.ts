import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useDiffBlockNav, type NavFile } from '../useDiffBlockNav';
import type { DiffBlock } from '../diffBlocks';

const scrollDiffRowIntoView = vi.hoisted(() => vi.fn(() => true));

vi.mock('../diffViewerUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diffViewerUtils')>();
  return { ...actual, scrollDiffRowIntoView };
});

const blocksOf = (n: number): DiffBlock[] =>
  Array.from({ length: n }, (_, i) => ({ rowKey: `0-${i}`, size: 1 }));

const FILES: NavFile[] = [
  { filename: 'a.ts', hasBlocks: true },
  { filename: 'b.bin', hasBlocks: false },
  { filename: 'c.ts', hasBlocks: true },
];

function setup(initial: { blocks: DiffBlock[]; selectedFile: string; files?: NavFile[] }) {
  const selectFile = vi.fn();
  const rootRef = createRef<HTMLElement>();
  const view = renderHook(
    (props: { blocks: DiffBlock[]; selectedFile: string }) =>
      useDiffBlockNav({
        blocks: props.blocks,
        selectedFile: props.selectedFile,
        files: initial.files ?? FILES,
        selectFile,
        rootRef,
      }),
    { initialProps: { blocks: initial.blocks, selectedFile: initial.selectedFile } },
  );
  return { ...view, selectFile };
}

beforeEach(() => {
  scrollDiffRowIntoView.mockClear();
});

describe('useDiffBlockNav', () => {
  it('starts unpositioned and reports the block total', () => {
    const { result } = setup({ blocks: blocksOf(3), selectedFile: 'a.ts' });
    expect(result.current.total).toBe(3);
    expect(result.current.ordinal).toBeNull();
    expect(result.current.canNext).toBe(true);
    expect(result.current.canPrev).toBe(false);
  });

  it('lands on the first block on the first Next, then advances', () => {
    const { result } = setup({ blocks: blocksOf(3), selectedFile: 'a.ts' });

    act(() => result.current.next());
    expect(result.current.ordinal).toBe(1);
    expect(scrollDiffRowIntoView).toHaveBeenCalledWith(null, '0-0');

    act(() => result.current.next());
    expect(result.current.ordinal).toBe(2);
    expect(result.current.canPrev).toBe(true);
  });

  it('walks back to the previous block', () => {
    const { result } = setup({ blocks: blocksOf(3), selectedFile: 'a.ts' });
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.prev());
    expect(result.current.ordinal).toBe(1);
  });

  it('rolls over to the next file with changes, skipping files without any', () => {
    const { result, rerender, selectFile } = setup({ blocks: blocksOf(1), selectedFile: 'a.ts' });

    act(() => result.current.next());
    expect(result.current.ordinal).toBe(1);

    act(() => result.current.next());
    expect(selectFile).toHaveBeenCalledWith('c.ts');

    // The provider switches files; the new file's blocks arrive on rerender.
    rerender({ blocks: blocksOf(2), selectedFile: 'c.ts' });
    expect(result.current.ordinal).toBe(1);
  });

  it('rolls back into the previous file on its LAST block', () => {
    const { result, rerender, selectFile } = setup({ blocks: blocksOf(2), selectedFile: 'c.ts' });

    act(() => result.current.prev());
    expect(selectFile).toHaveBeenCalledWith('a.ts');

    rerender({ blocks: blocksOf(4), selectedFile: 'a.ts' });
    expect(result.current.ordinal).toBe(4);
  });

  it('does not roll over past the ends of the file list', () => {
    const only: NavFile[] = [{ filename: 'a.ts', hasBlocks: true }];
    const { result } = setup({ blocks: blocksOf(1), selectedFile: 'a.ts', files: only });

    act(() => result.current.next());
    expect(result.current.canNext).toBe(false);
    expect(result.current.canPrev).toBe(false);

    act(() => result.current.next());
    expect(result.current.ordinal).toBe(1);
  });

  it('resets the position when the user picks a different file directly', () => {
    const { result, rerender } = setup({ blocks: blocksOf(3), selectedFile: 'a.ts' });
    act(() => result.current.next());
    expect(result.current.ordinal).toBe(1);

    rerender({ blocks: blocksOf(2), selectedFile: 'c.ts' });
    expect(result.current.ordinal).toBeNull();
  });

  it('re-scrolls to the same block when the blocks are rebuilt (full file loads)', () => {
    const { result, rerender } = setup({ blocks: blocksOf(3), selectedFile: 'a.ts' });
    act(() => result.current.next());
    scrollDiffRowIntoView.mockClear();

    rerender({ blocks: [{ rowKey: '0-9', size: 1 }, ...blocksOf(2)], selectedFile: 'a.ts' });
    expect(scrollDiffRowIntoView).toHaveBeenCalledWith(null, '0-9');
  });

  it('reports no navigation for a file with no change blocks', () => {
    const only: NavFile[] = [{ filename: 'a.ts', hasBlocks: false }];
    const { result } = setup({ blocks: [], selectedFile: 'a.ts', files: only });
    expect(result.current.total).toBe(0);
    expect(result.current.canNext).toBe(false);
    expect(result.current.canPrev).toBe(false);
  });
});
