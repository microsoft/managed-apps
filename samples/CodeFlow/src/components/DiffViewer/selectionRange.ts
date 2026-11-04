/**
 * Carries a text selection across a re-render that rewrites the text under it.
 *
 * Drawing the occurrence highlight wraps every match in a `<mark>` — including
 * the one the user just selected — which replaces the text node the selection
 * is anchored in. The DOM's own range-adjustment rules then collapse the
 * selection, so the word the reader deliberately selected stops being selected
 * the instant it lights up, and Ctrl+C copies nothing.
 *
 * The rewrite never changes the *characters* in the cell, only how they are
 * split across nodes, so a pair of character offsets into the cell survives it
 * intact. Save them before the marks go in, walk them back to a node and offset
 * after, and the selection is exactly where the reader left it.
 */

/** A selection recorded as character offsets into a still-live element. */
export interface SavedSelection {
  /** The cell the selection lives in. Survives the re-render; its children do not. */
  container: Element;
  start: number;
  end: number;
}

/** The element whose contents are re-rendered as one unit — a diff code cell. */
const CELL_SELECTOR = '.diff__code';

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** Characters before `(node, offset)` within `container`. */
function offsetWithin(container: Element, node: Node, offset: number): number {
  const before = container.ownerDocument.createRange();
  before.selectNodeContents(container);
  before.setEnd(node, offset);
  return before.toString().length;
}

/** Walk `offset` characters into `container` and land on a text node. */
function locate(container: Element, offset: number): { node: Text; offset: number } | null {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let last: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const length = node.data.length;
    if (offset <= seen + length) return { node, offset: offset - seen };
    seen += length;
    last = node;
    node = walker.nextNode() as Text | null;
  }
  return last ? { node: last, offset: last.data.length } : null;
}

/**
 * Record the current selection, if it sits inside a single diff cell in `root`.
 *
 * Returns null for anything else — a collapsed caret, a selection outside the
 * diff, or one spanning cells. Those either draw no highlight or are not a
 * single token, so nothing rewrites them and there is nothing to restore.
 */
export function saveSelection(root: HTMLElement | null): SavedSelection | null {
  if (!root || typeof document === 'undefined') return null;
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const container = elementOf(range.commonAncestorContainer)?.closest(CELL_SELECTOR) ?? null;
  if (!container || !root.contains(container)) return null;

  return {
    container,
    start: offsetWithin(container, range.startContainer, range.startOffset),
    end: offsetWithin(container, range.endContainer, range.endOffset),
  };
}

/**
 * Put a saved selection back. A no-op if the cell has since left the document —
 * the file changed under it, and the old selection means nothing there.
 */
export function restoreSelection(saved: SavedSelection): boolean {
  const { container, start, end } = saved;
  if (!container.isConnected) return false;

  const from = locate(container, start);
  const to = locate(container, end);
  if (!from || !to) return false;

  const selection = container.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;

  const range = container.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
