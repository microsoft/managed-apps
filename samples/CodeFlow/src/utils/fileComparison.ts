import type { DiffLine, ParsedDiff } from '../types';
import { alignLines } from './lineAlignment';

export const MAX_COMPARE_CHARACTERS = 2_000_000;
export const MAX_COMPARE_LINES = 10_000;

export interface FileComparison {
  diff: ParsedDiff;
  additions: number;
  deletions: number;
}

/** Compare actual file contents, not the unrelated patches against their PR base. */
export function compareFileContents(left: string, right: string): FileComparison {
  if (left.length + right.length > MAX_COMPARE_CHARACTERS) {
    throw new Error('These files are too large to compare in the browser (2,000,000 characters combined).');
  }
  if (left.includes('\0') || right.includes('\0')) {
    throw new Error('Binary files cannot be compared as text.');
  }
  let lineCount = 0;
  for (const text of [left, right]) {
    if (text && !text.endsWith('\n')) lineCount++;
    for (const character of text) {
      if (character === '\n') lineCount++;
      if (lineCount > MAX_COMPARE_LINES) {
        throw new Error('These files are too large to display (10,000 lines combined).');
      }
    }
  }
  // Preserve the final newline as part of each token, but treat CRLF and LF alike.
  const tokenize = (text: string) => text.replace(/\r\n/g, '\n').match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const a = tokenize(left);
  const b = tokenize(right);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix
    && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;

  const aEnd = a.length - suffix;
  const bEnd = b.length - suffix;
  const alignment = alignLines(a.slice(prefix, aEnd), b.slice(prefix, bEnd));
  if (!alignment) {
    throw new Error('These files have too many differing lines to compare safely in the browser.');
  }

  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  const emit = (type: 'context' | 'add' | 'del', oldIndex: number, newIndex: number) => {
    const token = type === 'add' ? b[newIndex] : a[oldIndex];
    lines.push({
      type,
      content: token.endsWith('\n') ? token.slice(0, -1) : token,
      ...(type !== 'add' ? { oldLineNo: oldIndex + 1 } : {}),
      ...(type !== 'del' ? { newLineNo: newIndex + 1 } : {}),
    });
    if (type === 'add') additions++;
    if (type === 'del') deletions++;
  };
  for (let i = 0; i < prefix; i++) emit('context', i, i);
  let ai = prefix;
  let bi = prefix;
  for (let i = prefix; i < aEnd; i++) {
    if (!alignment.matched[i - prefix]) continue;
    const j = prefix + alignment.pos[i - prefix];
    while (ai < i) emit('del', ai++, bi);
    while (bi < j) emit('add', ai, bi++);
    emit('context', ai++, bi++);
  }
  while (ai < aEnd) emit('del', ai++, bi);
  while (bi < bEnd) emit('add', ai, bi++);
  for (let i = 0; i < suffix; i++) emit('context', ai++, bi++);
  if (a.length && !a.at(-1)!.endsWith('\n')) {
    lines.push({ type: 'meta', content: 'Left file has no newline at end of file.' });
  }
  if (b.length && !b.at(-1)!.endsWith('\n')) {
    lines.push({ type: 'meta', content: 'Right file has no newline at end of file.' });
  }

  return {
    diff: {
      hunks: lines.length ? [{
        header: '', oldStart: 1, oldLines: a.length, newStart: 1, newLines: b.length, lines,
      }] : [],
      isEmpty: lines.length === 0,
    },
    additions,
    deletions,
  };
}
