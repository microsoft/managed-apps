/** Class of the element that actually scrolls the diff. */
export const DIFF_PANE_SELECTOR = '.workarea__center';

/**
 * Scroll the pane that holds the diff back to its top.
 *
 * The diff is not its own scroll container — `.workarea__center` around it is —
 * so swapping what is rendered inside it leaves the previous view's scroll
 * offset in place. Only the vertical offset is reset: `scrollTo` leaves
 * `scrollLeft` alone when `left` is omitted.
 *
 * Returns true if a pane was found. Touches nothing React owns, so it is safe
 * to call from a layout effect or an event handler.
 */
export function scrollDiffPaneToTop(): boolean {
  if (typeof document === 'undefined') return false;
  const pane = document.querySelector<HTMLElement>(DIFF_PANE_SELECTOR);
  if (!pane) return false;
  if (typeof pane.scrollTo === 'function') pane.scrollTo({ top: 0 });
  else pane.scrollTop = 0;
  return true;
}
