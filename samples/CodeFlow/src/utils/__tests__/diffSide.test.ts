import { describe, it, expect } from 'vitest';
import { parsePatch } from '../diffParser';
import {
  DIFF_SIDE_MODES,
  diffSideLabel,
  diffSideTitle,
  filterDiffToSide,
  isDiffSideMode,
  nextDiffSideMode,
  sideFilterEmptyMessage,
} from '../diffSide';

// One context line, one deletion, one addition, one trailing context line.
const PATCH = [
  '@@ -1,3 +1,3 @@',
  ' const alpha = 1;',
  '-const beta = alpha;',
  '+const beta = alpha + alpha;',
  ' const gamma = 3;',
].join('\n');

const diff = parsePatch(PATCH);

const types = (d: ReturnType<typeof parsePatch>) =>
  d.hunks.flatMap((h) => h.lines.map((l) => l.type));

describe('nextDiffSideMode', () => {
  it('cycles both → left → right → both', () => {
    expect(nextDiffSideMode('both')).toBe('left');
    expect(nextDiffSideMode('left')).toBe('right');
    expect(nextDiffSideMode('right')).toBe('both');
  });

  it('visits every mode exactly once per cycle', () => {
    const seen: string[] = [];
    let mode = DIFF_SIDE_MODES[0];
    for (let i = 0; i < DIFF_SIDE_MODES.length; i += 1) {
      seen.push(mode);
      mode = nextDiffSideMode(mode);
    }
    expect(new Set(seen).size).toBe(DIFF_SIDE_MODES.length);
    expect(mode).toBe(DIFF_SIDE_MODES[0]);
  });
});

describe('isDiffSideMode', () => {
  it('accepts the three modes and rejects anything else', () => {
    expect(isDiffSideMode('both')).toBe(true);
    expect(isDiffSideMode('left')).toBe(true);
    expect(isDiffSideMode('right')).toBe(true);
    expect(isDiffSideMode('middle')).toBe(false);
    expect(isDiffSideMode(null)).toBe(false);
    expect(isDiffSideMode(undefined)).toBe(false);
  });
});

describe('filterDiffToSide', () => {
  it('returns the diff untouched for both sides', () => {
    expect(filterDiffToSide(diff, 'both')).toBe(diff);
  });

  it('drops additions for the left side', () => {
    const left = filterDiffToSide(diff, 'left');
    expect(types(left)).toEqual(['hunk', 'context', 'del', 'context']);
    expect(left.isEmpty).toBe(false);
  });

  it('drops deletions for the right side', () => {
    const right = filterDiffToSide(diff, 'right');
    expect(types(right)).toEqual(['hunk', 'context', 'add', 'context']);
    expect(right.isEmpty).toBe(false);
  });

  it('keeps the original line numbers of the surviving lines', () => {
    const left = filterDiffToSide(diff, 'left');
    const del = left.hunks[0].lines.find((l) => l.type === 'del');
    expect(del?.oldLineNo).toBe(2);
    const right = filterDiffToSide(diff, 'right');
    const add = right.hunks[0].lines.find((l) => l.type === 'add');
    expect(add?.newLineNo).toBe(2);
  });

  it('does not mutate the source diff', () => {
    filterDiffToSide(diff, 'left');
    expect(types(diff)).toEqual(['hunk', 'context', 'del', 'add', 'context']);
  });

  it('drops hunks that lose all of their content lines', () => {
    const added = parsePatch(['@@ -0,0 +1,2 @@', '+one', '+two'].join('\n'));
    const left = filterDiffToSide(added, 'left');
    expect(left.hunks).toEqual([]);
    expect(left.isEmpty).toBe(true);
  });

  it('keeps an empty diff empty', () => {
    const empty = parsePatch(undefined);
    expect(filterDiffToSide(empty, 'right').isEmpty).toBe(true);
  });

  it('filters every hunk of a multi-hunk patch', () => {
    const multi = parsePatch(
      [
        '@@ -1,2 +1,2 @@',
        ' a',
        '-b',
        '+B',
        '@@ -10,2 +10,2 @@',
        ' c',
        '-d',
        '+D',
      ].join('\n'),
    );
    const right = filterDiffToSide(multi, 'right');
    expect(right.hunks).toHaveLength(2);
    expect(types(right)).toEqual(['hunk', 'context', 'add', 'hunk', 'context', 'add']);
  });
});

describe('sideFilterEmptyMessage', () => {
  it('says nothing when showing both sides', () => {
    expect(sideFilterEmptyMessage('both', true, false)).toBeNull();
  });

  it('says nothing when the filtered diff still has content', () => {
    expect(sideFilterEmptyMessage('left', false, false)).toBeNull();
  });

  it('says nothing when the file had no diff to begin with', () => {
    expect(sideFilterEmptyMessage('left', true, true)).toBeNull();
  });

  it('explains an added file with no left side', () => {
    expect(sideFilterEmptyMessage('left', true, false)).toMatch(/left/);
  });

  it('explains a deleted file with no right side', () => {
    expect(sideFilterEmptyMessage('right', true, false)).toMatch(/right/);
  });
});

describe('labels', () => {
  it('names each mode', () => {
    expect(diffSideLabel('both')).toBe('Both sides');
    expect(diffSideLabel('left')).toBe('Left only');
    expect(diffSideLabel('right')).toBe('Right only');
  });

  it('describes what clicking does next', () => {
    for (const mode of DIFF_SIDE_MODES) {
      expect(diffSideTitle(mode)).toContain('click to show');
    }
  });
});
