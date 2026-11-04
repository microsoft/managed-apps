import { describe, it, expect } from 'vitest';
import {
  encodeAnchoredBody,
  decodeAnchor,
  stripAnchor,
  isOutOfDiffError,
} from '../anchorMarker';

describe('encodeAnchoredBody', () => {
  it('embeds the line and side in a marker and quotes the source line', () => {
    const out = encodeAnchoredBody('Needs a null check', { line: 42, side: 'right' }, '  const x = y;');

    expect(out).toContain('<!-- codeflow:anchor line=42 side=right -->');
    expect(out).toContain('> **Line 42** · `const x = y;`');
    expect(out).toContain('<!-- /codeflow:anchor -->');
    expect(out).toContain('Needs a null check');
  });

  it('omits the code span when there is no line text', () => {
    const out = encodeAnchoredBody('hi', { line: 7, side: 'left' });
    expect(out).toContain('> **Line 7**');
    expect(out).not.toContain('·');
  });

  it('replaces backticks so they cannot break out of the code span', () => {
    const out = encodeAnchoredBody('x', { line: 1, side: 'right' }, 'a `b` c');
    expect(out).toContain("`a 'b' c`");
  });

  it('round-trips through decode', () => {
    const out = encodeAnchoredBody('body text', { line: 99, side: 'left' }, 'code');
    expect(decodeAnchor(out)).toEqual({ line: 99, side: 'left' });
  });

  it('round-trips through strip, leaving only the user text', () => {
    const out = encodeAnchoredBody('body text', { line: 99, side: 'left' }, 'code');
    expect(stripAnchor(out)).toBe('body text');
  });

  it('preserves multi-line and markdown bodies exactly', () => {
    const body = '## Heading\n\n- one\n- two\n\n```ts\nconst a = 1;\n```';
    const out = encodeAnchoredBody(body, { line: 5, side: 'right' }, 'x');
    expect(stripAnchor(out)).toBe(body);
  });
});

describe('decodeAnchor', () => {
  it('returns null for an ordinary body', () => {
    expect(decodeAnchor('just a normal comment')).toBeNull();
    expect(decodeAnchor('')).toBeNull();
  });

  it('returns null for a malformed or non-positive marker', () => {
    expect(decodeAnchor('<!-- codeflow:anchor line=0 side=right -->')).toBeNull();
    expect(decodeAnchor('<!-- codeflow:anchor side=right -->')).toBeNull();
    expect(decodeAnchor('<!-- codeflow:anchor line=5 side=middle -->')).toBeNull();
  });

  it('tolerates extra whitespace in the marker', () => {
    expect(decodeAnchor('<!--   codeflow:anchor   line=12   side=left   -->')).toEqual({
      line: 12,
      side: 'left',
    });
  });
});

describe('stripAnchor', () => {
  it('leaves an ordinary body untouched', () => {
    expect(stripAnchor('plain body')).toBe('plain body');
  });

  it('does not strip a marker that appears mid-body', () => {
    const body = 'talking about <!-- codeflow:anchor line=3 side=right --> markers';
    expect(stripAnchor(body)).toBe(body);
  });
});

describe('isOutOfDiffError', () => {
  it.each([
    'The line number doesn\'t exist in the pull request diff',
    'line must be part of the diff',
    'pull_request_review_thread.line could not be resolved',
    "diff hunk can't be blank",
    'Line is not part of the diff',
  ])('recognises %s', (msg) => {
    expect(isOutOfDiffError(msg)).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isOutOfDiffError('permission denied')).toBe(false);
    expect(isOutOfDiffError('Not Found')).toBe(false);
    expect(isOutOfDiffError('')).toBe(false);
  });
});
