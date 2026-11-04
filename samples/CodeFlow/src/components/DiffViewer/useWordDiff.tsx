/**
 * Hook that computes word-level highlight ranges for all paired
 * del→add lines in the current diff and returns a `renderContent`-compatible
 * renderer that wraps changed tokens in a `<mark class="diff__word-change">`.
 *
 * Works for both inline and split view modes:
 *   - Split: `toSideBySideRows` already pairs del with add; word diff runs on
 *     every `left`(del) / `right`(add) pair.
 *   - Inline: consecutive del/add runs are paired by position (first del with
 *     first add, etc.).  Unpaired lines in an asymmetric run get no sub-highlights
 *     — the line background already communicates that the whole line changed.
 *
 * The ranges are also exposed directly as `marksFor`, which is how the viewer
 * layers them underneath syntax highlighting: the marks stay whole and the
 * syntax tokens are sliced to fit inside them.  `render` is the standalone path
 * for when nothing else is drawing on the line.
 */

import { useMemo, type ReactNode } from 'react';
import type { ParsedDiff } from '../../types';
import type { ViewMode } from '../../state/codeFlowContext';
import { toSideBySideRows } from '../../utils/diffParser';
import type { DiffSideMode } from '../../utils/diffSide';
import { computeWordDiff } from '../../utils/wordDiff';
import type { MatchRange } from '../../utils/wordDiff';
import type { SearchColumn } from './diffSearchModel';
import { cellKeyOf } from './diffSearchModel';
import type { MarkRange } from './cellLayers';
import { renderCell } from './renderCell';

const NO_MARKS: MarkRange[] = [];
const NO_TOKENS: never[] = [];

function toMarks(ranges: MatchRange[] | undefined): MarkRange[] {
  if (!ranges || ranges.length === 0) return NO_MARKS;
  return ranges.map((range) => ({
    start: range.start,
    end: range.end,
    className: 'diff__word-change',
    key: `wd-${range.start}`,
  }));
}

/** Map from `cellKeyOf(column, rowKey)` → MatchRange[] */
type WordDiffMap = Map<string, MatchRange[]>;

function buildSplitWordDiff(diff: ParsedDiff): WordDiffMap {
  const map: WordDiffMap = new Map();
  const rows = toSideBySideRows(diff);
  rows.forEach((row, ri) => {
    if (row.type !== 'pair') return;
    const { left, right } = row;
    if (!left || !right) return;
    if (left.type !== 'del' || right.type !== 'add') return;
    const result = computeWordDiff(left.content, right.content);
    const rowKey = String(ri);
    if (result.oldRanges.length > 0) {
      map.set(cellKeyOf('left', rowKey), result.oldRanges);
    }
    if (result.newRanges.length > 0) {
      map.set(cellKeyOf('right', rowKey), result.newRanges);
    }
  });
  return map;
}

function buildInlineWordDiff(diff: ParsedDiff): WordDiffMap {
  const map: WordDiffMap = new Map();
  diff.hunks.forEach((hunk, hi) => {
    // Scan through lines, collecting consecutive del/add runs and pairing them.
    const body = hunk.lines;
    let i = 0;
    while (i < body.length) {
      const line = body[i];
      if (line.type !== 'del') { i++; continue; }

      // Collect the del run.
      const delStart = i;
      while (i < body.length && body[i].type === 'del') i++;
      const delEnd = i; // exclusive

      // Collect the immediately following add run.
      const addStart = i;
      while (i < body.length && body[i].type === 'add') i++;
      const addEnd = i; // exclusive

      if (addStart === addEnd) continue; // no add follows — skip

      const delCount = delEnd - delStart;
      const addCount = addEnd - addStart;
      const pairCount = Math.min(delCount, addCount);

      for (let p = 0; p < pairCount; p++) {
        const delLine = body[delStart + p];
        const addLine = body[addStart + p];
        const result = computeWordDiff(delLine.content, addLine.content);
        if (result.oldRanges.length > 0) {
          map.set(cellKeyOf('inline', `${hi}-${delStart + p}`), result.oldRanges);
        }
        if (result.newRanges.length > 0) {
          map.set(cellKeyOf('inline', `${hi}-${addStart + p}`), result.newRanges);
        }
      }
    }
  });
  return map;
}

export interface WordDiff {
  /** True when word-level highlights are available for this diff. */
  hasHighlights: boolean;
  /** The change ranges for one cell, for layering under other highlights. */
  marksFor(column: SearchColumn, rowKey: string): MarkRange[];
  /**
   * Render a code cell's text with word-level change marks.
   * Drop-in replacement for the `renderContent` prop in InlineDiff / SplitDiff.
   */
  render(column: SearchColumn, rowKey: string, text: string): ReactNode;
}

/**
 * Compute word-level highlight ranges for a parsed diff and expose a `render`
 * function compatible with the `renderContent` prop used by `InlineDiff` and
 * `SplitDiff`.
 *
 * The hook is memoised on `diff` (by reference), so it only re-runs when the
 * parsed diff actually changes (file switch, iteration change, etc.).
 */
export function useWordDiff(
  diff: ParsedDiff,
  viewMode: ViewMode,
  _sideMode: DiffSideMode,
): WordDiff {
  const wordMap = useMemo<WordDiffMap>(() => {
    if (diff.isEmpty) return new Map();
    return viewMode === 'split'
      ? buildSplitWordDiff(diff)
      : buildInlineWordDiff(diff);
  }, [diff, viewMode]);

  const hasHighlights = wordMap.size > 0;

  const marksFor = useMemo(
    () =>
      (column: SearchColumn, rowKey: string): MarkRange[] =>
        toMarks(wordMap.get(cellKeyOf(column, rowKey))),
    [wordMap],
  );

  const render = useMemo(
    () =>
      (column: SearchColumn, rowKey: string, text: string): ReactNode =>
        renderCell(text, marksFor(column, rowKey), NO_TOKENS),
    [marksFor],
  );

  return { hasHighlights, marksFor, render };
}
