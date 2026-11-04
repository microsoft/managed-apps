import { describe, it, expect } from 'vitest';
import { parsePatch } from '../../../utils/diffParser';
import { findRowKeyForLine } from '../rowForLine';

/**
 * old 1: alpha      new 1: alpha
 * old 2: beta   ->  new 2: BETA
 * old 3: gamma      new 3: gamma
 */
const PATCH = [
  '@@ -1,3 +1,3 @@',
  ' alpha',
  '-beta',
  '+BETA',
  ' gamma',
].join('\n');

const diff = parsePatch(PATCH);

/*
 * `parsePatch` keeps the hunk header as the hunk's first line, so the row keys
 * below start at index 1 for the first real line. The renderers do the same,
 * which is the point — these keys are matched against `data-diff-row`.
 */
describe('findRowKeyForLine (inline)', () => {
  it('finds a deleted line by its old line number', () => {
    expect(findRowKeyForLine(diff, 'inline', 'left', 2)).toBe('0-2');
  });

  it('finds an added line by its new line number', () => {
    expect(findRowKeyForLine(diff, 'inline', 'right', 2)).toBe('0-3');
  });

  it('finds a context line on the right', () => {
    expect(findRowKeyForLine(diff, 'inline', 'right', 1)).toBe('0-1');
    expect(findRowKeyForLine(diff, 'inline', 'right', 3)).toBe('0-4');
  });

  it('does not find a context line on the left, which is where it is not anchored', () => {
    expect(findRowKeyForLine(diff, 'inline', 'left', 1)).toBeNull();
  });

  it('returns null for a line that is not in the diff', () => {
    expect(findRowKeyForLine(diff, 'inline', 'right', 99)).toBeNull();
  });

  it('counts hunks, not just lines', () => {
    const two = parsePatch(
      ['@@ -1,1 +1,1 @@', ' alpha', '@@ -50,1 +50,2 @@', ' omega', '+new'].join('\n'),
    );

    expect(findRowKeyForLine(two, 'inline', 'right', 51)).toBe('1-2');
  });

  it('is empty-safe', () => {
    expect(findRowKeyForLine(parsePatch(undefined), 'inline', 'right', 1)).toBeNull();
  });
});

describe('findRowKeyForLine (split)', () => {
  it('resolves both sides of a paired row to the same row index', () => {
    const left = findRowKeyForLine(diff, 'split', 'left', 2);
    const right = findRowKeyForLine(diff, 'split', 'right', 2);

    expect(left).not.toBeNull();
    expect(left).toBe(right);
  });

  it('returns a row index that is a plain number, matching data-diff-row', () => {
    const key = findRowKeyForLine(diff, 'split', 'right', 3);

    expect(key).toMatch(/^\d+$/);
  });

  it('returns null for a line that is not in the diff', () => {
    expect(findRowKeyForLine(diff, 'split', 'right', 99)).toBeNull();
  });
});
