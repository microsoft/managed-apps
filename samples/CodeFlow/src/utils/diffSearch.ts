/**
 * Pure text-search primitives for the diff viewer's in-file find feature.
 *
 * Compiles a query + options (match case / whole word / regex) into a matcher
 * that returns every non-empty match range in a given line of text. The matcher
 * is deliberately stateless per call (it resets the underlying RegExp), so it
 * can be reused across every rendered line.
 */

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface MatchRange {
  /** Inclusive start offset within the line. */
  start: number;
  /** Exclusive end offset within the line. */
  end: number;
}

export interface CompiledMatcher {
  /** Find all non-overlapping, non-empty match ranges within `text`. */
  findAll(text: string): MatchRange[];
}

export type CompileResult =
  /** `matcher` is null when the query is empty (search is inactive). */
  | { ok: true; matcher: CompiledMatcher | null }
  | { ok: false; error: string };

/** Characters treated as "word" characters for whole-word matching. */
const WORD_CHAR = /[A-Za-z0-9_]/;

function isWordChar(ch: string | undefined): boolean {
  return ch != null && WORD_CHAR.test(ch);
}

/** Escape a literal string so it can be embedded in a RegExp source. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * VSCode-style whole-word test: a boundary is satisfied when the match edge is
 * not a word character, or the adjacent character outside the match is not a
 * word character (or is absent). Applied on both ends.
 */
function isWholeWordMatch(text: string, start: number, end: number): boolean {
  const first = text[start];
  const last = text[end - 1];
  const before = text[start - 1];
  const after = text[end];
  const leftOk = !isWordChar(first) || !isWordChar(before);
  const rightOk = !isWordChar(last) || !isWordChar(after);
  return leftOk && rightOk;
}

/** Upper bound on matches per line, guarding against pathological patterns. */
const MAX_MATCHES_PER_LINE = 10000;

export function compileMatcher(query: string, opts: SearchOptions): CompileResult {
  if (!query) return { ok: true, matcher: null };

  const source = opts.regex ? query : escapeRegExp(query);
  let re: RegExp;
  try {
    re = new RegExp(source, opts.caseSensitive ? 'g' : 'gi');
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid regular expression',
    };
  }

  const wholeWord = opts.wholeWord;
  const matcher: CompiledMatcher = {
    findAll(text) {
      const out: MatchRange[] = [];
      if (!text) return out;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (m[0].length === 0) {
          // Zero-width match (e.g. `a*` on "bbb"): advance to avoid an
          // infinite loop and skip it — nothing visible to highlight.
          re.lastIndex = end + 1;
          if (re.lastIndex > text.length) break;
          continue;
        }
        if (!wholeWord || isWholeWordMatch(text, start, end)) {
          out.push({ start, end });
          if (out.length >= MAX_MATCHES_PER_LINE) break;
        }
        // Ensure forward progress even if the engine didn't advance.
        if (re.lastIndex <= start) re.lastIndex = end;
      }
      return out;
    },
  };
  return { ok: true, matcher };
}
