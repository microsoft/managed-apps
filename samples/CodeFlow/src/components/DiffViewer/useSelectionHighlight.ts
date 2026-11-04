/**
 * Highlights every other occurrence of the word you select in the diff.
 *
 * Select an identifier and the rest of its occurrences light up, the way
 * VSCode's editor does — a fast way to see where a variable is used without
 * opening the find widget and typing the name back in.
 *
 * The selection is scoped to the diff itself: selecting text in a comment, the
 * file tree or the PR description highlights nothing, because those are not the
 * file you are reading. Matching is case-sensitive, since this is code and
 * `Item` and `item` are two different things.
 *
 * Reuses the find widget's machinery (`compileMatcher` + `computeHits`) so a
 * highlight and a search for the same word agree on what counts as a match.
 *
 * Drawing it rewrites the text nodes it marks up, which the browser treats as
 * grounds for throwing the selection away — so the highlight deliberately waits
 * until the selection is *finished*, and puts it back afterwards. See
 * `selectionRange`.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { compileMatcher } from '../../utils/diffSearch';
import { isWordToken, selectionToken } from '../../utils/selectionToken';
import type { MarkRange } from './cellLayers';
import type { SearchCell, SearchColumn } from './diffSearchModel';
import { cellKeyOf, computeHits, groupHitsByCell } from './diffSearchModel';
import { restoreSelection, saveSelection, type SavedSelection } from './selectionRange';

const NO_MARKS: MarkRange[] = [];

/**
 * One occurrence is the selection itself, which the browser is already
 * colouring. It takes a second one for the highlight to say anything.
 */
const MIN_OCCURRENCES = 2;

/**
 * Cheaper than the find widget's cap: nobody reads three thousand highlights,
 * and this runs on every selection the reader makes rather than on request.
 */
const SELECTION_HIT_CAP = 2000;

export interface SelectionHighlight {
  /** The word currently driving the highlight, or null when nothing is. */
  token: string | null;
  /** How many occurrences are highlighted, the selection included. */
  count: number;
  /** True when there is something to draw. */
  active: boolean;
  /** The occurrence ranges for one cell, for layering with other highlights. */
  marksFor(column: SearchColumn, rowKey: string): MarkRange[];
}

/** Read the current selection, but only if it lives inside `root`. */
function readSelectionIn(root: HTMLElement | null): string | null {
  if (!root) return null;
  const selection = typeof document === 'undefined' ? null : document.getSelection();
  if (!selection || selection.isCollapsed) return null;
  // Both ends must be inside the diff; a selection dragged out of it is on its
  // way somewhere else.
  if (!selection.anchorNode || !root.contains(selection.anchorNode)) return null;
  if (!selection.focusNode || !root.contains(selection.focusNode)) return null;
  return selectionToken(selection.toString());
}

export function useSelectionHighlight(
  cells: SearchCell[],
  enabled: boolean,
  rootRef: RefObject<HTMLElement | null>,
): SelectionHighlight {
  const [token, setToken] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const pendingRestore = useRef<SavedSelection | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Drawing the highlight rewrites the text nodes it marks up, and one of
    // them is the node the selection is anchored in — so doing it while the
    // reader is still dragging pulls the selection out from under them. It
    // collapses, the drag stops extending, and only the part selected before
    // the first match landed stays lit.
    //
    // So while a selection is being *made* — a button held down, or Shift held
    // for a keyboard extension — the DOM is left alone and the reading is
    // deferred. Nothing is lost by waiting: the highlight is a reaction to the
    // finished selection, and it lands the moment the button comes up.
    let settling = false;

    const read = () => {
      const next = readSelectionIn(rootRef.current);
      // React would bail on an equal token anyway; returning early also keeps
      // the restore below from firing on the `selectionchange` it triggers.
      if (next === tokenRef.current) return;
      // Saved before the marks go in, while the offsets still describe the DOM
      // the user is looking at.
      pendingRestore.current = next === null ? null : saveSelection(rootRef.current);
      tokenRef.current = next;
      setToken(next);
    };

    const onSelectionChange = () => {
      if (!settling) read();
    };
    const beginSettling = () => {
      settling = true;
    };
    const endSettling = () => {
      if (!settling) return;
      settling = false;
      read();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') beginSettling();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') endSettling();
    };

    // Capture phase throughout: a drag that starts on something calling
    // `stopPropagation` still has to be waited out.
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', beginSettling, true);
    document.addEventListener('pointerup', endSettling, true);
    document.addEventListener('pointercancel', endSettling, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', beginSettling, true);
      document.removeEventListener('pointerup', endSettling, true);
      document.removeEventListener('pointercancel', endSettling, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
    };
  }, [enabled, rootRef]);

  // The marks have been committed to the DOM by now, so the text nodes the
  // selection used to live in are gone. Put it back where the reader left it.
  useLayoutEffect(() => {
    const saved = pendingRestore.current;
    pendingRestore.current = null;
    if (saved) restoreSelection(saved);
  }, [token]);

  const byCell = useMemo(() => {
    if (!enabled || !token) return null;
    const compiled = compileMatcher(token, {
      caseSensitive: true,
      wholeWord: isWordToken(token),
      regex: false,
    });
    // A literal query cannot fail to compile, but the result type says it might.
    if (!compiled.ok) return null;
    const { hits } = computeHits(cells, compiled.matcher, SELECTION_HIT_CAP);
    if (hits.length < MIN_OCCURRENCES) return null;
    return groupHitsByCell(hits);
  }, [cells, enabled, token]);

  const count = useMemo(() => {
    if (!byCell) return 0;
    let total = 0;
    for (const hits of byCell.values()) total += hits.length;
    return total;
  }, [byCell]);

  const marksFor = useMemo(
    () =>
      (column: SearchColumn, rowKey: string): MarkRange[] => {
        const hits = byCell?.get(cellKeyOf(column, rowKey));
        if (!hits || hits.length === 0) return NO_MARKS;
        return hits.map((hit) => ({
          start: hit.start,
          end: hit.end,
          className: 'diff__selmatch',
          key: `sel-${hit.start}`,
        }));
      },
    [byCell],
  );

  return { token: byCell ? token : null, count, active: byCell !== null, marksFor };
}
