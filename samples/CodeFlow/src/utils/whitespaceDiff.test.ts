import { describe, it, expect } from 'vitest';
import { parsePatch } from './diffParser';
import { filterDiffToSide } from './diffSide';
import {
  normalizeWhitespace,
  isWhitespaceOnlyChange,
  collapseWhitespaceOnlyChanges,
} from './whitespaceDiff';
import type { ParsedDiff } from '../types';

/** Build a patch body from raw lines, keeping the leading markers verbatim. */
function patch(...lines: string[]): string {
  return lines.join('\n');
}

const visible = (diff: ParsedDiff) =>
  diff.hunks.flatMap((h) => h.lines).filter((l) => l.type === 'add' || l.type === 'del');

describe('normalizeWhitespace', () => {
  it('strips a trailing carriage return', () => {
    expect(normalizeWhitespace('FROM node:18\r')).toBe('FROM node:18');
  });

  it('strips indentation', () => {
    expect(normalizeWhitespace('    const x = 1;')).toBe('const x = 1;');
    expect(normalizeWhitespace('\t\tconst x = 1;')).toBe('const x = 1;');
  });

  it('strips trailing spaces and tabs', () => {
    expect(normalizeWhitespace('let y = 2;   \t')).toBe('let y = 2;');
  });

  it('collapses runs of whitespace between tokens', () => {
    expect(normalizeWhitespace('const   x    =  1;')).toBe('const x = 1;');
  });

  it('treats tabs and spaces as equivalent separators', () => {
    expect(normalizeWhitespace('a\tb')).toBe(normalizeWhitespace('a b'));
  });

  it('does not remove whitespace entirely, so distinct tokens stay distinct', () => {
    // This is the line between --ignore-space-change and --ignore-all-space.
    // `-w` would call these equal and hide a genuine edit.
    expect(normalizeWhitespace('foo bar')).not.toBe(normalizeWhitespace('foobar'));
  });
});

describe('isWhitespaceOnlyChange', () => {
  it('is false when the lines are byte-identical', () => {
    expect(isWhitespaceOnlyChange('same', 'same')).toBe(false);
  });

  it('is true for a line-ending flip', () => {
    expect(isWhitespaceOnlyChange('FROM node:18', 'FROM node:18\r')).toBe(true);
  });

  it('is false when the content genuinely differs', () => {
    expect(isWhitespaceOnlyChange('NODE=24.15.0', 'NODE=24.19.0')).toBe(false);
  });
});

describe('collapseWhitespaceOnlyChanges', () => {
  it('folds a whole-file line-ending rewrite back into context', () => {
    // The reported case: every line deleted and re-added, differing only by \r.
    const original = ['FROM node:18', 'WORKDIR /app', 'RUN npm ci'];
    const diff = parsePatch(
      patch(
        '@@ -1,3 +1,3 @@',
        ...original.map((l) => `-${l}`),
        ...original.map((l) => `+${l}\r`),
      ),
    );

    const result = collapseWhitespaceOnlyChanges(diff);

    expect(result.collapsed).toBe(3);
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(visible(result.diff)).toHaveLength(0);
  });

  it('keeps the real edit visible when it is buried in a line-ending rewrite', () => {
    const before = ['FROM node:18', 'ENV NODE_VERSION=24.15.0', 'RUN npm ci'];
    const after = ['FROM node:18\r', 'ENV NODE_VERSION=24.19.0\r', 'RUN npm ci\r'];
    const diff = parsePatch(
      patch('@@ -1,3 +1,3 @@', ...before.map((l) => `-${l}`), ...after.map((l) => `+${l}`)),
    );

    const result = collapseWhitespaceOnlyChanges(diff);

    expect(result.collapsed).toBe(2);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(visible(result.diff).map((l) => `${l.type}:${l.content.trim()}`)).toEqual([
      'del:ENV NODE_VERSION=24.15.0',
      'add:ENV NODE_VERSION=24.19.0',
    ]);
  });

  it('reports the pre-collapse counts so the true size stays discoverable', () => {
    const diff = parsePatch(patch('@@ -1,2 +1,2 @@', '-a', '-b', '+a\r', '+b\r'));

    const result = collapseWhitespaceOnlyChanges(diff);

    expect(result.rawAdditions).toBe(2);
    expect(result.rawDeletions).toBe(2);
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  it('collapses a re-indentation', () => {
    const diff = parsePatch(patch('@@ -1,1 +1,1 @@', '-  return x;', '+    return x;'));
    expect(collapseWhitespaceOnlyChanges(diff).collapsed).toBe(1);
  });

  it('collapses trailing whitespace being removed', () => {
    const diff = parsePatch(patch('@@ -1,1 +1,1 @@', '-let y = 2;   ', '+let y = 2;'));
    expect(collapseWhitespaceOnlyChanges(diff).collapsed).toBe(1);
  });

  it('collapses tabs converted to spaces', () => {
    const diff = parsePatch(patch('@@ -1,1 +1,1 @@', '-\tif (a) {', '+    if (a) {'));
    expect(collapseWhitespaceOnlyChanges(diff).collapsed).toBe(1);
  });

  it('leaves a real content change alone', () => {
    const diff = parsePatch(patch('@@ -1,1 +1,1 @@', '-const a = 1;', '+const a = 2;'));

    const result = collapseWhitespaceOnlyChanges(diff);

    expect(result.collapsed).toBe(0);
    expect(result.diff).toBe(diff);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });

  it('does not treat removing a space between tokens as whitespace-only', () => {
    // `-w` would hide this. It is a real change to a string literal.
    const diff = parsePatch(patch('@@ -1,1 +1,1 @@', '-msg = "foo bar"', '+msg = "foobar"'));
    expect(collapseWhitespaceOnlyChanges(diff).collapsed).toBe(0);
  });

  it('preserves both line numbers on a collapsed line, so comments still anchor', () => {
    const diff = parsePatch(
      patch('@@ -10,2 +10,2 @@', ' context', '-value', '+value\r'),
    );

    const result = collapseWhitespaceOnlyChanges(diff);
    const collapsedLine = result.diff.hunks[0].lines.find((l) => l.content.startsWith('value'));

    expect(collapsedLine?.type).toBe('context');
    expect(collapsedLine?.oldLineNo).toBe(11);
    expect(collapsedLine?.newLineNo).toBe(11);
  });

  it('keeps the new side content, since that is what the file holds now', () => {
    const diff = parsePatch(patch('@@ -1,1 +1,1 @@', '-  spaced', '+\tspaced'));

    const line = collapseWhitespaceOnlyChanges(diff).diff.hunks[0].lines[1];

    expect(line.type).toBe('context');
    expect(line.content).toBe('\tspaced');
  });

  it('keeps an unpaired deletion when more lines were removed than added', () => {
    const diff = parsePatch(patch('@@ -1,3 +1,1 @@', '-a', '-b', '-c', '+a\r'));

    const result = collapseWhitespaceOnlyChanges(diff);

    expect(result.collapsed).toBe(1);
    expect(visible(result.diff).map((l) => `${l.type}:${l.content}`)).toEqual(['del:b', 'del:c']);
  });

  it('keeps an unpaired addition when more lines were added than removed', () => {
    const diff = parsePatch(patch('@@ -1,1 +1,3 @@', '-a', '+a\r', '+b', '+c'));

    const result = collapseWhitespaceOnlyChanges(diff);

    expect(result.collapsed).toBe(1);
    expect(visible(result.diff).map((l) => `${l.type}:${l.content}`)).toEqual(['add:b', 'add:c']);
  });

  it('keeps real changes in diff order around a collapsed line', () => {
    const diff = parsePatch(
      patch('@@ -1,2 +1,2 @@', '-one', '-two', '+ONE', '+two\r'),
    );

    const result = collapseWhitespaceOnlyChanges(diff);

    expect(
      result.diff.hunks[0].lines
        .filter((l) => l.type !== 'hunk')
        .map((l) => `${l.type}:${l.content.trim()}`),
    ).toEqual(['del:one', 'add:ONE', 'context:two']);
  });

  it('leaves context and hunk headers untouched', () => {
    const diff = parsePatch(patch('@@ -1,3 +1,3 @@', ' keep me', '-a', '+a\r', ' and me'));

    const lines = collapseWhitespaceOnlyChanges(diff)
      .diff.hunks[0].lines.filter((l) => l.type !== 'hunk');

    expect(lines.map((l) => l.content)).toEqual(['keep me', 'a\r', 'and me']);
    expect(lines.every((l) => l.type === 'context')).toBe(true);
  });

  it('returns the input untouched when there is no patch at all', () => {
    const diff = parsePatch(undefined);

    const result = collapseWhitespaceOnlyChanges(diff);

    expect(result.diff).toBe(diff);
    expect(result.collapsed).toBe(0);
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  it('handles several hunks independently', () => {
    const diff = parsePatch(
      patch(
        '@@ -1,1 +1,1 @@',
        '-a',
        '+a\r',
        '@@ -20,1 +20,1 @@',
        '-real',
        '+really',
      ),
    );

    const result = collapseWhitespaceOnlyChanges(diff);

    expect(result.collapsed).toBe(1);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });
});

describe('composed with the diff-side filter', () => {
  // The two transforms do not commute. Collapsing needs to see a deletion and
  // its replacement together; the side filter exists to throw one of them away.
  // These tests pin the order rather than trusting a comment to survive a merge.

  // Whitespace-only churn on both sides, with one real edit buried in it.
  const rewritten = () =>
    parsePatch(
      patch(
        '@@ -1,4 +1,4 @@',
        '-FROM node:18',
        '-  RUN a',
        '-ENV V=1',
        '-CMD run',
        '+FROM node:18\r',
        '+\tRUN a\r',
        '+ENV V=2\r',
        '+CMD run\r',
      ),
    );

  const contents = (diff: ParsedDiff) =>
    diff.hunks.flatMap((h) => h.lines).filter((l) => l.type !== 'hunk').map((l) => l.content);

  it('collapse-then-filter leaves only the real change on each side', () => {
    const collapsed = collapseWhitespaceOnlyChanges(rewritten());
    expect(collapsed.collapsed).toBe(3);

    for (const mode of ['left', 'right'] as const) {
      const view = filterDiffToSide(collapsed.diff, mode);
      const changed = visible(view);
      expect(changed).toHaveLength(1);
      expect(normalizeWhitespace(changed[0].content)).toBe(mode === 'left' ? 'ENV V=1' : 'ENV V=2');
    }
  });

  it('keeps every line of the file visible on a one-sided view', () => {
    const collapsed = collapseWhitespaceOnlyChanges(rewritten());
    // Three collapsed lines plus the one real line, whichever side you read.
    expect(contents(filterDiffToSide(collapsed.diff, 'left'))).toHaveLength(4);
    expect(contents(filterDiffToSide(collapsed.diff, 'right'))).toHaveLength(4);
  });

  it('reads the same on one side as that side of the two-sided view', () => {
    const collapsed = collapseWhitespaceOnlyChanges(rewritten()).diff;
    const both = collapsed.hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.type === 'context' || l.type === 'add')
      .map((l) => l.content);
    expect(contents(filterDiffToSide(collapsed, 'right'))).toEqual(both);
  });

  it('filtering first would defeat the collapse entirely', () => {
    // The failure mode is silent, so prove it happens rather than assuming.
    for (const mode of ['left', 'right'] as const) {
      const filteredFirst = collapseWhitespaceOnlyChanges(filterDiffToSide(rewritten(), mode));
      expect(filteredFirst.collapsed).toBe(0);
      expect(visible(filteredFirst.diff)).toHaveLength(4);
    }
  });

  it('is unaffected in both-sides mode', () => {
    const collapsed = collapseWhitespaceOnlyChanges(rewritten()).diff;
    expect(filterDiffToSide(collapsed, 'both')).toBe(collapsed);
  });
});