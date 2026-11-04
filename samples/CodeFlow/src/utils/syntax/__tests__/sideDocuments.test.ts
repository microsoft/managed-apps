import { describe, it, expect } from 'vitest';
import { buildSideDocuments } from '../sideDocuments';
import { buildSearchCells, cellKeyOf } from '../../../components/DiffViewer/diffSearchModel';
import type { ParsedDiff, DiffLineType } from '../../../types';

type Line = { type: Exclude<DiffLineType, 'hunk' | 'meta'>; content: string };

/** One hunk, with the header line the parser always puts at index 0. */
function makeDiff(lines: Line[]): ParsedDiff {
  return {
    isEmpty: false,
    hunks: [
      {
        header: '@@ -1,3 +1,3 @@',
        oldStart: 1,
        oldLines: lines.length,
        newStart: 1,
        newLines: lines.length,
        lines: [
          { type: 'hunk', content: '@@ -1,3 +1,3 @@' },
          ...lines.map((l, i) => ({
            type: l.type,
            content: l.content,
            ...(l.type === 'del' ? { oldLineNo: i + 1 } : {}),
            ...(l.type === 'add' ? { newLineNo: i + 1 } : {}),
            ...(l.type === 'context' ? { oldLineNo: i + 1, newLineNo: i + 1 } : {}),
          })),
        ],
      },
    ],
  };
}

/** The text `buildSideDocuments` says a given cell's tokens were computed from. */
function lineFor(docs: ReturnType<typeof buildSideDocuments>, key: string): string | undefined {
  const at = docs.cells.get(key);
  if (!at) return undefined;
  return (at.side === 'old' ? docs.old : docs.new).split('\n')[at.line];
}

describe('buildSideDocuments', () => {
  it('returns nothing for an empty diff', () => {
    const docs = buildSideDocuments({ hunks: [], isEmpty: true }, 'inline');
    expect(docs.lineCount).toBe(0);
    expect(docs.cells.size).toBe(0);
  });

  it('returns nothing when a non-empty diff has no hunks', () => {
    expect(buildSideDocuments({ hunks: [], isEmpty: false }, 'split').lineCount).toBe(0);
  });

  describe('inline mode', () => {
    it('unsplices the two files rather than tokenizing the diff as written', () => {
      // On screen this reads `a / -old / +new / b`, which is not a valid file.
      const diff = makeDiff([
        { type: 'context', content: 'a' },
        { type: 'del', content: 'old' },
        { type: 'add', content: 'new' },
        { type: 'context', content: 'b' },
      ]);
      const docs = buildSideDocuments(diff, 'inline');
      expect(docs.old).toBe('a\nold\nb');
      expect(docs.new).toBe('a\nnew\nb');
    });

    it('puts context in both documents but points its cell at the new side', () => {
      const diff = makeDiff([
        { type: 'context', content: 'a' },
        { type: 'del', content: 'old' },
      ]);
      const docs = buildSideDocuments(diff, 'inline');
      // Counted twice — once per document — even though it renders once.
      expect(docs.lineCount).toBe(3);
      expect(docs.cells.get(cellKeyOf('inline', '0-1'))).toEqual({ side: 'new', line: 0 });
      expect(docs.cells.get(cellKeyOf('inline', '0-2'))).toEqual({ side: 'old', line: 1 });
    });

    it('skips hunk headers and meta lines', () => {
      const diff = makeDiff([{ type: 'add', content: 'x' }]);
      const docs = buildSideDocuments(diff, 'inline');
      // Index 0 is the header the parser prepends; only 0-1 is a code cell.
      expect(docs.cells.has(cellKeyOf('inline', '0-0'))).toBe(false);
      expect(docs.cells.has(cellKeyOf('inline', '0-1'))).toBe(true);
    });
  });

  describe('split mode', () => {
    it('sends each column to its own document', () => {
      const diff = makeDiff([
        { type: 'context', content: 'a' },
        { type: 'del', content: 'old' },
        { type: 'add', content: 'new' },
      ]);
      const docs = buildSideDocuments(diff, 'split');
      expect(docs.old.split('\n')).toEqual(['a', 'old']);
      expect(docs.new.split('\n')).toEqual(['a', 'new']);
    });

    it('keeps a hidden side in its document but gives it no cell', () => {
      // The hidden lines still matter: they are what makes the visible side's
      // multi-line constructs parse.
      const diff = makeDiff([
        { type: 'del', content: 'old' },
        { type: 'add', content: 'new' },
      ]);
      const docs = buildSideDocuments(diff, 'split', 'right');
      expect(docs.old).toContain('old');
      expect([...docs.cells.keys()].every((k) => k.startsWith('right:'))).toBe(true);
    });

    it('drops the right column when only the left side is shown', () => {
      const diff = makeDiff([{ type: 'add', content: 'new' }]);
      const docs = buildSideDocuments(diff, 'split', 'left');
      expect(docs.new).toContain('new');
      expect(docs.cells.size).toBe(0);
    });
  });

  it('strips carriage returns so columns line up on CRLF files', () => {
    const diff = makeDiff([{ type: 'add', content: 'let x = 1;\r' }]);
    const docs = buildSideDocuments(diff, 'inline');
    expect(docs.new).toBe('let x = 1;');
  });

  it('agrees with buildSearchCells about which cells exist', () => {
    // These two walks produce keys into the same rendered rows. If they ever
    // disagree, syntax colour lands on the wrong lines.
    const diff = makeDiff([
      { type: 'context', content: 'a' },
      { type: 'del', content: 'old one' },
      { type: 'del', content: 'old two' },
      { type: 'add', content: 'new one' },
      { type: 'context', content: 'b' },
    ]);

    for (const viewMode of ['inline', 'split'] as const) {
      const docs = buildSideDocuments(diff, viewMode);
      const searched = buildSearchCells(diff, viewMode);
      expect(docs.cells.size).toBe(searched.length);
      for (const cell of searched) {
        const key = cellKeyOf(cell.column, cell.rowKey);
        expect(lineFor(docs, key)).toBe(cell.text);
      }
    }
  });
});
