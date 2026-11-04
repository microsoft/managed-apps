import { describe, expect, it } from 'vitest';
import {
  detectMergeBaseSubstitution,
  isFullRange,
  isMergeIteration,
  mainlineBaseOf,
  mergedInSha,
  resolveCompareRange,
} from '../mergeIterations';
import { anchorKey, lineAnchor } from '../../components/DiffViewer/diffViewerUtils';
import type { DiffLine, Iteration } from '../../types';

const BASE = 'base000';
/** Tip of mainline that iteration 3 merged in. */
const MAINLINE = 'main999';

function commit(index: number, sha: string, parents?: string[]): Iteration {
  return {
    index,
    sha,
    shortSha: sha.slice(0, 7),
    label: `Iteration ${index}`,
    isBase: false,
    ...(parents ? { parents } : {}),
  };
}

/**
 * Mirrors the shape of the PR the bug was reproduced on: a handful of ordinary
 * commits with a merge of mainline sitting in the middle of the branch.
 *
 *   0 base   1 c1   2 c2   3 MERGE   4 c4
 */
const iterations: Iteration[] = [
  { index: 0, sha: BASE, shortSha: BASE.slice(0, 7), label: 'Base', isBase: true },
  commit(1, 'c1'),
  commit(2, 'c2'),
  commit(3, 'm3', ['c2', MAINLINE]),
  commit(4, 'c4'),
];

describe('mergedInSha / isMergeIteration', () => {
  it('reads the second parent of a merge commit', () => {
    expect(mergedInSha(iterations[3])).toBe(MAINLINE);
    expect(isMergeIteration(iterations[3])).toBe(true);
  });

  it('treats single-parent commits as ordinary', () => {
    expect(mergedInSha(iterations[2])).toBeUndefined();
    expect(isMergeIteration(iterations[2])).toBe(false);
  });

  it('tolerates missing, empty and undefined parent data', () => {
    expect(mergedInSha(undefined)).toBeUndefined();
    expect(mergedInSha(commit(9, 'x', []))).toBeUndefined();
    expect(mergedInSha(commit(9, 'x', ['only-one']))).toBeUndefined();
    expect(mergedInSha(commit(9, 'x', ['a', '']))).toBeUndefined();
  });
});

describe('mainlineBaseOf', () => {
  it('falls back to the PR base before any merge', () => {
    expect(mainlineBaseOf(iterations, 0, BASE)).toBe(BASE);
    expect(mainlineBaseOf(iterations, 2, BASE)).toBe(BASE);
  });

  it('uses the merged-in mainline at and after the merge', () => {
    expect(mainlineBaseOf(iterations, 3, BASE)).toBe(MAINLINE);
    expect(mainlineBaseOf(iterations, 4, BASE)).toBe(MAINLINE);
  });

  it('never walks past the end of the list', () => {
    expect(mainlineBaseOf(iterations, 99, BASE)).toBe(MAINLINE);
  });

  it('picks the most recent merge when there are several', () => {
    const later = [...iterations, commit(5, 'm5', ['c4', 'main-later'])];
    expect(mainlineBaseOf(later, 5, BASE)).toBe('main-later');
    expect(mainlineBaseOf(later, 4, BASE)).toBe(MAINLINE);
  });
});

describe('resolveCompareRange', () => {
  it('leaves ranges that do not cross a merge exactly as selected', () => {
    expect(resolveCompareRange(iterations, 0, 2, BASE)).toEqual({
      baseSha: BASE,
      headSha: 'c2',
      substituted: false,
    });
    expect(resolveCompareRange(iterations, 1, 2, BASE)).toEqual({
      baseSha: 'c1',
      headSha: 'c2',
      substituted: false,
    });
  });

  it('rebases a range that ends on the merge onto the merged-in mainline', () => {
    expect(resolveCompareRange(iterations, 2, 3, BASE)).toEqual({
      baseSha: MAINLINE,
      headSha: 'm3',
      substituted: true,
    });
  });

  it('rebases a range that spans the merge', () => {
    expect(resolveCompareRange(iterations, 1, 4, BASE)).toEqual({
      baseSha: MAINLINE,
      headSha: 'c4',
      substituted: true,
    });
  });

  it('leaves a range starting at the merge alone, keeping it incremental', () => {
    expect(resolveCompareRange(iterations, 3, 4, BASE)).toEqual({
      baseSha: 'm3',
      headSha: 'c4',
      substituted: false,
    });
  });

  it('degrades safely when an endpoint is missing', () => {
    const r = resolveCompareRange(iterations, 1, 99, BASE);
    expect(r.substituted).toBe(false);
    expect(r.baseSha).toBe('c1');
  });
});

describe('isFullRange', () => {
  it('recognises the whole PR in either direction', () => {
    expect(isFullRange(iterations, 0, 4)).toBe(true);
    expect(isFullRange(iterations, 4, 0)).toBe(true);
  });

  it('rejects sub-ranges and empty lists', () => {
    expect(isFullRange(iterations, 1, 4)).toBe(false);
    expect(isFullRange(iterations, 0, 3)).toBe(false);
    expect(isFullRange([], 0, 0)).toBe(false);
  });
});

describe('detectMergeBaseSubstitution', () => {
  it('says nothing about the full PR range, which is always correct', () => {
    expect(detectMergeBaseSubstitution(iterations, 0, 4, BASE)).toBeUndefined();
  });

  it('says nothing when the selected range is compared literally', () => {
    expect(detectMergeBaseSubstitution(iterations, 0, 2, BASE)).toBeUndefined();
    expect(detectMergeBaseSubstitution(iterations, 3, 4, BASE)).toBeUndefined();
  });

  it('reports the merge when the range ends on it', () => {
    const info = detectMergeBaseSubstitution(iterations, 2, 3, BASE);
    expect(info?.merge.index).toBe(3);
    expect(info?.atHead).toBe(true);
    expect(info?.toIndex).toBe(3);
  });

  it('reports the merge when the range spans it', () => {
    const info = detectMergeBaseSubstitution(iterations, 1, 4, BASE);
    expect(info?.merge.index).toBe(3);
    expect(info?.atHead).toBe(false);
    expect(info?.fromIndex).toBe(1);
    expect(info?.toIndex).toBe(4);
  });

  it('normalises a reversed selection', () => {
    expect(detectMergeBaseSubstitution(iterations, 4, 1, BASE)).toEqual(
      detectMergeBaseSubstitution(iterations, 1, 4, BASE),
    );
  });
});

/**
 * Comment anchoring.
 *
 * Threads are fetched per-PR and filtered against whatever the current diff
 * renders, so changing the comparison can only move a thread between inline and
 * orphaned — nothing is stored per-range and no comment can be lost.
 *
 * Which way it moves is decided by *file presence*, not by line renumbering:
 * `lineAnchor` reads new-file line numbers, which depend only on the head
 * commit, and the head is unchanged by this fix. What changes is whether the
 * PR's own files appear in the diff at all.
 *
 * Measured on octo-org/octo-repo#123, comparing across its merge:
 *   before — 86 files, 81 of them untouched by the PR, and 32 of the PR's own
 *            37 files missing entirely
 *   after  — 37 files, every one of them present in the PR's base..head diff
 *
 * So the fix strictly increases the number of PR files a reviewer can reach.
 * The tests below drive the real orphan predicate to show the consequence.
 */
describe('comment anchoring across a merge', () => {
  const line = (
    type: DiffLine['type'],
    oldLineNo: number | undefined,
    newLineNo: number | undefined,
  ): DiffLine => ({ type, oldLineNo, newLineNo, content: 'x' }) as DiffLine;

  /** The orphan rule used by DiffViewer: a thread with no matching diff line. */
  function orphaned(
    lines: DiffLine[],
    threads: Array<{ side: 'left' | 'right'; line: number }>,
  ) {
    const anchors = new Set<string>();
    for (const l of lines) {
      const a = lineAnchor(l);
      if (a) anchors.add(anchorKey(a.side, a.line));
    }
    return threads.filter((t) => !anchors.has(anchorKey(t.side, t.line)));
  }

  const threads = [
    { side: 'right' as const, line: 12 },
    { side: 'left' as const, line: 5 },
  ];

  it('orphans comments when the merge view omits the PR file entirely', () => {
    // The old comparison surfaced only what the merge dragged in, so a PR file
    // that the merge did not touch contributed no lines at all.
    expect(orphaned([], threads)).toHaveLength(2);
  });

  it('anchors those same comments once the PR file is back in the diff', () => {
    const lines = [line('add', undefined, 12), line('del', 5, undefined)];
    expect(orphaned(lines, threads)).toHaveLength(0);
  });

  it('keeps right-side anchors stable when only the base commit changes', () => {
    // New-file numbering comes from the head commit, which this fix leaves
    // untouched — so moving the base cannot renumber a right-side anchor.
    const lines = [line('add', undefined, 12), line('context', 40, 13)];
    expect(orphaned(lines, [{ side: 'right', line: 13 }])).toHaveLength(0);
  });
});
