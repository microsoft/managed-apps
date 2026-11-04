import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { compileMatcher } from '../../utils/diffSearch';
import type { DiffSearchOptions } from '../../settings/settings';
import { useSettings } from '../../settings/useSettings';
import {
  computeHits,
  groupHitsByCell,
  cellKeyOf,
  type SearchCell,
  type SearchColumn,
  type Hit,
} from './diffSearchModel';
import type { MarkRange } from './cellLayers';
import { renderCell } from './renderCell';

const NO_MARKS: MarkRange[] = [];
const NO_TOKENS: never[] = [];

export interface DiffSearch {
  open: boolean;
  query: string;
  options: DiffSearchOptions;
  /** Total number of matches across the current view. */
  total: number;
  /** 1-based ordinal of the active match, or 0 when there are none. */
  activeOrdinal: number;
  /** DOM id of the active match's <mark>, for scroll-into-view. */
  activeHitId: string | null;
  /** Non-null when the regex query is invalid. */
  error: string | null;
  /** True when the match cap was hit and results were truncated. */
  capped: boolean;
  /**
   * Incremented on every openFind() call so DiffSearchBox can focus and
   * select the input both on initial mount and when Ctrl+F is pressed again
   * while the widget is already open.
   */
  focusTick: number;
  setQuery(q: string): void;
  toggleOption(name: keyof DiffSearchOptions): void;
  next(): void;
  prev(): void;
  /** Open the find widget, optionally pre-filling it with `initialQuery`. */
  openFind(initialQuery?: string): void;
  close(): void;
  /**
   * The match ranges for one cell, for layering under other highlights.
   * A hit carries its `data-hit-id`, so these marks must never be split — the
   * viewer finds the active match by that id to scroll to it.
   */
  marksFor(column: SearchColumn, rowKey: string): MarkRange[];
  /** Render a code cell's text with matches wrapped in <mark>. */
  highlight(column: SearchColumn, rowKey: string, text: string): ReactNode;
}

/**
 * State + behavior for the diff viewer's in-file find widget. Given the ordered
 * searchable `cells` for the current view, it compiles the query, computes hits,
 * tracks the active match, and produces a `highlight` renderer for the diff.
 *
 * `resetKey` (e.g. the selected file) resets the active match when it changes.
 */
export function useDiffSearch(cells: SearchCell[], resetKey?: string): DiffSearch {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState('');
  // The toggles are a remembered preference rather than per-search state, so
  // they live in the settings document and sync with everything else.
  const { settings, update } = useSettings();
  const options = settings.diffSearch;
  const [activeIndex, setActiveIndex] = useState(0);
  const [focusTick, setFocusTick] = useState(0);

  const compiled = useMemo(() => compileMatcher(query, options), [query, options]);
  const error = compiled.ok ? null : compiled.error;

  const { hits, capped } = useMemo(() => {
    if (!compiled.ok) return { hits: [] as Hit[], capped: false };
    return computeHits(cells, compiled.matcher);
  }, [cells, compiled]);

  const total = hits.length;
  const matchesByCell = useMemo(() => groupHitsByCell(hits), [hits]);

  // Reset to the first match whenever the query, options, or file changes.
  // Done during render (React's "adjusting state on prop change" pattern) rather
  // than in an effect, so it doesn't trigger an extra commit or lint churn.
  const resetSignal =
    `${query}\u0000${options.caseSensitive}${options.wholeWord}${options.regex}\u0000${resetKey ?? ''}`;
  const [prevResetSignal, setPrevResetSignal] = useState(resetSignal);
  if (resetSignal !== prevResetSignal) {
    setPrevResetSignal(resetSignal);
    setActiveIndex(0);
  }

  const safeIndex = total > 0 ? Math.min(activeIndex, total - 1) : 0;
  const activeHit = total > 0 ? hits[safeIndex] : null;
  const activeHitId = activeHit ? activeHit.id : null;

  const setQuery = useCallback((q: string) => setQueryState(q), []);

  const toggleOption = useCallback(
    (name: keyof DiffSearchOptions) => {
      update({ diffSearch: { [name]: !options[name] } });
    },
    [options, update],
  );

  // next / prev clamp the (possibly stale) stored index against the current
  // total so a shrinking result set can't leave the pointer out of range.
  const next = useCallback(() => {
    setActiveIndex((i) => (total === 0 ? 0 : (Math.min(i, total - 1) + 1) % total));
  }, [total]);

  const prev = useCallback(() => {
    setActiveIndex((i) => (total === 0 ? 0 : (Math.min(i, total - 1) - 1 + total) % total));
  }, [total]);

  const openFind = useCallback((initialQuery?: string) => {
    if (initialQuery !== undefined) setQueryState(initialQuery);
    setOpen(true);
    setFocusTick((t) => t + 1);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const marksFor = useCallback(
    (column: SearchColumn, rowKey: string): MarkRange[] => {
      const cellHits = matchesByCell.get(cellKeyOf(column, rowKey));
      if (!cellHits || cellHits.length === 0) return NO_MARKS;
      return cellHits.map((hit) => ({
        start: hit.start,
        end: hit.end,
        key: hit.id,
        hitId: hit.id,
        className: hit.id === activeHitId ? 'diff__match diff__match--active' : 'diff__match',
      }));
    },
    [matchesByCell, activeHitId],
  );

  const highlight = useCallback(
    (column: SearchColumn, rowKey: string, text: string): ReactNode =>
      renderCell(text, marksFor(column, rowKey), NO_TOKENS),
    [marksFor],
  );

  return {
    open,
    query,
    options,
    total,
    activeOrdinal: total > 0 ? safeIndex + 1 : 0,
    activeHitId,
    error,
    capped,
    focusTick,
    setQuery,
    toggleOption,
    next,
    prev,
    openFind,
    close,
    marksFor,
    highlight,
  };
}
