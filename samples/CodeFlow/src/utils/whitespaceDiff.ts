/**
 * Collapse whitespace-only changes out of a parsed diff — the local equivalent
 * of GitHub's "Hide whitespace changes" (`?w=1`).
 *
 * Why this exists: an editor that silently rewrites a file's line endings turns
 * a one-line edit into a whole-file rewrite. GitHub hands us a patch that really
 * does delete every line and re-add it, so the reviewer sees hundreds of pairs of
 * lines that look *identical on screen* — the only difference is a trailing `\r`,
 * which renders as nothing. The diff is correct; it is just unreadable.
 *
 * Everything here is pure and operates on the `ParsedDiff` produced by
 * `diffParser`, which is the single choke point every diff surface reads from.
 * Collapsing here therefore fixes rendering, change-block navigation, the change
 * map and in-file search at once, without any renderer knowing about it.
 */

import type { DiffLine, ParsedDiff } from '../types';

/**
 * Whitespace differences that are treated as "not a real change".
 *
 * This is `--ignore-space-change` plus `--ignore-space-at-eol`, i.e. line
 * endings, trailing whitespace, indentation, and runs of whitespace *between*
 * tokens. It deliberately stops short of git's `-w` (`--ignore-all-space`),
 * which also equates `foo bar` with `foobar` — that can hide a genuine edit
 * inside a string literal, and hiding real changes is the failure mode this
 * feature has to be most careful about.
 */
const LEADING_WS = /^[ \t\r\f\v]+/;
const TRAILING_WS = /[ \t\r\f\v]+$/;
const INNER_WS = /[ \t\r\f\v]+/g;

/**
 * Reduce a line to the form used for "is this the same line?" comparisons.
 * Two lines whose normalised forms are equal differ only in whitespace.
 */
export function normalizeWhitespace(content: string): string {
  return content
    .replace(LEADING_WS, '')
    .replace(TRAILING_WS, '')
    .replace(INNER_WS, ' ');
}

/** True when two lines differ, but only in whitespace. */
export function isWhitespaceOnlyChange(before: string, after: string): boolean {
  if (before === after) return false;
  return normalizeWhitespace(before) === normalizeWhitespace(after);
}

export interface WhitespaceCollapseResult {
  /** The diff to render. Identical to the input when nothing was collapsed. */
  diff: ParsedDiff;
  /** How many del/add pairs were folded away. `0` means nothing was hidden. */
  collapsed: number;
  /** Added lines still visible after collapsing. */
  additions: number;
  /** Deleted lines still visible after collapsing. */
  deletions: number;
  /** Added lines before collapsing — what GitHub itself reports. */
  rawAdditions: number;
  /** Deleted lines before collapsing. */
  rawDeletions: number;
}

function countChanges(diff: ParsedDiff): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') additions += 1;
      else if (line.type === 'del') deletions += 1;
    }
  }
  return { additions, deletions };
}

/**
 * Fold whitespace-only del/add pairs into single context lines.
 *
 * Runs of deletions are zipped against the additions that follow them, the same
 * pairing `toSideBySideRows` already uses, so a collapsed diff lines up with how
 * the side-by-side view would have rendered it. A pair whose two sides differ
 * only in whitespace becomes one context line; any pair that differs for real,
 * and any unpaired remainder, is left exactly as it was.
 *
 * The surviving context line keeps *both* `oldLineNo` and `newLineNo`, so
 * comment anchoring — which resolves against `newLineNo` — is unaffected, and it
 * carries the new side's text, because that is what the file actually contains
 * now.
 */
export function collapseWhitespaceOnlyChanges(diff: ParsedDiff): WhitespaceCollapseResult {
  const raw = countChanges(diff);
  const base: Omit<WhitespaceCollapseResult, 'diff' | 'collapsed' | 'additions' | 'deletions'> = {
    rawAdditions: raw.additions,
    rawDeletions: raw.deletions,
  };

  if (diff.isEmpty) {
    return { diff, collapsed: 0, additions: 0, deletions: 0, ...base };
  }

  let collapsed = 0;

  const hunks = diff.hunks.map((hunk) => {
    const out: DiffLine[] = [];
    const body = hunk.lines;
    let i = 0;

    while (i < body.length) {
      const line = body[i];

      if (line.type !== 'del') {
        out.push(line);
        i += 1;
        continue;
      }

      // Gather this run of deletions and the additions that immediately follow.
      const dels: DiffLine[] = [];
      while (i < body.length && body[i].type === 'del') {
        dels.push(body[i]);
        i += 1;
      }
      const adds: DiffLine[] = [];
      while (i < body.length && body[i].type === 'add') {
        adds.push(body[i]);
        i += 1;
      }

      // Zip the two runs. Unmatched lines are buffered so that a collapsed pair
      // never reorders the real changes around it: pending deletions and
      // additions are flushed, in diff order, before each context line.
      const pendingDels: DiffLine[] = [];
      const pendingAdds: DiffLine[] = [];
      const flush = () => {
        out.push(...pendingDels, ...pendingAdds);
        pendingDels.length = 0;
        pendingAdds.length = 0;
      };

      const pairs = Math.max(dels.length, adds.length);
      for (let j = 0; j < pairs; j += 1) {
        const del = dels[j];
        const add = adds[j];

        if (del && add && isWhitespaceOnlyChange(del.content, add.content)) {
          flush();
          out.push({
            type: 'context',
            oldLineNo: del.oldLineNo,
            newLineNo: add.newLineNo,
            content: add.content,
          });
          collapsed += 1;
          continue;
        }

        if (del) pendingDels.push(del);
        if (add) pendingAdds.push(add);
      }
      flush();
    }

    return { ...hunk, lines: out };
  });

  if (collapsed === 0) {
    return {
      diff,
      collapsed: 0,
      additions: raw.additions,
      deletions: raw.deletions,
      ...base,
    };
  }

  const next: ParsedDiff = { ...diff, hunks };
  const after = countChanges(next);
  return {
    diff: next,
    collapsed,
    additions: after.additions,
    deletions: after.deletions,
    ...base,
  };
}
