import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { DiffSearch } from './useDiffSearch';

function toggleClass(active: boolean): string {
  return active ? 'diff__search-toggle diff__search-toggle--active' : 'diff__search-toggle';
}

/**
 * VSCode-style find widget for the diff viewer: query input with Match Case,
 * Match Whole Word and Use Regex toggles, a live result count, and
 * previous / next / close controls.
 *
 * The widget mounts only while find is open, so it focuses (and selects) its
 * input on mount to mirror VSCode's Ctrl+F behavior.
 */
export function DiffSearchBox({ search }: { search: DiffSearch }) {
  const { query, options, total, activeOrdinal, error, capped, focusTick } = search;
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus and select the input whenever the find widget opens or re-opens
  // (i.e. every time openFind() is called, including when the widget is already
  // visible — e.g. the user selected text and pressed Ctrl+F again).
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [focusTick]);

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) search.prev();
      else search.next();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      search.close();
    }
  };

  const hasQuery = query.length > 0;
  const noResults = !error && hasQuery && total === 0;
  const countLabel = error
    ? 'Invalid regex'
    : !hasQuery
      ? ''
      : total === 0
        ? 'No results'
        : `${activeOrdinal} of ${total}${capped ? '+' : ''}`;

  return (
    <div className="diff__search" role="search">
      <div className={`diff__search-field${error ? ' diff__search-field--error' : ''}`}>
        <input
          ref={inputRef}
          className="diff__search-input"
          type="text"
          value={query}
          placeholder="Find"
          aria-label="Find in file"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => search.setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
        <div className="diff__search-toggles">
          <button
            type="button"
            className={toggleClass(options.caseSensitive)}
            title="Match Case"
            aria-label="Match Case"
            aria-pressed={options.caseSensitive}
            onClick={() => search.toggleOption('caseSensitive')}
          >
            Aa
          </button>
          <button
            type="button"
            className={toggleClass(options.wholeWord)}
            title="Match Whole Word"
            aria-label="Match Whole Word"
            aria-pressed={options.wholeWord}
            onClick={() => search.toggleOption('wholeWord')}
          >
            <span className="diff__search-word">ab</span>
          </button>
          <button
            type="button"
            className={toggleClass(options.regex)}
            title="Use Regular Expression"
            aria-label="Use Regular Expression"
            aria-pressed={options.regex}
            onClick={() => search.toggleOption('regex')}
          >
            .*
          </button>
        </div>
      </div>

      <span
        className={`diff__search-count${noResults || error ? ' diff__search-count--none' : ''}`}
        aria-live="polite"
      >
        {countLabel}
      </span>

      <div className="diff__search-nav">
        <button
          type="button"
          className="diff__search-btn"
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
          disabled={total === 0}
          onClick={() => search.prev()}
        >
          ↑
        </button>
        <button
          type="button"
          className="diff__search-btn"
          title="Next match (Enter)"
          aria-label="Next match"
          disabled={total === 0}
          onClick={() => search.next()}
        >
          ↓
        </button>
        <button
          type="button"
          className="diff__search-btn diff__search-btn--close"
          title="Close (Escape)"
          aria-label="Close find"
          onClick={() => search.close()}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
