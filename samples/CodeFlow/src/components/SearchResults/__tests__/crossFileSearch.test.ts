import { describe, it, expect } from 'vitest';
import type { FileChange } from '../../../types';
import {
  DEFAULT_CROSS_FILE_LINE_CAP,
  resultsLabel,
  searchAcrossFiles,
} from '../crossFileSearch';

const OPTS = { caseSensitive: false, wholeWord: false, regex: false };

function file(filename: string, patch: string | undefined): FileChange {
  return { filename, status: 'modified', additions: 0, deletions: 0, changes: 0, patch };
}

/** A patch whose lines are easy to address: old 1..3, new 1..3. */
const ALPHA = [
  '@@ -1,3 +1,3 @@',
  ' const alpha = 1;',
  '-const beta = needle();',
  '+const beta = NEEDLE();',
  ' const gamma = 3;',
].join('\n');

const BETA = [
  '@@ -10,2 +10,3 @@',
  ' untouched',
  '+another needle here',
].join('\n');

describe('searchAcrossFiles', () => {
  it('is inactive with an empty query', () => {
    const r = searchAcrossFiles([file('a.ts', ALPHA)], '', OPTS);

    expect(r.active).toBe(false);
    expect(r.files).toEqual([]);
    expect(r.lines).toBe(0);
  });

  it('finds matches in every file, grouped and in patch order', () => {
    const r = searchAcrossFiles([file('a.ts', ALPHA), file('b.ts', BETA)], 'needle', OPTS);

    expect(r.files.map((f) => f.filename)).toEqual(['a.ts', 'b.ts']);
    expect(r.lines).toBe(3);
    expect(r.matches).toBe(3);
    expect(r.capped).toBe(false);
    expect(r.error).toBeNull();
  });

  it('addresses a deletion to the left side and an addition to the right', () => {
    const r = searchAcrossFiles([file('a.ts', ALPHA)], 'needle', OPTS);
    const [del, add] = r.files[0].hits;

    expect(del).toMatchObject({ side: 'left', line: 2, kind: 'del' });
    expect(add).toMatchObject({ side: 'right', line: 2, kind: 'add' });
  });

  it('addresses a context line to the right side', () => {
    const r = searchAcrossFiles([file('a.ts', ALPHA)], 'gamma', OPTS);

    expect(r.files[0].hits[0]).toMatchObject({ side: 'right', line: 3, kind: 'context' });
  });

  it('gives every hit a distinct id', () => {
    const r = searchAcrossFiles([file('a.ts', ALPHA), file('b.ts', BETA)], 'needle', OPTS);
    const ids = r.files.flatMap((f) => f.hits.map((h) => h.id));

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns every match range within a line', () => {
    const patch = ['@@ -1,1 +1,1 @@', '+x needle y needle z'].join('\n');

    const r = searchAcrossFiles([file('a.ts', patch)], 'needle', OPTS);

    expect(r.lines).toBe(1);
    expect(r.matches).toBe(2);
    expect(r.files[0].hits[0].ranges).toHaveLength(2);
    expect(r.files[0].matches).toBe(2);
  });

  it('never matches a hunk header', () => {
    const r = searchAcrossFiles([file('a.ts', ALPHA)], '@@', OPTS);

    expect(r.files).toEqual([]);
    expect(r.active).toBe(true);
  });

  it('skips files with no patch, and files that match nothing', () => {
    const r = searchAcrossFiles(
      [file('binary.png', undefined), file('a.ts', ALPHA), file('b.ts', BETA)],
      'gamma',
      OPTS,
    );

    expect(r.files.map((f) => f.filename)).toEqual(['a.ts']);
  });

  it('tolerates an absent file list', () => {
    expect(searchAcrossFiles(undefined, 'needle', OPTS).files).toEqual([]);
  });

  it('honours match case', () => {
    const sensitive = searchAcrossFiles([file('a.ts', ALPHA)], 'NEEDLE', {
      ...OPTS,
      caseSensitive: true,
    });

    expect(sensitive.lines).toBe(1);
    expect(sensitive.files[0].hits[0].kind).toBe('add');
  });

  it('honours whole word', () => {
    const patch = ['@@ -1,1 +1,1 @@', '+needles and a needle'].join('\n');

    const loose = searchAcrossFiles([file('a.ts', patch)], 'needle', OPTS);
    const strict = searchAcrossFiles([file('a.ts', patch)], 'needle', { ...OPTS, wholeWord: true });

    expect(loose.matches).toBe(2);
    expect(strict.matches).toBe(1);
  });

  it('honours regex, and reports an invalid one instead of throwing', () => {
    const ok = searchAcrossFiles([file('a.ts', ALPHA)], 'be(ta|ep)', { ...OPTS, regex: true });
    expect(ok.lines).toBe(2);

    const bad = searchAcrossFiles([file('a.ts', ALPHA)], '(unclosed', { ...OPTS, regex: true });
    expect(bad.error).toBeTruthy();
    expect(bad.active).toBe(true);
    expect(bad.files).toEqual([]);
  });

  it('caps the number of matching lines and says so', () => {
    const lines = ['@@ -1,200 +1,200 @@'];
    for (let i = 0; i < 200; i += 1) lines.push('+needle');

    const r = searchAcrossFiles([file('a.ts', lines.join('\n'))], 'needle', OPTS, 5);

    expect(r.lines).toBe(5);
    expect(r.capped).toBe(true);
    expect(r.files[0].hits).toHaveLength(5);
  });

  it('stops looking at later files once capped', () => {
    const lines = ['@@ -1,10 +1,10 @@'];
    for (let i = 0; i < 10; i += 1) lines.push('+needle');

    const r = searchAcrossFiles(
      [file('a.ts', lines.join('\n')), file('b.ts', BETA)],
      'needle',
      OPTS,
      3,
    );

    expect(r.files.map((f) => f.filename)).toEqual(['a.ts']);
    expect(r.capped).toBe(true);
  });

  it('has a default cap', () => {
    expect(DEFAULT_CROSS_FILE_LINE_CAP).toBeGreaterThan(0);
  });
});

describe('resultsLabel', () => {
  const base = { files: [], lines: 0, matches: 0, capped: false, error: null, active: false };

  it('says nothing when nothing was searched for', () => {
    expect(resultsLabel(base)).toBe('');
  });

  it('names an invalid regex', () => {
    expect(resultsLabel({ ...base, active: true, error: 'bad' })).toBe('Invalid regex');
  });

  it('says so when there are no results', () => {
    expect(resultsLabel({ ...base, active: true })).toBe('No results');
  });

  it('counts matches, lines and files, in the singular where it should', () => {
    const one = searchAcrossFiles([file('a.ts', BETA)], 'needle', OPTS);

    expect(resultsLabel(one)).toBe('1 in 1 line, 1 file');
  });

  it('pluralises, and marks a truncated count', () => {
    const many = searchAcrossFiles([file('a.ts', ALPHA), file('b.ts', BETA)], 'needle', OPTS);
    expect(resultsLabel(many)).toBe('3 in 3 lines, 2 files');

    expect(resultsLabel({ ...many, capped: true })).toBe('3+ in 3+ lines, 2+ files');
  });
});
