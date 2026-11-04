import type { Anchor } from './diffViewerUtils';

function codeAt(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element?.closest<HTMLElement>('[data-comment-code]') ?? null;
}

/** Read only selected code in this file and pane, not gutters, buttons or comments. */
export function selectedCommentRange(button: HTMLElement, anchor: Anchor): Anchor | null {
  const table = button.closest('table');
  const selection = button.ownerDocument.getSelection();
  if (!table || !selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const first = codeAt(range.startContainer);
  const last = codeAt(range.endContainer);
  const attribute = `data-comment-${anchor.side}`;
  if (!first || !last || first.closest('table') !== table || last.closest('table') !== table) return null;
  if (table.classList.contains('diff__table--split')
    && (!first.hasAttribute(attribute) || !last.hasAttribute(attribute))) return null;

  const lines: number[] = [];
  for (const code of table.querySelectorAll<HTMLElement>(`[data-comment-code][${attribute}]`)) {
    if (code.closest('table') !== table || !range.intersectsNode(code)) continue;
    const contents = code.ownerDocument.createRange();
    contents.selectNodeContents(code);
    if (code.contains(range.startContainer)) contents.setStart(range.startContainer, range.startOffset);
    if (code.contains(range.endContainer)) contents.setEnd(range.endContainer, range.endOffset);
    // Touching a boundary is not selecting its line (e.g. an end at column 0).
    if (!contents.toString().length) continue;
    lines.push(Number(code.getAttribute(attribute)));
  }
  if (!lines.includes(anchor.line)) return null;
  const startLine = lines[0];
  const line = lines[lines.length - 1];
  return { side: anchor.side, line, ...(startLine < line ? { startLine } : {}) };
}
