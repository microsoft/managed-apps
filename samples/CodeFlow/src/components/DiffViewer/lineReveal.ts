/**
 * Works out what has to change on screen before a requested line can be seen.
 *
 * A cross-file search result travels as a `{ side, line }` address read out of
 * the raw patch, but the diff in front of the reviewer is the raw patch after
 * up to three presentation filters: whitespace-only changes collapsed away, one
 * side dropped, and — for Markdown — the whole source view replaced by a
 * rendered document with no diff rows in it at all.
 *
 * Any of those can remove the very line the reviewer just clicked. Resolving
 * the address against the filtered diff and shrugging when it isn't there is
 * the wrong contract for a click: the reviewer asked to be taken somewhere, so
 * either take them there or tell them why not. This module decides which, and
 * it does it as a pure function so the decision is testable without a DOM.
 *
 * The plan only ever *widens* what is shown — preview off, whitespace shown,
 * both sides — because narrowing could hide something else the reviewer was
 * looking at. It is applied as a per-file override, never written back to the
 * saved preferences: revealing one search hit must not redecide how every
 * other file is displayed.
 */
import type { DiffSide, ParsedDiff } from '../../types';
import { filterDiffToSide, type DiffSideMode } from '../../utils/diffSide';
import { lineAnchor } from './diffViewerUtils';

/** The presentation filters that can hide a line, as they currently stand. */
export interface RevealPresentation {
  markdownPreview: boolean;
  ignoreWhitespace: boolean;
  sideMode: DiffSideMode;
}

export type RevealPlan =
  /** The line is already on screen; just scroll to it. */
  | { kind: 'visible' }
  /** Apply this presentation, then the line will be on screen. */
  | { kind: 'reveal'; presentation: RevealPresentation }
  /** The line is in no rendering of this diff, so say so instead of hanging. */
  | { kind: 'unavailable' };

/** True when `side`/`line` is addressable in this diff. */
export function diffHasLine(diff: ParsedDiff, side: DiffSide, line: number): boolean {
  for (const hunk of diff.hunks) {
    for (const candidate of hunk.lines) {
      const anchor = lineAnchor(candidate);
      if (anchor && anchor.side === side && anchor.line === line) return true;
    }
  }
  return false;
}

/**
 * Decide how to reveal `target`.
 *
 * `rawDiff` is the unfiltered parse and `collapsedDiff` is that same diff after
 * the whitespace pass that the current settings asked for — the two are the
 * same object when whitespace is already shown. The side filter is applied
 * here rather than passed in, because the answer depends on the side mode we
 * are *considering*, not the one in force.
 */
export function planLineReveal(
  rawDiff: ParsedDiff,
  collapsedDiff: ParsedDiff,
  target: { side: DiffSide; line: number },
  current: RevealPresentation,
): RevealPlan {
  const { side, line } = target;

  // Whitespace first, because the side filter runs on its output. Collapsing a
  // deletion into its replacement rewrites the pair as a single context line
  // carrying the *new* line number, so a left-side hit loses its address.
  const inCollapsed = diffHasLine(collapsedDiff, side, line);
  if (!inCollapsed && !diffHasLine(rawDiff, side, line)) return { kind: 'unavailable' };

  const ignoreWhitespace = inCollapsed ? current.ignoreWhitespace : false;
  const base = inCollapsed ? collapsedDiff : rawDiff;

  // `both` is the only mode guaranteed to keep the line, and the line is known
  // to be in `base` by now, so this cannot fail.
  const sideMode = diffHasLine(filterDiffToSide(base, current.sideMode), side, line)
    ? current.sideMode
    : 'both';

  // A rendered Markdown document draws no diff rows, so there is nothing to
  // scroll to until the reviewer is back on the source.
  const unchanged =
    !current.markdownPreview
    && ignoreWhitespace === current.ignoreWhitespace
    && sideMode === current.sideMode;

  return unchanged
    ? { kind: 'visible' }
    : { kind: 'reveal', presentation: { markdownPreview: false, ignoreWhitespace, sideMode } };
}
