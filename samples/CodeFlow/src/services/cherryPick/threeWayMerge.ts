/**
 * A line-based three-way merge — the thing that makes a cherry-pick a
 * cherry-pick rather than a copy.
 *
 * Copying the pull request's version of a file onto another branch silently
 * discards whatever that branch did to the same file. Git never does that: it
 * applies the *change* the commit made, against the common ancestor, and stops
 * when the two sides touched the same lines. This reproduces that, because the
 * three inputs it needs are all readable through the connector — the file at
 * the pull request's base (the ancestor), at the target branch (ours), and at
 * the pull request's head (theirs).
 *
 * The algorithm is the classic diff3: align both sides against the ancestor,
 * and walk it. Where both sides agree with the ancestor, nothing happened.
 * Where exactly one side moved, that side wins. Where both moved, it is a
 * conflict unless they happened to move identically.
 */

import { alignLines } from '../../utils/lineAlignment';

export type MergeResult =
  /** The two sides combined cleanly. `content` is the merged file. */
  | { status: 'clean'; content: string }
  /** Both sides changed the same region differently. */
  | { status: 'conflict'; conflicts: number }
  /** The file is too large to merge in the browser. */
  | { status: 'unmergeable' };

/**
 * Split a file into lines losslessly.
 *
 * `split('\n')` leaves a trailing `''` for a file ending in a newline, which is
 * exactly what makes `join('\n')` round-trip. That empty element is a real line
 * for merge purposes: it is how "file ends with a newline" differs from "file
 * does not", and the merge should notice when one side changes that.
 */
export function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

/** Inverse of {@link splitLines}. */
export function joinLines(lines: readonly string[]): string {
  return lines.join('\n');
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/**
 * Decide one region where at least one side left the ancestor.
 *
 * This is the whole of the merge's judgement, and the ordering matters: two
 * sides that made the *same* edit have not conflicted, so that case is tested
 * before either "only one side moved" case.
 */
function resolveRegion(
  ancSlice: readonly string[],
  oursSlice: readonly string[],
  theirsSlice: readonly string[],
): string[] | null {
  if (sameLines(oursSlice, theirsSlice)) return [...oursSlice];
  if (sameLines(oursSlice, ancSlice)) return [...theirsSlice];
  if (sameLines(theirsSlice, ancSlice)) return [...oursSlice];
  return null;
}

/**
 * Merge `theirs` into `ours`, both descended from `base`.
 *
 * Conflicts are counted and reported rather than written into the output as
 * markers. A cherry-pick here produces a commit, not a working tree, and a
 * commit full of `<<<<<<<` is a broken build pushed under a reviewer's name.
 */
export function mergeThreeWay(base: string, ours: string, theirs: string): MergeResult {
  // The cheap answers, which between them cover almost every real file.
  if (ours === theirs) return { status: 'clean', content: ours };
  if (base === ours) return { status: 'clean', content: theirs };
  if (base === theirs) return { status: 'clean', content: ours };

  const anc = splitLines(base);
  const a = splitLines(ours);
  const b = splitLines(theirs);

  const ao = alignLines(anc, a);
  const bo = alignLines(anc, b);
  if (!ao || !bo) return { status: 'unmergeable' };

  const out: string[] = [];
  let conflicts = 0;
  let i = 0;
  let ai = 0;
  let bi = 0;

  while (i < anc.length) {
    if (ao.matched[i] && bo.matched[i]) {
      // An anchored ancestor line still has to account for anything either
      // side inserted *before* it. Those insertions sit in the gap between two
      // anchors, where no unmatched ancestor line exists to notice them.
      const aGap = a.slice(ai, ao.pos[i]);
      const bGap = b.slice(bi, bo.pos[i]);
      if (aGap.length > 0 || bGap.length > 0) {
        const merged = resolveRegion([], aGap, bGap);
        if (merged === null) conflicts++;
        else out.push(...merged);
      }

      out.push(anc[i]);
      ai = ao.pos[i] + 1;
      bi = bo.pos[i] + 1;
      i++;
      continue;
    }

    // Grow the region until both sides are anchored on the ancestor again;
    // anything less and the slices below would not line up.
    let j = i;
    while (j < anc.length && !(ao.matched[j] && bo.matched[j])) j++;

    const aEnd = j < anc.length ? ao.pos[j] : a.length;
    const bEnd = j < anc.length ? bo.pos[j] : b.length;

    const merged = resolveRegion(anc.slice(i, j), a.slice(ai, aEnd), b.slice(bi, bEnd));
    if (merged === null) conflicts++;
    else out.push(...merged);

    i = j;
    ai = aEnd;
    bi = bEnd;
  }

  // Lines appended past the end of the ancestor by either side.
  const aTail = a.slice(ai);
  const bTail = b.slice(bi);
  if (aTail.length > 0 || bTail.length > 0) {
    const merged = resolveRegion([], aTail, bTail);
    if (merged === null) conflicts++;
    else out.push(...merged);
  }

  if (conflicts > 0) return { status: 'conflict', conflicts };
  return { status: 'clean', content: joinLines(out) };
}
