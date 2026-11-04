import type { DiffSide } from '../types';

/** Use the DOM Selection API, as a browser drag does, rather than mocking the range reader. */
export function selectCode(root: ParentNode, side: DiffSide, from: number, to: number, backwards = false): Selection {
  const first = root.querySelector(`[data-comment-code][data-comment-${side}="${from}"]`);
  const last = root.querySelector(`[data-comment-code][data-comment-${side}="${to}"]`);
  if (!first || !last) throw new Error('Selected code lines are missing');
  const start = document.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode();
  const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
  let end = walker.nextNode();
  let next = walker.nextNode();
  while (next) { end = next; next = walker.nextNode(); }
  const selection = document.getSelection();
  if (!selection || !start || !end) throw new Error('Code text cannot be selected');
  selection.removeAllRanges();
  if (backwards) {
    selection.setBaseAndExtent(end, end.textContent?.length ?? 0, start, 0);
  } else {
    selection.setBaseAndExtent(start, 0, end, end.textContent?.length ?? 0);
  }
  return selection;
}
