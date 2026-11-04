/**
 * Reading a Markdown diff as prose rather than as source.
 *
 * A `.md` file is the one case where the raw text of a diff is not the thing
 * being reviewed. A table, a link, a nested list — all of them are far easier
 * to judge once they are laid out, which is what the reporter of this asked
 * for: "raw text of an MD file is tough to read".
 *
 * But a rendered document has no lines, and a reviewer still has to see what
 * moved. So rather than rendering the whole file twice and leaving them to spot
 * the difference, the diff is split into **blocks** — the unit a Markdown
 * reader already perceives: a paragraph, a heading, a list item, a fenced code
 * block — and each block carries the change that happened inside it. A block
 * that both gained and lost lines keeps *both* versions, so a rewritten
 * paragraph reads as before-and-after instead of as one ambiguous marker.
 *
 * Every block also keeps the line range it came from, which is what lets the
 * preview and the source view talk about the same thing.
 *
 * Blank lines are treated as separators and nothing else: whether one was added
 * or removed is invisible in a rendered document, so counting it as a change
 * would mark a paragraph edited for a difference the reviewer cannot see.
 *
 * Pure and free of React, so the segmentation is testable on its own.
 */

import type { DiffLine, ParsedDiff } from '../types';
import { languageForPath } from './syntax/languages';

/** What happened to a block between the two sides of the diff. */
export type MarkdownBlockStatus = 'unchanged' | 'added' | 'removed' | 'changed' | 'gap';

export interface MarkdownPreviewBlock {
  /** Stable key for React; blocks are positional, so the index is the identity. */
  key: string;
  status: MarkdownBlockStatus;
  /** Markdown source as it reads after the change. Empty for a pure removal. */
  newText: string;
  /** Markdown source as it read before the change. Empty for a pure addition. */
  oldText: string;
  /** Lines added inside this block. */
  added: number;
  /** Lines removed inside this block. */
  removed: number;
  /** First/last line number on the old side, when the block exists there. */
  oldStart?: number;
  oldEnd?: number;
  /** First/last line number on the new side, when the block exists there. */
  newStart?: number;
  newEnd?: number;
  /** Hunk header text — only ever set on a `gap` block. */
  label?: string;
}

// CommonMark allows up to three leading spaces before a block marker; a fourth
// makes it an indented code block, which must not be split on.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const ATX_HEADING = /^ {0,3}#{1,6}(\s|$)/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

// Deliberately anchored at column zero, unlike the rules above. An indented
// marker is a *nested* item, and nesting is part of its parent's block: split
// there and the child would render as a top-level list of its own.
const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])(\s|$)/;

/** True when a path is Markdown, and so worth offering a rendered preview for. */
export function isMarkdownPath(path: string | null | undefined): boolean {
  return languageForPath(path) === 'markdown';
}

/** The opening run of a fence, e.g. ``` ``` ``` or `~~~~`. */
function fenceMarker(text: string): string | null {
  return FENCE_OPEN.exec(text)?.[1] ?? null;
}

/** A fence closes on the same character, repeated at least as many times. */
function closesFence(text: string, opener: string): boolean {
  const marker = FENCE_CLOSE.exec(text)?.[1];
  return !!marker && marker[0] === opener[0] && marker.length >= opener.length;
}

function join(lines: DiffLine[]): string {
  return lines.map((line) => line.content).join('\n');
}

/** Turn one block's worth of diff lines into a block, or null if it renders nothing. */
function finalize(lines: DiffLine[], index: number): MarkdownPreviewBlock | null {
  const oldLines = lines.filter((l) => l.type === 'context' || l.type === 'del');
  const newLines = lines.filter((l) => l.type === 'context' || l.type === 'add');
  if (oldLines.length === 0 && newLines.length === 0) return null;

  const added = lines.reduce((n, l) => (l.type === 'add' ? n + 1 : n), 0);
  const removed = lines.reduce((n, l) => (l.type === 'del' ? n + 1 : n), 0);

  const status: MarkdownBlockStatus =
    added > 0 && removed > 0
      ? 'changed'
      : added > 0
        ? 'added'
        : removed > 0
          ? 'removed'
          : 'unchanged';

  return {
    key: `b${index}`,
    status,
    // A pure addition has no "before" to show, and a pure removal no "after";
    // handing the caller the surviving side only keeps the render honest.
    oldText: status === 'added' ? '' : join(oldLines),
    newText: status === 'removed' ? '' : join(newLines),
    added,
    removed,
    oldStart: oldLines[0]?.oldLineNo,
    oldEnd: oldLines[oldLines.length - 1]?.oldLineNo,
    newStart: newLines[0]?.newLineNo,
    newEnd: newLines[newLines.length - 1]?.newLineNo,
  };
}

/**
 * Split a parsed Markdown diff into renderable blocks, in document order.
 *
 * Hunk headers become `gap` blocks so a diff-only view still says where content
 * was skipped; in full-file mode there are none and the result is the whole
 * document.
 */
export function buildMarkdownPreview(diff: ParsedDiff): MarkdownPreviewBlock[] {
  const blocks: MarkdownPreviewBlock[] = [];
  let current: DiffLine[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (current.length === 0) return;
    const block = finalize(current, blocks.length);
    if (block) blocks.push(block);
    current = [];
  };

  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'hunk') {
        flush();
        // An unterminated fence cannot span a skipped region: whatever closed
        // it is in the part of the file the patch left out.
        fence = null;
        // A header only marks a *gap* if content was actually skipped. The
        // first hunk of a patch that starts at line 1 skipped nothing, and
        // opening the preview with a "skipped content" rule would be a lie.
        if (blocks.length > 0 || hunk.newStart > 1) {
          blocks.push({
            key: `b${blocks.length}`,
            status: 'gap',
            label: line.content,
            oldText: '',
            newText: '',
            added: 0,
            removed: 0,
          });
        }
        continue;
      }
      // "\ No newline at end of file" is a note about the patch, not content.
      if (line.type === 'meta') continue;

      const text = line.content;

      if (fence) {
        current.push(line);
        if (closesFence(text, fence)) {
          fence = null;
          flush();
        }
        continue;
      }

      if (text.trim() === '') {
        flush();
        continue;
      }

      const opener = fenceMarker(text);
      if (opener) {
        flush();
        fence = opener;
        current.push(line);
        continue;
      }

      if (ATX_HEADING.test(text)) {
        flush();
        current.push(line);
        flush();
        continue;
      }

      if (THEMATIC_BREAK.test(text)) {
        // A run of dashes under a paragraph is a Setext heading underline, not
        // a rule — it belongs to the text above it, and splitting would render
        // the title as a paragraph followed by a stray horizontal line.
        if (current.length > 0 && text.trimStart().startsWith('-')) {
          current.push(line);
          flush();
          continue;
        }
        flush();
        current.push(line);
        flush();
        continue;
      }

      if (LIST_ITEM.test(text)) {
        flush();
        current.push(line);
        continue;
      }

      current.push(line);
    }
  }

  flush();
  return blocks;
}

/** `12` for a one-line block, `12–18` for a range, `''` when the side is absent. */
export function previewRangeLabel(start?: number, end?: number): string {
  if (start == null) return '';
  if (end == null || end === start) return String(start);
  return `${start}\u2013${end}`;
}

const STATUS_WORDS: Record<MarkdownBlockStatus, string> = {
  unchanged: 'Unchanged',
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  gap: 'Skipped',
};

/** Human name for a block's status, used as its accessible label. */
export function markdownBlockStatusLabel(status: MarkdownBlockStatus): string {
  return STATUS_WORDS[status];
}
