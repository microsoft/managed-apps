import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { useSettings } from '../../settings/useSettings';
import type { DiffSearchOptions } from '../../settings/settings';
import { renderCell } from '../DiffViewer/renderCell';
import type { MarkRange } from '../DiffViewer/cellLayers';
import {
  resultsLabel,
  searchAcrossFiles,
  type CrossFileHit,
} from './crossFileSearch';

const NO_TOKENS: never[] = [];

/** The sign a reviewer reads first: which version of the file the line is in. */
const KIND_SIGIL: Record<CrossFileHit['kind'], string> = {
  add: '+',
  del: '−',
  context: ' ',
};

const KIND_TITLE: Record<CrossFileHit['kind'], string> = {
  add: 'Added line',
  del: 'Deleted line',
  context: 'Unchanged line',
};

function toggleClass(active: boolean): string {
  return active ? 'results__toggle results__toggle--active' : 'results__toggle';
}

/** The match ranges of one hit, as marks for {@link renderCell}. */
function marksOf(hit: CrossFileHit): MarkRange[] {
  return hit.ranges.map((range, i) => ({
    start: range.start,
    end: range.end,
    key: `${hit.id}:${i}`,
    className: 'diff__match',
  }));
}

export interface SearchResultsProps {
  query: string;
  onQuery(query: string): void;
  /**
   * Incremented by whoever opens the panel (Ctrl+Shift+F, or the tab) so the
   * input focuses and selects itself again even when it is already mounted.
   */
  focusTick: number;
  /** Escape from the query input — collapses the panel. */
  onClose(): void;
}

/**
 * Search results across every file in the diff — the Ctrl+Shift+F panel.
 *
 * It sits beside the comment summary because the two answer the same shape of
 * question: here is a list of places in this pull request, click one to go
 * there. Clicking a result opens its file and scrolls the line into view.
 *
 * The query lives in the parent, so opening the panel can seed it from the
 * selection; the toggles live in settings, shared with find-in-file, because a
 * reviewer who works in regex works in regex in both.
 */
export function SearchResults({ query, onQuery, focusTick, onClose }: SearchResultsProps) {
  const { comparison, selectedFile, actions, lineFocusRequest } = useCodeFlow();
  const { settings, update } = useSettings();
  const options = settings.diffSearch;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [focusTick]);

  const result = useMemo(
    () => searchAcrossFiles(comparison?.files, query, options),
    [comparison, query, options],
  );

  const toggleOption = (name: keyof DiffSearchOptions) =>
    update({ diffSearch: { [name]: !options[name] } });

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    onClose();
  };

  const label = resultsLabel(result);

  return (
    <div className="results">
      <div className="results__bar" role="search">
        <span className="results__title">Search in files</span>
        <div className={`results__field${result.error ? ' results__field--error' : ''}`}>
          <input
            ref={inputRef}
            className="results__input"
            type="text"
            value={query}
            placeholder="Search all files in the diff"
            aria-label="Search all files in the diff"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
          />
          <div className="results__toggles">
            <button
              type="button"
              className={toggleClass(options.caseSensitive)}
              title="Match Case"
              aria-label="Match Case"
              aria-pressed={options.caseSensitive}
              onClick={() => toggleOption('caseSensitive')}
            >
              Aa
            </button>
            <button
              type="button"
              className={toggleClass(options.wholeWord)}
              title="Match Whole Word"
              aria-label="Match Whole Word"
              aria-pressed={options.wholeWord}
              onClick={() => toggleOption('wholeWord')}
            >
              <span className="results__word">ab</span>
            </button>
            <button
              type="button"
              className={toggleClass(options.regex)}
              title="Use Regular Expression"
              aria-label="Use Regular Expression"
              aria-pressed={options.regex}
              onClick={() => toggleOption('regex')}
            >
              .*
            </button>
          </div>
        </div>
        <span
          className={`results__count${result.error || result.lines === 0 ? ' results__count--none' : ''}`}
          aria-live="polite"
        >
          {label}
        </span>
      </div>

      <div className="results__listwrap">
        {!result.active ? (
          <div className="results__empty">
            Type to search every changed line in this pull request. Ctrl+Shift+F reopens this
            panel from anywhere.
          </div>
        ) : result.error ? (
          <div className="results__empty results__empty--error">{result.error}</div>
        ) : result.files.length === 0 ? (
          <div className="results__empty">No changed line matches “{query}”.</div>
        ) : (
          <ul className="results__files">
            {result.files.map((fileHits) => (
              <li key={fileHits.filename} className="results__file">
                <div
                  className={`results__filename${fileHits.filename === selectedFile ? ' results__filename--current' : ''}`}
                  title={fileHits.filename}
                >
                  <span className="results__path">{fileHits.filename}</span>
                  <span className="results__filecount">{fileHits.matches}</span>
                </div>
                <ul className="results__hits">
                  {fileHits.hits.map((hit) => {
                    const current =
                      lineFocusRequest?.filename === hit.filename &&
                      lineFocusRequest.side === hit.side &&
                      lineFocusRequest.line === hit.line;
                    return (
                      <li key={hit.id}>
                        <button
                          type="button"
                          className={`results__hit results__hit--${hit.kind}${current ? ' results__hit--current' : ''}`}
                          title={`${KIND_TITLE[hit.kind]} ${hit.line} in ${hit.filename}`}
                          onClick={() => actions.focusLine(hit.filename, hit.side, hit.line)}
                        >
                          <span className="results__lineno">{hit.line}</span>
                          <span className="results__sigil" aria-hidden="true">
                            {KIND_SIGIL[hit.kind]}
                          </span>
                          <span className="results__text">
                            {renderCell(hit.text, marksOf(hit), NO_TOKENS)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {result.capped && (
          <div className="results__capped">
            Showing the first {result.lines} matching lines — narrow the search to see the rest.
          </div>
        )}
      </div>
    </div>
  );
}
