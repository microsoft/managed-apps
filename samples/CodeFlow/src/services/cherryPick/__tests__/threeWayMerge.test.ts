import { describe, it, expect } from 'vitest';
import { mergeThreeWay, splitLines, joinLines } from '../threeWayMerge';

const lines = (...l: string[]) => l.join('\n');

describe('splitLines / joinLines', () => {
  it('round-trips a file with a trailing newline', () => {
    const text = 'a\nb\n';
    expect(joinLines(splitLines(text))).toBe(text);
  });

  it('round-trips a file without one', () => {
    const text = 'a\nb';
    expect(joinLines(splitLines(text))).toBe(text);
  });

  it('round-trips the empty file', () => {
    expect(joinLines(splitLines(''))).toBe('');
  });
});

describe('mergeThreeWay', () => {
  it('takes theirs when the target never moved', () => {
    const base = lines('a', 'b', 'c');
    const theirs = lines('a', 'B', 'c');
    expect(mergeThreeWay(base, base, theirs)).toEqual({ status: 'clean', content: theirs });
  });

  it('keeps ours when the pull request changed nothing', () => {
    const base = lines('a', 'b');
    const ours = lines('a', 'b', 'hotfix');
    expect(mergeThreeWay(base, ours, base)).toEqual({ status: 'clean', content: ours });
  });

  it('keeps a hotfix the target has that the pull request never saw', () => {
    // The case that a straight copy destroys: both sides changed the file,
    // but in different places.
    const base = lines('one', 'two', 'three', 'four');
    const ours = lines('one', 'two', 'three', 'HOTFIX');
    const theirs = lines('ONE', 'two', 'three', 'four');

    expect(mergeThreeWay(base, ours, theirs)).toEqual({
      status: 'clean',
      content: lines('ONE', 'two', 'three', 'HOTFIX'),
    });
  });

  it('conflicts when both sides rewrote the same line differently', () => {
    const base = lines('a', 'b', 'c');
    const ours = lines('a', 'OURS', 'c');
    const theirs = lines('a', 'THEIRS', 'c');

    expect(mergeThreeWay(base, ours, theirs)).toEqual({ status: 'conflict', conflicts: 1 });
  });

  it('does not conflict when both sides made the identical edit', () => {
    const base = lines('a', 'b', 'c');
    const same = lines('a', 'SAME', 'c');
    expect(mergeThreeWay(base, same, same)).toEqual({ status: 'clean', content: same });
  });

  it('combines edits at opposite ends of the file', () => {
    const base = lines('1', '2', '3', '4', '5', '6');
    const ours = lines('TOP', '2', '3', '4', '5', '6');
    const theirs = lines('1', '2', '3', '4', '5', 'BOTTOM');

    expect(mergeThreeWay(base, ours, theirs)).toEqual({
      status: 'clean',
      content: lines('TOP', '2', '3', '4', '5', 'BOTTOM'),
    });
  });

  it('merges insertions made by each side in different places', () => {
    const base = lines('a', 'b', 'c');
    const ours = lines('a', 'ours', 'b', 'c');
    const theirs = lines('a', 'b', 'theirs', 'c');

    expect(mergeThreeWay(base, ours, theirs)).toEqual({
      status: 'clean',
      content: lines('a', 'ours', 'b', 'theirs', 'c'),
    });
  });

  it('merges a deletion by one side with an edit by the other', () => {
    const base = lines('a', 'b', 'c', 'd');
    const ours = lines('a', 'c', 'd');
    const theirs = lines('a', 'b', 'c', 'D');

    expect(mergeThreeWay(base, ours, theirs)).toEqual({
      status: 'clean',
      content: lines('a', 'c', 'D'),
    });
  });

  it('conflicts when one side deletes what the other edits', () => {
    const base = lines('a', 'b', 'c');
    const ours = lines('a', 'c');
    const theirs = lines('a', 'B', 'c');

    expect(mergeThreeWay(base, ours, theirs)).toEqual({ status: 'conflict', conflicts: 1 });
  });

  it('counts conflicts separately when they are far apart', () => {
    const base = lines('a', 'b', 'c', 'd', 'e');
    const ours = lines('A1', 'b', 'c', 'd', 'E1');
    const theirs = lines('A2', 'b', 'c', 'd', 'E2');

    expect(mergeThreeWay(base, ours, theirs)).toEqual({ status: 'conflict', conflicts: 2 });
  });

  it('treats an append past the end of the ancestor as mergeable when only one side appends', () => {
    const base = lines('a', 'b');
    const ours = lines('a', 'b');
    const theirs = lines('a', 'b', 'c');
    expect(mergeThreeWay(base, ours, theirs)).toEqual({ status: 'clean', content: theirs });
  });

  it('conflicts when both sides append different things', () => {
    const base = lines('a', 'b');
    const ours = lines('a', 'b', 'ours');
    const theirs = lines('a', 'b', 'theirs');
    expect(mergeThreeWay(base, ours, theirs)).toEqual({ status: 'conflict', conflicts: 1 });
  });

  it('adds a file the target does not have', () => {
    const theirs = lines('new', 'file');
    expect(mergeThreeWay('', '', theirs)).toEqual({ status: 'clean', content: theirs });
  });

  it('conflicts when both branches added the same path differently', () => {
    expect(mergeThreeWay('', lines('ours'), lines('theirs'))).toEqual({
      status: 'conflict',
      conflicts: 1,
    });
  });

  it('preserves a trailing newline difference as a real change', () => {
    expect(mergeThreeWay('a\nb', 'a\nb', 'a\nb\n')).toEqual({
      status: 'clean',
      content: 'a\nb\n',
    });
  });

  it('gives up rather than hanging on a file too large to align', () => {
    const big = Array.from({ length: 2200 }, (_, i) => `line ${i}`).join('\n');
    const ours = `${big}\nours`;
    const theirs = `theirs\n${big}`;
    expect(mergeThreeWay(big, ours, theirs)).toEqual({ status: 'unmergeable' });
  });

  it('is symmetric about which side is called ours', () => {
    const base = lines('a', 'b', 'c', 'd');
    const x = lines('a', 'X', 'c', 'd');
    const y = lines('a', 'b', 'c', 'Y');

    const forward = mergeThreeWay(base, x, y);
    const backward = mergeThreeWay(base, y, x);
    expect(forward).toEqual({ status: 'clean', content: lines('a', 'X', 'c', 'Y') });
    expect(backward).toEqual(forward);
  });
});
