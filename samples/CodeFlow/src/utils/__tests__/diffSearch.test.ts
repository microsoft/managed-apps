import { describe, it, expect } from 'vitest';
import { compileMatcher, escapeRegExp, type SearchOptions } from '../diffSearch';

const OPTS = (o: Partial<SearchOptions> = {}): SearchOptions => ({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...o,
});

function ranges(query: string, text: string, o: Partial<SearchOptions> = {}) {
  const res = compileMatcher(query, OPTS(o));
  if (!res.ok) throw new Error(`expected ok, got error: ${res.error}`);
  if (!res.matcher) return null;
  return res.matcher.findAll(text);
}

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c?')).toBe('a\\.b\\*c\\?');
    expect(escapeRegExp('(foo)[bar]')).toBe('\\(foo\\)\\[bar\\]');
  });
});

describe('compileMatcher — empty query', () => {
  it('returns a null matcher (inactive) for empty query', () => {
    const res = compileMatcher('', OPTS());
    expect(res).toEqual({ ok: true, matcher: null });
  });
});

describe('compileMatcher — literal', () => {
  it('finds all occurrences, case-insensitive by default', () => {
    expect(ranges('foo', 'foo FOO Foo')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it('respects match case', () => {
    expect(ranges('foo', 'foo FOO Foo', { caseSensitive: true })).toEqual([
      { start: 0, end: 3 },
    ]);
  });

  it('treats special characters literally when regex is off', () => {
    expect(ranges('a.b', 'a.b axb aXb')).toEqual([{ start: 0, end: 3 }]);
  });
});

describe('compileMatcher — whole word', () => {
  it('matches only standalone words', () => {
    // "cat" in "cat category scatter cat."
    const text = 'cat category scatter cat.';
    expect(ranges('cat', text, { wholeWord: true })).toEqual([
      { start: 0, end: 3 },
      { start: 21, end: 24 },
    ]);
  });

  it('allows non-word-boundary queries', () => {
    // A query ending in a non-word char has an automatically-satisfied edge.
    expect(ranges('foo.', 'foo. foobar', { wholeWord: true })).toEqual([
      { start: 0, end: 4 },
    ]);
  });

  it('combines whole word with regex', () => {
    const text = 'id id2 myid id';
    expect(ranges('i\\w', text, { wholeWord: true, regex: true })).toEqual([
      { start: 0, end: 2 },
      { start: 12, end: 14 },
    ]);
  });
});

describe('compileMatcher — regex', () => {
  it('applies the pattern with global matching', () => {
    expect(ranges('\\d+', 'a12 b3 c456', { regex: true })).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 6 },
      { start: 8, end: 11 },
    ]);
  });

  it('honors case sensitivity in regex mode', () => {
    expect(ranges('[a-z]+', 'Abc DEF ghi', { regex: true, caseSensitive: true })).toEqual([
      { start: 1, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it('skips zero-width matches without looping', () => {
    // `a*` matches empty strings between chars; only the real "aa" run counts.
    expect(ranges('a*', 'baab', { regex: true })).toEqual([{ start: 1, end: 3 }]);
  });

  it('returns an error for an invalid pattern', () => {
    const res = compileMatcher('(', OPTS({ regex: true }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/./);
  });
});

describe('compileMatcher — edge cases', () => {
  it('returns no ranges for empty text', () => {
    expect(ranges('x', '')).toEqual([]);
  });

  it('finds adjacent, non-overlapping matches', () => {
    expect(ranges('aa', 'aaaa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});
