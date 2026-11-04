import type { DiffLine, DiffSide } from '../../types';

/** Anchor point for a comment on a diff line. */
export interface Anchor {
  side: DiffSide;
  line: number;
  startLine?: number;
}

export function anchorKey(side: DiffSide, line: number): string {
  return `${side}:${line}`;
}

/** Resolve the comment anchor for a diff line (new-file side preferred). */
export function lineAnchor(line: DiffLine, side?: DiffSide): Anchor | null {
  if (side === 'left') {
    return (line.type === 'del' || line.type === 'context') && line.oldLineNo != null
      ? { side, line: line.oldLineNo } : null;
  }
  if (side === 'right') {
    return (line.type === 'add' || line.type === 'context') && line.newLineNo != null
      ? { side, line: line.newLineNo } : null;
  }
  if (line.type === 'add' && line.newLineNo != null) return { side: 'right', line: line.newLineNo };
  if (line.type === 'del' && line.oldLineNo != null) return { side: 'left', line: line.oldLineNo };
  if (line.type === 'context' && line.newLineNo != null) return { side: 'right', line: line.newLineNo };
  return null;
}

export function inCommentRange(anchor: Anchor | null, range?: Anchor | null): boolean {
  return !!anchor && !!range && anchor.side === range.side
    && anchor.line >= (range.startLine ?? range.line) && anchor.line <= range.line;
}

/** Escape a value for safe use inside a CSS attribute selector. */
export function cssEscape(value: string): string {
  const g = globalThis as { CSS?: { escape?(v: string): string } };
  if (g.CSS && typeof g.CSS.escape === 'function') return g.CSS.escape(value);
  // Minimal fallback: escape characters that break attribute selectors.
  return value.replace(/["\\\]]/g, '\\$&');
}

/**
 * Find the diff row tagged with `data-diff-row={rowKey}` inside `root` and
 * scroll it into view, flashing it briefly. Returns true if the row was found.
 * Pure w.r.t. React — safe to call from an effect/retry loop.
 */
export function scrollDiffRowIntoView(root: HTMLElement | null, rowKey: string): boolean {
  if (!root) return false;
  let el: HTMLElement | null;
  try {
    el = root.querySelector<HTMLElement>(`[data-diff-row="${cssEscape(rowKey)}"]`);
  } catch {
    el = null;
  }
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('diff__line--flash');
  const target = el;
  window.setTimeout(() => target.classList.remove('diff__line--flash'), 1200);
  return true;
}

/**
 * Find the DOM element tagged with `data-thread-id={threadId}` and scroll it
 * into view, adding a short-lived highlight class. Returns true if an element
 * was found. Pure w.r.t. React — safe to call from an effect/retry loop.
 */
export function scrollThreadIntoView(threadId: string): boolean {
  if (typeof document === 'undefined') return false;
  let el: HTMLElement | null;
  try {
    el = document.querySelector<HTMLElement>(
      `[data-thread-id="${cssEscape(threadId)}"]`,
    );
  } catch {
    el = null;
  }
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('thread--flash');
  const target = el;
  window.setTimeout(() => target.classList.remove('thread--flash'), 1500);
  return true;
}
