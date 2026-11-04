/**
 * Pure search over every file in the comparison, for the Ctrl+Shift+F panel.
 *
 * Where find-in-file (`useDiffSearch`) searches the *rendered* diff so it can
 * highlight matches in place, this searches the comparison's patches directly.
 * That difference is deliberate: the results panel has to be able to name a hit
 * in a file the reviewer has not opened, so it cannot depend on anything the
 * viewer has built.
 *
 * Each hit is addressed the way a comment is — `{ filename, side, line }` via
 * {@link lineAnchor} — rather than by a row key. Row keys are a property of one
 * rendering of one file (inline vs split, whole file vs changed lines), so they
 * would be wrong by the time the reviewer arrived. A side and a line number
 * survive the trip, and the viewer resolves them against whatever it is showing
 * when it gets there.
 */
import type { DiffSide, FileChange } from '../../types';
import type { DiffSearchOptions } from '../../settings/settings';
import { parsePatch } from '../../utils/diffParser';
import { compileMatcher, type MatchRange } from '../../utils/diffSearch';
import { lineAnchor } from '../DiffViewer/diffViewerUtils';

/** One matching line, with every match range inside it. */
export interface CrossFileHit {
  /** Unique within a result set, and stable for a given query. */
  id: string;
  filename: string;
  side: DiffSide;
  /** Line number on `side`. */
  line: number;
  /** Whether the line was added, deleted, or is unchanged context. */
  kind: 'add' | 'del' | 'context';
  text: string;
  ranges: MatchRange[];
}

/** The hits in one file, in patch order. */
export interface CrossFileFileHits {
  filename: string;
  hits: CrossFileHit[];
  /** Total match count across this file's hits, which may exceed `hits.length`. */
  matches: number;
}

export interface CrossFileSearchResult {
  files: CrossFileFileHits[];
  /** Number of matching lines across every file. */
  lines: number;
  /** Number of individual matches across every file. */
  matches: number;
  /** True when the line cap was reached and the results were truncated. */
  capped: boolean;
  /** Non-null when the query is an invalid regular expression. */
  error: string | null;
  /** False when the query is empty, i.e. nothing was searched for. */
  active: boolean;
}

/**
 * Upper bound on matching *lines*, not matches. A panel is a list of lines, so
 * that is the number which decides whether it stays usable — one line carrying
 * two hundred matches still costs exactly one row.
 */
export const DEFAULT_CROSS_FILE_LINE_CAP = 2000;

const EMPTY: CrossFileSearchResult = {
  files: [],
  lines: 0,
  matches: 0,
  capped: false,
  error: null,
  active: false,
};

/**
 * Search every changed file's patch.
 *
 * Only code lines are searched — hunk headers and `\ No newline` markers are
 * not part of either version of the file, so matching them would send the
 * reviewer to somewhere that does not exist. Files with no patch (binary, too
 * large to diff, or unchanged) contribute nothing.
 */
export function searchAcrossFiles(
  files: readonly FileChange[] | undefined,
  query: string,
  options: DiffSearchOptions,
  lineCap: number = DEFAULT_CROSS_FILE_LINE_CAP,
): CrossFileSearchResult {
  if (!query) return EMPTY;

  const compiled = compileMatcher(query, options);
  if (!compiled.ok) return { ...EMPTY, active: true, error: compiled.error };

  const matcher = compiled.matcher;
  if (!matcher) return EMPTY;

  const out: CrossFileFileHits[] = [];
  let lines = 0;
  let matches = 0;
  let capped = false;

  for (const file of files ?? []) {
    if (capped) break;
    if (!file.patch) continue;

    const diff = parsePatch(file.patch);
    const hits: CrossFileHit[] = [];
    let fileMatches = 0;

    outer: for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        // `lineAnchor` answers for exactly the three code line types and is
        // null for the rest, so it is both the "is this code?" test and the
        // address — there is no second list of line types to keep in step.
        const anchor = lineAnchor(line);
        if (!anchor) continue;
        const ranges = matcher.findAll(line.content);
        if (ranges.length === 0) continue;
        if (lines >= lineCap) {
          capped = true;
          break outer;
        }
        hits.push({
          id: `${file.filename}\u0000${anchor.side}:${anchor.line}`,
          filename: file.filename,
          side: anchor.side,
          line: anchor.line,
          kind: line.type as 'add' | 'del' | 'context',
          text: line.content,
          ranges,
        });
        lines += 1;
        fileMatches += ranges.length;
        matches += ranges.length;
      }
    }

    if (hits.length > 0) out.push({ filename: file.filename, hits, matches: fileMatches });
  }

  return { files: out, lines, matches, capped, error: null, active: true };
}

/** One-line summary of a result set, for the panel header. */
export function resultsLabel(result: CrossFileSearchResult): string {
  if (result.error) return 'Invalid regex';
  if (!result.active) return '';
  if (result.lines === 0) return 'No results';
  const more = result.capped ? '+' : '';
  const lineWord = result.lines === 1 ? 'line' : 'lines';
  const fileWord = result.files.length === 1 ? 'file' : 'files';
  return `${result.matches}${more} in ${result.lines}${more} ${lineWord}, ${result.files.length}${more} ${fileWord}`;
}
