import type { DiffHunk, DiffLine, ParsedDiff } from '../types';

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parse a unified-diff `patch` string (as returned by the GitHub
 * connector for each changed file) into structured hunks with resolved old/new
 * line numbers for both inline and side-by-side rendering.
 */
export function parsePatch(patch: string | undefined | null): ParsedDiff {
  if (!patch) {
    return { hunks: [], isEmpty: true };
  }

  const rawLines = patch.split('\n');
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const raw of rawLines) {
    const headerMatch = HUNK_HEADER.exec(raw);
    if (headerMatch) {
      const oldStart = Number(headerMatch[1]);
      const oldLines = headerMatch[2] ? Number(headerMatch[2]) : 1;
      const newStart = Number(headerMatch[3]);
      const newLines = headerMatch[4] ? Number(headerMatch[4]) : 1;
      current = {
        header: raw,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [
          {
            type: 'hunk',
            content: headerMatch[5]?.trim() ? headerMatch[5].trim() : raw,
          },
        ],
      };
      hunks.push(current);
      oldLineNo = oldStart;
      newLineNo = newStart;
      continue;
    }

    if (!current) {
      // Lines before the first hunk header (e.g. "\ No newline...") are ignored.
      continue;
    }

    // GitHub omits the leading space on a fully-empty context line.
    const marker = raw.length > 0 ? raw[0] : ' ';
    const content = raw.length > 0 ? raw.slice(1) : '';

    let line: DiffLine;
    if (marker === '+') {
      line = { type: 'add', newLineNo, content };
      newLineNo += 1;
    } else if (marker === '-') {
      line = { type: 'del', oldLineNo, content };
      oldLineNo += 1;
    } else if (marker === '\\') {
      // "\ No newline at end of file"
      line = { type: 'meta', content: raw.slice(2) };
    } else {
      line = { type: 'context', oldLineNo, newLineNo, content };
      oldLineNo += 1;
      newLineNo += 1;
    }
    current.lines.push(line);
  }

  return { hunks, isEmpty: hunks.length === 0 };
}

/**
 * Build a full-file ParsedDiff by filling in the gaps between hunks with
 * lines from `fullNewContent` (the file at the head ref). The result has one
 * virtual hunk that covers the entire file, making every line visible with
 * additions/deletions still highlighted.
 */
export function buildFullFileDiff(
  patch: string | undefined | null,
  fullNewContent: string,
  fullOldContent?: string,
): ParsedDiff {
  const patchDiff = parsePatch(patch);
  const newLines = fullNewContent.split('\n');
  const oldLines = fullOldContent?.split('\n');

  if (patchDiff.isEmpty) {
    // No patch — show the entire file as context.
    const lines: DiffLine[] = newLines.map((content, i) => ({
      type: 'context' as const,
      oldLineNo: i + 1,
      newLineNo: i + 1,
      content,
    }));
    return {
      hunks: [{ header: '', oldStart: 1, oldLines: newLines.length, newStart: 1, newLines: newLines.length, lines }],
      isEmpty: false,
    };
  }

  // Build a set of which new-file lines are covered by a hunk (add/context).
  // We'll use the hunks to know what's changed, and fill everything else as context.
  const allDiffLines: DiffLine[] = [];

  // Track current position in the new file (1-based line number).
  let newCursor = 1;
  // Track current position in the old file (1-based line number).
  let oldCursor = 1;

  for (const hunk of patchDiff.hunks) {
    // Fill context lines from newCursor up to hunk.newStart (the gap before this hunk).
    while (newCursor < hunk.newStart) {
      const oldLine = oldCursor;
      const newLine = newCursor;
      const content = newLines[newCursor - 1] ?? '';
      allDiffLines.push({ type: 'context', oldLineNo: oldLine, newLineNo: newLine, content });
      newCursor += 1;
      oldCursor += 1;
    }

    // Now emit the hunk's body lines (skip the hunk header line at index 0).
    for (let i = 1; i < hunk.lines.length; i++) {
      const line = hunk.lines[i];
      if (line.type === 'meta') {
        allDiffLines.push(line);
        continue;
      }
      allDiffLines.push(line);
      if (line.type === 'add' || line.type === 'context') {
        newCursor += 1;
      }
      if (line.type === 'del' || line.type === 'context') {
        oldCursor += 1;
      }
    }
  }

  // Fill remaining lines after the last hunk.
  while (newCursor <= newLines.length) {
    const content = newLines[newCursor - 1] ?? '';
    allDiffLines.push({ type: 'context', oldLineNo: oldCursor, newLineNo: newCursor, content });
    newCursor += 1;
    oldCursor += 1;
  }

  return {
    hunks: [{
      header: '',
      oldStart: 1,
      oldLines: (oldLines?.length ?? oldCursor - 1),
      newStart: 1,
      newLines: newLines.length,
      lines: allDiffLines,
    }],
    isEmpty: false,
  };
}

/** Aligned row for side-by-side rendering. */
export interface SideBySideRow {
  type: 'hunk' | 'pair' | 'meta';
  /** Hunk header text (only for type === 'hunk'). */
  header?: string;
  left?: DiffLine;
  right?: DiffLine;
}

/**
 * Convert parsed hunks into aligned left/right rows for a side-by-side view.
 * Deletions pair with additions where possible; otherwise each occupies its
 * own side with a blank counterpart.
 */
export function toSideBySideRows(diff: ParsedDiff): SideBySideRow[] {
  const rows: SideBySideRow[] = [];

  for (const hunk of diff.hunks) {
    // Only emit a hunk separator if the first line is actually a hunk header.
    let body: DiffLine[];
    if (hunk.lines[0]?.type === 'hunk') {
      rows.push({ type: 'hunk', header: hunk.lines[0].content ?? hunk.header });
      body = hunk.lines.slice(1);
    } else if (hunk.header) {
      rows.push({ type: 'hunk', header: hunk.header });
      body = hunk.lines;
    } else {
      // Full-file mode: no hunk header at all.
      body = hunk.lines;
    }
    let i = 0;
    while (i < body.length) {
      const line = body[i];
      if (line.type === 'context') {
        rows.push({ type: 'pair', left: line, right: line });
        i += 1;
        continue;
      }
      if (line.type === 'meta') {
        rows.push({ type: 'meta', left: line, right: line });
        i += 1;
        continue;
      }
      if (line.type === 'del') {
        // Collect a run of deletions, then a run of additions, and zip them.
        const dels: DiffLine[] = [];
        while (i < body.length && body[i].type === 'del') {
          dels.push(body[i]);
          i += 1;
        }
        const adds: DiffLine[] = [];
        while (i < body.length && body[i].type === 'add') {
          adds.push(body[i]);
          i += 1;
        }
        const max = Math.max(dels.length, adds.length);
        for (let j = 0; j < max; j += 1) {
          rows.push({ type: 'pair', left: dels[j], right: adds[j] });
        }
        continue;
      }
      if (line.type === 'add') {
        rows.push({ type: 'pair', right: line });
        i += 1;
        continue;
      }
      i += 1;
    }
  }

  return rows;
}
