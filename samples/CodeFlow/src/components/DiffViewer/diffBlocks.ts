/**
 * Groups a parsed diff into "change blocks" for Previous/Next navigation.
 *
 * A block is a run of consecutive changed rows (additions and/or deletions),
 * so a 20-line rewrite counts as ONE stop rather than 20. Context and hunk
 * headers end a block; `meta` rows ("\ No newline at end of file") are
 * transparent so they don't split a delete/add pair.
 *
 * The `rowKey` of a block mirrors the `data-diff-row` attribute emitted by the
 * renderers, so navigation can find the row in the DOM:
 *   - InlineDiff: `${hunkIndex}-${lineIndex}`
 *   - SplitDiff:  the row index into `toSideBySideRows(diff)`
 */
import type { ParsedDiff } from '../../types';
import type { ViewMode } from '../../state/codeFlowContext';
import { parsePatch, toSideBySideRows } from '../../utils/diffParser';

export interface DiffBlock {
  /** `data-diff-row` value of the block's first row. */
  rowKey: string;
  /** Number of rendered rows the block spans. */
  size: number;
}

export function computeDiffBlocks(diff: ParsedDiff, viewMode: ViewMode): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let current: DiffBlock | null = null;

  const push = (rowKey: string) => {
    if (current) current.size += 1;
    else {
      current = { rowKey, size: 1 };
      blocks.push(current);
    }
  };
  const breakRun = () => {
    current = null;
  };

  if (viewMode === 'split') {
    toSideBySideRows(diff).forEach((row, ri) => {
      if (row.type === 'meta') return;
      if (row.type === 'hunk') {
        breakRun();
        return;
      }
      const changed = row.left?.type === 'del' || row.right?.type === 'add';
      if (changed) push(String(ri));
      else breakRun();
    });
    return blocks;
  }

  diff.hunks.forEach((hunk, hi) => {
    hunk.lines.forEach((line, li) => {
      if (line.type === 'meta') return;
      if (line.type === 'add' || line.type === 'del') push(`${hi}-${li}`);
      else breakRun();
    });
  });
  return blocks;
}

/** Number of change blocks in a raw patch — used to skip files with no deltas. */
export function countDiffBlocks(patch: string | undefined | null): number {
  if (!patch) return 0;
  return computeDiffBlocks(parsePatch(patch), 'inline').length;
}
