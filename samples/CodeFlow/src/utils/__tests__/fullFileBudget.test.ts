import { describe, it, expect } from 'vitest';
import {
  countLines,
  isOversizeForFullFile,
  MAX_FULL_FILE_LINES,
  NO_FULL_FILE_LINE_LIMIT,
} from '../fullFileBudget';

describe('countLines', () => {
  it('counts nothing in an empty string', () => {
    expect(countLines('')).toBe(0);
  });

  it('counts a single unterminated line', () => {
    expect(countLines('one line')).toBe(1);
  });

  it('counts the lines between separators', () => {
    expect(countLines('a\nb\nc')).toBe(3);
  });

  // A file ending in a newline has an empty final line, and buildFullFileDiff
  // splits it the same way — so the count has to match, or the budget would be
  // measuring a different document from the one being rendered.
  it('counts the empty line a trailing newline creates', () => {
    expect(countLines('a\nb\n')).toBe(3);
    expect(countLines('a\nb\n'.split('\n').join('\n'))).toBe('a\nb\n'.split('\n').length);
  });

  it('counts a string of only newlines', () => {
    expect(countLines('\n\n')).toBe(3);
  });

  it('is unbothered by carriage returns', () => {
    expect(countLines('a\r\nb\r\n')).toBe(3);
  });
});

describe('isOversizeForFullFile', () => {
  const linesOf = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');

  it('treats content we do not have as not oversize', () => {
    // "we couldn't fetch it" is a separate state the header reports on its own;
    // it must not be mistaken for "it's too big".
    expect(isOversizeForFullFile(undefined)).toBe(false);
  });

  it('lets an ordinary file through', () => {
    expect(isOversizeForFullFile(linesOf(200))).toBe(false);
  });

  it('lets a file exactly at the limit through', () => {
    expect(isOversizeForFullFile(linesOf(MAX_FULL_FILE_LINES))).toBe(false);
  });

  it('holds back the first file over the limit', () => {
    expect(isOversizeForFullFile(linesOf(MAX_FULL_FILE_LINES + 1))).toBe(true);
  });

  it('holds back the size the hang was reported at', () => {
    expect(isOversizeForFullFile(linesOf(2000))).toBe(true);
  });

  it('accepts a caller-supplied limit', () => {
    expect(isOversizeForFullFile(linesOf(10), 5)).toBe(true);
    expect(isOversizeForFullFile(linesOf(10), 50)).toBe(false);
  });

  it('never holds a file back once the limit is switched off', () => {
    expect(isOversizeForFullFile(linesOf(100_000), NO_FULL_FILE_LINE_LIMIT)).toBe(false);
  });

  it('fails open on a nonsensical negative limit rather than stopping everything', () => {
    expect(isOversizeForFullFile(linesOf(10), -1)).toBe(false);
  });

  it('is set below the size it was reported at, not at it', () => {
    // The reporter's 2000-line file is where the hang became unmissable, not
    // where it began; a limit of 2000 would have shipped the bug back.
    expect(MAX_FULL_FILE_LINES).toBeLessThan(2000);
  });
});
