import { describe, it, expect } from 'vitest';
import {
  findSeed,
  isWordToken,
  selectionToken,
  MAX_SELECTION_LENGTH,
} from '../selectionToken';

describe('selectionToken', () => {
  it('accepts a plain identifier', () => {
    expect(selectionToken('handleClick')).toBe('handleClick');
  });

  it('ignores an empty or absent selection', () => {
    expect(selectionToken(null)).toBeNull();
    expect(selectionToken(undefined)).toBeNull();
    expect(selectionToken('')).toBeNull();
    expect(selectionToken('   ')).toBeNull();
  });

  it('trims the whitespace a double-click drags along', () => {
    expect(selectionToken('  value ')).toBe('value');
  });

  it('rejects a single character, which is usually a slipped drag', () => {
    expect(selectionToken('x')).toBeNull();
    expect(selectionToken(' x ')).toBeNull();
  });

  it('rejects a selection that spans lines', () => {
    expect(selectionToken('foo\nbar')).toBeNull();
    expect(selectionToken('foo\r\nbar')).toBeNull();
  });

  it('rejects a phrase, which is what find is for', () => {
    expect(selectionToken('const value')).toBeNull();
    expect(selectionToken('a\tb')).toBeNull();
  });

  it('rejects pure punctuation, which would match every line', () => {
    expect(selectionToken(');')).toBeNull();
    expect(selectionToken('=>')).toBeNull();
    expect(selectionToken('...')).toBeNull();
  });

  it('rejects a selection longer than a plausible identifier', () => {
    expect(selectionToken('a'.repeat(MAX_SELECTION_LENGTH))).toHaveLength(MAX_SELECTION_LENGTH);
    expect(selectionToken('a'.repeat(MAX_SELECTION_LENGTH + 1))).toBeNull();
  });

  it('keeps mixed tokens that still contain a word character', () => {
    expect(selectionToken('foo.bar')).toBe('foo.bar');
    expect(selectionToken('--flag')).toBe('--flag');
    expect(selectionToken('$ref')).toBe('$ref');
  });
});

describe('isWordToken', () => {
  it('is true for identifiers, so foo does not light up foobar', () => {
    expect(isWordToken('foo')).toBe(true);
    expect(isWordToken('_private')).toBe(true);
    expect(isWordToken('v2')).toBe(true);
  });

  it('is false once the token has no clean boundary to anchor on', () => {
    expect(isWordToken('foo.bar')).toBe(false);
    expect(isWordToken('--flag')).toBe(false);
    expect(isWordToken('$el')).toBe(false);
  });
});

describe('findSeed', () => {
  it('pre-fills find with whatever is selected', () => {
    expect(findSeed('handleClick', null)).toBe('handleClick');
  });

  it('trims the selection, since the find box searches for it verbatim', () => {
    expect(findSeed('  value \n', null)).toBe('value');
  });

  it('falls back to the highlighted word once the marks eat the selection', () => {
    // The regression: painting <mark> over the selected occurrence rewrites the
    // text node it sits in, so the browser reports nothing selected.
    expect(findSeed('', 'value')).toBe('value');
    expect(findSeed(null, 'value')).toBe('value');
    expect(findSeed(undefined, 'value')).toBe('value');
    expect(findSeed('   ', 'value')).toBe('value');
  });

  it('prefers the live selection, which is the truth whenever it survived', () => {
    expect(findSeed('const value', 'value')).toBe('const value');
  });

  it('seeds nothing when neither is available, leaving the box as it was', () => {
    expect(findSeed('', null)).toBeUndefined();
    expect(findSeed(null, undefined)).toBeUndefined();
    expect(findSeed(undefined)).toBeUndefined();
    expect(findSeed('  ', '  ')).toBeUndefined();
  });
});
