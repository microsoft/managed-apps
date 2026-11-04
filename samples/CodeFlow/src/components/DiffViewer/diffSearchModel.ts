/**
 * Builds the searchable model for the in-file find feature from a parsed diff.
 *
 * The find widget highlights matches directly in the rendered diff, so the cell
 * keys produced here MUST mirror the row keys used by the renderers:
 *   - InlineDiff: one code cell per line, keyed `${hunkIndex}-${lineIndex}`.
 *   - SplitDiff:  left/right code cells per aligned row, keyed by the row index
 *                 into `toSideBySideRows(diff)`.
 *
 * Only code lines (add / del / context) are searchable — hunk and meta headers
 * are excluded. In split view both columns are searched independently, so every
 * visible occurrence (including identical context lines on both sides) is a
 * match, matching VSCode's diff-editor behavior.
 */
import type { ParsedDiff, DiffLineType } from '../../types';
import type { ViewMode } from '../../state/codeFlowContext';
import { toSideBySideRows } from '../../utils/diffParser';
import type { DiffSideMode } from '../../utils/diffSide';
import type { CompiledMatcher } from '../../utils/diffSearch';

export type SearchColumn = 'inline' | 'left' | 'right';

export interface SearchCell {
  column: SearchColumn;
  rowKey: string;
  text: string;
}

export interface Hit {
  /** Globally-unique id: `${column}:${rowKey}:${ordinalWithinCell}`. */
  id: string;
  /** Key of the owning cell: `${column}:${rowKey}`. */
  cellKey: string;
  column: SearchColumn;
  rowKey: string;
  start: number;
  end: number;
}

export interface HitsResult {
  hits: Hit[];
  /** True when the match cap was reached and results were truncated. */
  capped: boolean;
}

/** Default upper bound on total matches, guarding against huge full files. */
export const DEFAULT_HIT_CAP = 5000;

export function cellKeyOf(column: SearchColumn, rowKey: string): string {
  return `${column}:${rowKey}`;
}

function isCodeLine(type: DiffLineType): boolean {
  return type === 'add' || type === 'del' || type === 'context';
}

/**
 * Produce the ordered list of searchable cells for the current view mode.
 * Order follows visual reading order (top-to-bottom; left-before-right).
 * A hidden diff side contributes no cells, so find never lands on a column
 * that isn't on screen.
 */
export function buildSearchCells(
  diff: ParsedDiff,
  viewMode: ViewMode,
  sideMode: DiffSideMode = 'both',
): SearchCell[] {
  const cells: SearchCell[] = [];

  if (viewMode === 'split') {
    const rows = toSideBySideRows(diff);
    rows.forEach((row, ri) => {
      if (row.type !== 'pair') return;
      const rowKey = String(ri);
      if (sideMode !== 'right' && row.left && isCodeLine(row.left.type)) {
        cells.push({ column: 'left', rowKey, text: row.left.content });
      }
      if (sideMode !== 'left' && row.right && isCodeLine(row.right.type)) {
        cells.push({ column: 'right', rowKey, text: row.right.content });
      }
    });
    return cells;
  }

  diff.hunks.forEach((hunk, hi) => {
    hunk.lines.forEach((line, li) => {
      if (!isCodeLine(line.type)) return;
      cells.push({ column: 'inline', rowKey: `${hi}-${li}`, text: line.content });
    });
  });
  return cells;
}

/** Compute the flat, ordered list of hits across all cells. */
export function computeHits(
  cells: SearchCell[],
  matcher: CompiledMatcher | null,
  cap: number = DEFAULT_HIT_CAP,
): HitsResult {
  const hits: Hit[] = [];
  if (!matcher) return { hits, capped: false };

  for (const cell of cells) {
    const rangesInCell = matcher.findAll(cell.text);
    for (let i = 0; i < rangesInCell.length; i += 1) {
      if (hits.length >= cap) return { hits, capped: true };
      const r = rangesInCell[i];
      hits.push({
        id: `${cell.column}:${cell.rowKey}:${i}`,
        cellKey: cellKeyOf(cell.column, cell.rowKey),
        column: cell.column,
        rowKey: cell.rowKey,
        start: r.start,
        end: r.end,
      });
    }
  }
  return { hits, capped: false };
}

/** Group hits by their owning cell key for per-cell highlight rendering. */
export function groupHitsByCell(hits: Hit[]): Map<string, Hit[]> {
  const map = new Map<string, Hit[]>();
  for (const hit of hits) {
    const arr = map.get(hit.cellKey);
    if (arr) arr.push(hit);
    else map.set(hit.cellKey, [hit]);
  }
  return map;
}
