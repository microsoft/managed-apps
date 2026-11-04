/**
 * Word-level diff: given an old line and a new line, returns the character
 * ranges that differ in each.
 *
 * The algorithm tokenises each line into an alternating sequence of "word"
 * tokens (runs of word characters: letters, digits, underscore) and
 * "non-word" tokens (everything else), then computes the longest common
 * subsequence on those token sequences. Tokens absent from the LCS are
 * marked as changed.
 *
 * This mirrors how GitHub.com's word-level highlights work and is fast enough
 * to run synchronously on every visible changed line.
 */

import type { MatchRange } from './diffSearch';

export type { MatchRange };

/** A named token within a string. */
interface Token {
  text: string;
  /** Start offset (inclusive) in the original string. */
  start: number;
  /** End offset (exclusive) in the original string. */
  end: number;
}

/** Split a line into alternating word / non-word tokens. */
function tokenize(text: string): Token[] {
  if (!text) return [];
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const isWord = /\w/.test(ch);
    let j = i + 1;
    while (j < text.length && /\w/.test(text[j]) === isWord) j++;
    tokens.push({ text: text.slice(i, j), start: i, end: j });
    i = j;
  }
  return tokens;
}

/**
 * Compute the LCS lengths table for two token arrays (Hunt–Szymanski style DP
 * but standard O(mn) — fast enough for realistic code line lengths).
 *
 * Returns a 2D array `dp` where `dp[i][j]` is the LCS length of the first `i`
 * elements of `a` and the first `j` elements of `b`.
 */
function lcsLengths(a: Token[], b: Token[]): number[][] {
  const m = a.length;
  const n = b.length;
  // Build the table row-by-row, keeping only two rows in memory would be
  // sufficient for just the length, but we need the full table to back-trace.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1].text === b[j - 1].text) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

/**
 * Back-trace the LCS table to find which tokens in each array are NOT part of
 * the common subsequence. Those are the "changed" tokens.
 */
function changedTokens(
  a: Token[],
  b: Token[],
  dp: number[][],
): { changedA: boolean[]; changedB: boolean[] } {
  const changedA = new Array<boolean>(a.length).fill(true);
  const changedB = new Array<boolean>(b.length).fill(true);

  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1].text === b[j - 1].text) {
      changedA[i - 1] = false;
      changedB[j - 1] = false;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return { changedA, changedB };
}

/** Merge adjacent changed tokens into contiguous character ranges. */
function toRanges(tokens: Token[], changed: boolean[]): MatchRange[] {
  const ranges: MatchRange[] = [];
  let start: number | null = null;
  let end: number | null = null;
  for (let i = 0; i < tokens.length; i++) {
    if (!changed[i]) {
      if (start !== null && end !== null) {
        ranges.push({ start, end });
        start = null;
        end = null;
      }
      continue;
    }
    if (start === null) {
      start = tokens[i].start;
    }
    end = tokens[i].end;
  }
  if (start !== null && end !== null) {
    ranges.push({ start, end });
  }
  return ranges;
}

export interface WordDiffResult {
  /** Ranges within `oldText` that differ. */
  oldRanges: MatchRange[];
  /** Ranges within `newText` that differ. */
  newRanges: MatchRange[];
}

/**
 * Compute word-level diff between an old line and a new line.
 *
 * Returns empty range arrays if the lines are identical (no-op),
 * if either string is empty (whole-line change — no sub-highlights
 * needed because the line background already communicates that), or if
 * the lines are so long that the DP table would be unreasonably large.
 */
export function computeWordDiff(oldText: string, newText: string): WordDiffResult {
  const EMPTY: WordDiffResult = { oldRanges: [], newRanges: [] };

  if (!oldText || !newText || oldText === newText) return EMPTY;

  const a = tokenize(oldText);
  const b = tokenize(newText);

  // Guard against O(mn) blow-up on very long generated/minified lines.
  if (a.length * b.length > 200_000) return EMPTY;

  const dp = lcsLengths(a, b);
  const { changedA, changedB } = changedTokens(a, b, dp);

  return {
    oldRanges: toRanges(a, changedA),
    newRanges: toRanges(b, changedB),
  };
}
