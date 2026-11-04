/**
 * Resolves a comment-style line address — `{ side, line }` — to the
 * `data-diff-row` key of the row currently rendering it.
 *
 * Cross-file search results travel as a side and a line number because that is
 * the one address that survives leaving the file: row keys belong to a single
 * rendering, and the reviewer may well arrive in the other view mode, with the
 * whole file expanded, or with whitespace collapsed. Resolving here, against
 * the diff that is actually on screen, is what makes the jump land.
 *
 * The key shapes mirror {@link computeDiffBlocks} and the renderers:
 *   - InlineDiff: `${hunkIndex}-${lineIndex}`
 *   - SplitDiff:  the row index into `toSideBySideRows(diff)`
 */
import type { DiffLine, DiffSide, ParsedDiff } from '../../types';
import type { ViewMode } from '../../state/codeFlowContext';
import { toSideBySideRows } from '../../utils/diffParser';
import { lineAnchor } from './diffViewerUtils';

/**
 * The row key for `side`/`line`, or null when that line is not on screen —
 * which is a normal outcome, not an error: a side filter or a whitespace
 * collapse can legitimately remove the line a result points at.
 *
 * Null is not the end of the story, though. Silently stopping there is what
 * made clicking a search result do nothing at all; {@link planLineReveal} runs
 * first and works out which of those filters to lift, so by the time this is
 * asked the line is expected to be present.
 */
export function findRowKeyForLine(
  diff: ParsedDiff,
  viewMode: ViewMode,
  side: DiffSide,
  line: number,
): string | null {
  const matches = (candidate: DiffLine | undefined): boolean => {
    if (!candidate) return false;
    const anchor = lineAnchor(candidate);
    return !!anchor && anchor.side === side && anchor.line === line;
  };

  if (viewMode === 'split') {
    const rows = toSideBySideRows(diff);
    for (let ri = 0; ri < rows.length; ri += 1) {
      const row = rows[ri];
      if (row.type !== 'pair') continue;
      if (matches(row.left) || matches(row.right)) return String(ri);
    }
    return null;
  }

  for (let hi = 0; hi < diff.hunks.length; hi += 1) {
    const lines = diff.hunks[hi].lines;
    for (let li = 0; li < lines.length; li += 1) {
      if (matches(lines[li])) return `${hi}-${li}`;
    }
  }
  return null;
}
