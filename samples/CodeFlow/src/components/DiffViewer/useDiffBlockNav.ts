import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { DiffBlock } from './diffBlocks';
import { scrollDiffRowIntoView } from './diffViewerUtils';

/** A file in the comparison, in list order, flagged with whether it has deltas. */
export interface NavFile {
  filename: string;
  hasBlocks: boolean;
}

export interface DiffBlockNav {
  /** Change blocks in the current file. */
  total: number;
  /** 1-based position of the current block, or null before the first jump. */
  ordinal: number | null;
  canPrev: boolean;
  canNext: boolean;
  next(): void;
  prev(): void;
}

interface Options {
  blocks: DiffBlock[];
  selectedFile: string | undefined;
  /** All changed files in list order — used to roll over to the next/prev file. */
  files: NavFile[];
  selectFile(filename: string): void;
  /** Root of the rendered diff, searched for the target row. */
  rootRef: RefObject<HTMLElement | null>;
}

/**
 * Previous/Next navigation over a file's change blocks.
 *
 * The position starts unset ("above the first block"), so the first Next lands
 * on block 1. Running off either end rolls over to the neighbouring file that
 * actually has changes, landing on its first (Next) or last (Prev) block.
 *
 * Landing is applied via an effect + retry loop because switching files and
 * loading full-file content are async, so the target row may not be in the DOM
 * yet. The scroll also re-runs when `blocks` changes identity (e.g. full file
 * content arrives, or the view mode flips) so the reviewer keeps their place.
 */
export function useDiffBlockNav({
  blocks,
  selectedFile,
  files,
  selectFile,
  rootRef,
}: Options): DiffBlockNav {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [pending, setPending] = useState<{ file: string; edge: 'first' | 'last' } | null>(null);

  // Reset the position whenever the file changes (React's "adjust state during
  // render" pattern), then land on the queued edge as soon as the target file's
  // blocks exist — both done during render so no cascading-effect renders.
  const [prevFile, setPrevFile] = useState(selectedFile);
  if (selectedFile !== prevFile) {
    setPrevFile(selectedFile);
    setActiveIndex(null);
    // A landing only survives the switch it was queued for; picking a
    // different file by hand cancels it.
    if (pending && pending.file !== selectedFile) setPending(null);
  }
  if (pending && pending.file === selectedFile && blocks.length > 0) {
    setPending(null);
    setActiveIndex(pending.edge === 'first' ? 0 : blocks.length - 1);
  }

  const neighbor = useMemo(() => {
    const idx = files.findIndex((f) => f.filename === selectedFile);
    const seek = (start: number, step: number): string | undefined => {
      for (let i = start; i >= 0 && i < files.length; i += step) {
        if (files[i].hasBlocks) return files[i].filename;
      }
      return undefined;
    };
    if (idx < 0) return { next: undefined, prev: undefined };
    return { next: seek(idx + 1, 1), prev: seek(idx - 1, -1) };
  }, [files, selectedFile]);

  const safeIndex = activeIndex != null && activeIndex < blocks.length ? activeIndex : null;

  const goToFile = useCallback(
    (filename: string, edge: 'first' | 'last') => {
      setPending({ file: filename, edge });
      selectFile(filename);
    },
    [selectFile],
  );

  const next = useCallback(() => {
    const target = safeIndex === null ? 0 : safeIndex + 1;
    if (target < blocks.length) {
      setActiveIndex(target);
      return;
    }
    if (neighbor.next) goToFile(neighbor.next, 'first');
  }, [safeIndex, blocks.length, neighbor.next, goToFile]);

  const prev = useCallback(() => {
    const target = safeIndex === null ? -1 : safeIndex - 1;
    if (target >= 0) {
      setActiveIndex(target);
      return;
    }
    if (neighbor.prev) goToFile(neighbor.prev, 'last');
  }, [safeIndex, neighbor.prev, goToFile]);

  // Scroll the active block into view, retrying until the row is rendered.
  useEffect(() => {
    if (safeIndex === null) return;
    const block = blocks[safeIndex];
    if (!block) return;
    let cancelled = false;
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      if (scrollDiffRowIntoView(rootRef.current, block.rowKey)) return;
      if (attempts++ < 40) window.setTimeout(tick, 50);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [safeIndex, blocks, rootRef]);

  return {
    total: blocks.length,
    ordinal: safeIndex === null ? null : safeIndex + 1,
    canNext: (safeIndex === null ? blocks.length > 0 : safeIndex + 1 < blocks.length) || !!neighbor.next,
    canPrev: (safeIndex !== null && safeIndex > 0) || !!neighbor.prev,
    next,
    prev,
  };
}
