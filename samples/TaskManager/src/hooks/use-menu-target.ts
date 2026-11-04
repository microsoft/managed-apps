import { createContext, useContext } from "react";

/**
 * WHICH work item currently has its right-click menu open — the id, or null
 * when no menu is open.
 *
 * This is NOT a second source of truth. HomePage already tracks the menu in one
 * piece of state (`cardMenu`, see CardMenuState), and every one of the six
 * places that opens a menu already puts the item's id on it. The provider just
 * publishes `cardMenu?.id ?? null` so the card that the menu belongs to can
 * mark itself, and it therefore clears itself through EVERY existing dismiss
 * path — outside click, Escape, scroll, resize, tab switch, or an action being
 * taken — because all of those already end with `setCardMenu(null)`. There is
 * nothing here to keep in sync.
 *
 * Context rather than props because this is a purely presentational flag needed
 * by six leaf renderers (board cards, Completed cards, Triage's two row lists,
 * My Work cards and nested child rows) that sit behind different intermediate
 * components — threading a boolean through all of them would be noise, and it
 * would be easy to miss a list. Follows the same shape as ConfirmContext.
 *
 * Opening a menu already re-renders the board (it is HomePage state, and none
 * of these cards are memoized), so consuming this costs no extra render.
 */
export const MenuTargetContext = createContext<string | null>(null);

/** The id of the work item whose context menu is open, or null. */
export function useMenuTargetId(): string | null {
  return useContext(MenuTargetContext);
}

/**
 * Does THIS work item currently own the open context menu?
 *
 * Matching on the work item id is safe across every view: a given id is
 * rendered at most once per visible list (an item is either assigned to an
 * engineer or in the backlog, never both), and the tabs that could otherwise
 * repeat one are never on screen at the same time.
 */
export function useIsMenuTarget(id: string | null | undefined): boolean {
  const target = useMenuTargetId();
  return Boolean(id) && target === id;
}
