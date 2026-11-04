/**
 * Reassembles the two source files a diff is a difference *between*, so a
 * tokenizer has something contiguous to read.
 *
 * A diff is not a document. Interleaved `-` and `+` lines are two different
 * files spliced together, and handing that splice to a grammar produces
 * nonsense: an opening brace on a deleted line closes on the added line that
 * replaced it, a deleted `/*` swallows the rest of the file. Anything wider than
 * a single line — block comments, template literals, multi-line strings, JSX —
 * needs the lines around it to be lines that were genuinely adjacent.
 *
 * So the visible diff is walked once and split back into its two sides. Deleted
 * and context lines rebuild the old file; added and context lines rebuild the
 * new one. Each rendered cell records which document it came from and its index
 * in it, which is all the renderer needs to look its tokens up again.
 *
 * ## What this cannot fix
 *
 * In diff-only mode the hunks are joined with nothing between them, because a
 * skipped region has no lines to contribute. A construct that opens inside a
 * skipped region and closes after it will still be misread. Full-file mode has
 * no gaps and is exact, which is the mode that matters — it is the one people
 * read long files in. The alternative, tokenizing each hunk in isolation, is
 * strictly worse: it breaks constructs that *are* fully visible.
 *
 * The walk deliberately mirrors `buildSearchCells`, cell for cell, because the
 * two produce keys into the same rendered rows. If they ever disagree about
 * which cells exist, highlights land on the wrong lines.
 */

import type { ParsedDiff, DiffLineType } from '../../types';
import type { ViewMode } from '../../state/codeFlowContext';
import { toSideBySideRows } from '../diffParser';
import type { DiffSideMode } from '../diffSide';
import { cellKeyOf, type SearchColumn } from '../../components/DiffViewer/diffSearchModel';

/** Which reconstructed file a line belongs to. */
export type DocSide = 'old' | 'new';

/** Where a rendered cell's text lives in the reconstructed documents. */
export interface CellLocation {
  side: DocSide;
  /** 0-based index into that side's line array. */
  line: number;
}

export interface SideDocuments {
  /** Deleted + context lines, in order: the file as it was. */
  old: string;
  /** Added + context lines, in order: the file as it will be. */
  new: string;
  /** `cellKeyOf(column, rowKey)` → where to find that cell's tokens. */
  cells: Map<string, CellLocation>;
  /** Total lines across both documents; controls eager versus deferred rendering. */
  lineCount: number;
}

const EMPTY: SideDocuments = { old: '', new: '', cells: new Map(), lineCount: 0 };

function isCodeLine(type: DiffLineType): boolean {
  return type === 'add' || type === 'del' || type === 'context';
}

/**
 * Carriage returns would otherwise become part of the last token on every line
 * of a CRLF file, shifting columns by one against the text the renderer draws.
 */
function clean(content: string): string {
  return content.endsWith('\r') ? content.slice(0, -1) : content;
}

class Builder {
  private readonly oldLines: string[] = [];
  private readonly newLines: string[] = [];
  readonly cells = new Map<string, CellLocation>();

  /** Append to one side, optionally pointing a cell at the line just added. */
  push(side: DocSide, content: string, cell?: { column: SearchColumn; rowKey: string }): void {
    const lines = side === 'old' ? this.oldLines : this.newLines;
    const line = lines.length;
    lines.push(clean(content));
    if (cell) this.cells.set(cellKeyOf(cell.column, cell.rowKey), { side, line });
  }

  finish(): SideDocuments {
    return {
      old: this.oldLines.join('\n'),
      new: this.newLines.join('\n'),
      cells: this.cells,
      lineCount: this.oldLines.length + this.newLines.length,
    };
  }
}

function buildSplit(diff: ParsedDiff, sideMode: DiffSideMode): SideDocuments {
  const builder = new Builder();
  toSideBySideRows(diff).forEach((row, ri) => {
    if (row.type !== 'pair') return;
    const rowKey = String(ri);
    // A hidden side still contributes its lines to its own document — dropping
    // them would break the constructs that the *visible* side depends on.
    if (row.left && isCodeLine(row.left.type)) {
      const visible = sideMode !== 'right';
      builder.push('old', row.left.content, visible ? { column: 'left', rowKey } : undefined);
    }
    if (row.right && isCodeLine(row.right.type)) {
      const visible = sideMode !== 'left';
      builder.push('new', row.right.content, visible ? { column: 'right', rowKey } : undefined);
    }
  });
  return builder.finish();
}

function buildInline(diff: ParsedDiff): SideDocuments {
  const builder = new Builder();
  diff.hunks.forEach((hunk, hi) => {
    hunk.lines.forEach((line, li) => {
      if (!isCodeLine(line.type)) return;
      const cell = { column: 'inline' as const, rowKey: `${hi}-${li}` };
      if (line.type === 'del') {
        builder.push('old', line.content, cell);
        return;
      }
      if (line.type === 'add') {
        builder.push('new', line.content, cell);
        return;
      }
      // Context exists in both files and must appear in both documents to keep
      // each side's grammar state honest, but it renders once. The new side is
      // where the cell points, arbitrarily but consistently.
      builder.push('old', line.content);
      builder.push('new', line.content, cell);
    });
  });
  return builder.finish();
}

/**
 * Rebuild the old and new files from the diff currently on screen.
 *
 * `diff` must be the post-collapse, post-side-filter diff the renderers are
 * given, not the raw patch — the documents have to describe what is actually
 * being displayed or the cell map will point at lines nobody can see.
 */
export function buildSideDocuments(
  diff: ParsedDiff,
  viewMode: ViewMode,
  sideMode: DiffSideMode = 'both',
): SideDocuments {
  if (diff.isEmpty || diff.hunks.length === 0) return EMPTY;
  return viewMode === 'split' ? buildSplit(diff, sideMode) : buildInline(diff);
}
