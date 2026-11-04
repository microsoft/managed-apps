import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { getSettings } from '../../settings/settingsStore';
import { relativeTime, timeTitle } from '../../utils/format';
import {
  countScopes,
  countThreads,
  filterThreadAuthors,
  filterThreads,
  scopeThreads,
  summaryAuthors,
  SUMMARY_SCOPE_LABELS,
  SUMMARY_SCOPE_TITLES,
  SUMMARY_SCOPES,
  type SummaryAuthor,
  type SummaryFilters,
  type SummaryScope,
} from './summaryFilter';
import {
  ariaSort,
  DEFAULT_SUMMARY_SORT,
  nextSort,
  sortHint,
  sortThreads,
  threadAuthor,
  type SummarySort,
  type SummarySortKey,
} from './summarySort';
import {
  THREAD_STATUS_LABELS,
  threadDisplayStatus,
  threadStatusLabel,
  threadStatusTitle,
} from '../../utils/threadStatus';
import { threadAnchorLabel, threadAnchorTitle } from '../../utils/threadAnchor';

type FilterKey = keyof SummaryFilters;

const ALL_FILTERS: FilterKey[] = ['active', 'resolved', 'closed'];

function AuthorFilter({
  authors,
  excluded,
  onChange,
}: {
  authors: SummaryAuthor[];
  excluded: ReadonlySet<string>;
  onChange: (excluded: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ above: true, maxHeight: 280, left: 0, edge: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const selectedCount = authors.filter((author) => !excluded.has(author.key)).length;
  const allSelected = selectedCount === authors.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const toggleOpen = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const above = rect.top > window.innerHeight - rect.bottom;
      const space = above ? rect.top : window.innerHeight - rect.bottom;
      // Checkbox counts can reflow the toolbar; keep the open picker in place.
      setPlacement({
        above,
        maxHeight: Math.max(0, Math.min(280, space - 12)),
        left: Math.max(14, Math.min(rect.left, window.innerWidth - 294)),
        edge: (above ? window.innerHeight - rect.top : rect.bottom) + 4,
      });
    }
    setOpen((previous) => !previous);
  };

  const toggleAuthor = (key: string) => {
    const next = new Set(excluded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  return (
    <div
      className="summary__authors"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className={`summary__author-trigger${allSelected ? '' : ' summary__author-trigger--active'}`}
        aria-expanded={open}
        aria-controls={menuId}
        title="Filter by the author who started each thread, not its replies"
        onClick={toggleOpen}
      >
        Authors: {allSelected ? 'All' : `${selectedCount} of ${authors.length}`}
        <span aria-hidden="true"> ▾</span>
      </button>
      {open && (
        <div
          id={menuId}
          className="summary__author-menu"
          style={{
            maxHeight: placement.maxHeight,
            left: placement.left,
            top: placement.above ? 'auto' : placement.edge,
            bottom: placement.above ? placement.edge : 'auto',
          }}
          role="group"
          aria-label="Filter comments by author"
        >
          <div className="summary__author-actions">
            <button type="button" className="btn btn--sm" onClick={() => onChange(new Set())}>
              Select all
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onChange(new Set(authors.map((author) => author.key)))}
            >
              Clear all
            </button>
          </div>
          <p className="summary__author-help">Authors who started threads, not replies.</p>
          {authors.length === 0 ? (
            <p className="summary__author-help">No authors yet.</p>
          ) : authors.map((author) => (
            <label key={author.key} className="summary__author-option">
              <input
                type="checkbox"
                checked={!excluded.has(author.key)}
                onChange={() => toggleAuthor(author.key)}
              />
              <span>
                {author.login && author.label === author.login ? `@${author.login}` : author.label}
                {author.login && author.label !== author.login && (
                  <span className="summary__author-login"> @{author.login}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** A column header you can click to order the list by that column. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SummarySortKey;
  sort: SummarySort;
  onSort: (key: SummarySortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th aria-sort={ariaSort(sort, sortKey)}>
      <button
        type="button"
        className={`summary__sort${active ? ' summary__sort--active' : ''}`}
        title={sortHint(sort, sortKey, label)}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {/* A faint chevron on every sortable column, so the affordance does not
            depend on hovering to be discovered. */}
        <span className="summary__sortarrow" aria-hidden="true">
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '▾'}
        </span>
      </button>
    </th>
  );
}

export function CommentSummary() {
  const { prKey } = useCodeFlow();
  return <PrCommentSummary key={prKey} />;
}

function PrCommentSummary() {
  const { threads, threadsLoading, actions, focusRequest } = useCodeFlow();
  const [enabled, setEnabled] = useState<SummaryFilters>(() => ({
    ...getSettings().summaryFilters,
  }));
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<SummaryScope>('all');
  const [sort, setSort] = useState<SummarySort>(DEFAULT_SUMMARY_SORT);
  const [excludedAuthors, setExcludedAuthors] = useState<Set<string>>(() => new Set());

  const authors = useMemo(() => summaryAuthors(threads), [threads]);
  const byAuthor = useMemo(
    () => filterThreadAuthors(threads, excludedAuthors),
    [threads, excludedAuthors],
  );
  const scopeCounts = useMemo(() => countScopes(byAuthor), [byAuthor]);

  // Author and scope filters also narrow the status counts.
  const scoped = useMemo(() => scopeThreads(byAuthor, scope), [byAuthor, scope]);

  const counts = useMemo(() => countThreads(scoped), [scoped]);

  const visible = useMemo(
    () => sortThreads(filterThreads(scoped, enabled, search), sort),
    [scoped, enabled, search, sort],
  );

  const toggle = (s: FilterKey) =>
    setEnabled((prev) => ({ ...prev, [s]: !prev[s] }));

  const applySort = (key: SummarySortKey) => setSort((prev) => nextSort(prev, key));

  return (
    <div className="summary">
      <div className="summary__bar">
        <span className="summary__title">
          Comments{' '}
          {threadsLoading ? (
            <span className="summary__total summary__total--loading">…</span>
          ) : (
            <span className="summary__total">{threads.length}</span>
          )}
        </span>
        <div className="summary__scopes" role="group" aria-label="Filter comments by level">
          {SUMMARY_SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              className={`summary__scope${scope === s ? ' summary__scope--active' : ''}`}
              aria-pressed={scope === s}
              title={SUMMARY_SCOPE_TITLES[s]}
              onClick={() => setScope(s)}
            >
              {SUMMARY_SCOPE_LABELS[s]}{' '}
              <span className="summary__count">{scopeCounts[s]}</span>
            </button>
          ))}
        </div>
        <div className="summary__filters">
          {ALL_FILTERS.map((s) => (
            <label key={s} className={`summary__filter summary__filter--${s}`}>
              <input type="checkbox" checked={enabled[s]} onChange={() => toggle(s)} />
              {THREAD_STATUS_LABELS[s]} <span className="summary__count">{counts[s]}</span>
            </label>
          ))}
        </div>
        <AuthorFilter authors={authors} excluded={excludedAuthors} onChange={setExcludedAuthors} />
        <input
          className="summary__search"
          placeholder="Search comments"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="summary__tablewrap">
        {threadsLoading ? (
          <div className="summary__empty summary__loading">
            ⏳ Loading comments from GitHub…
          </div>
        ) : visible.length === 0 ? (
          <div className="summary__empty">
            {threads.length === 0
              ? 'No comments yet. Hover a line in the diff and click + to start a thread.'
              : 'No comments match the current filters.'}
          </div>
        ) : (
          <table className="summary__table">
            <thead>
              <tr>
                <SortHeader label="Status" sortKey="status" sort={sort} onSort={applySort} />
                <SortHeader label="File" sortKey="file" sort={sort} onSort={applySort} />
                <th>Line</th>
                <SortHeader label="Author" sortKey="author" sort={sort} onSort={applySort} />
                <th>Last Comment</th>
                <SortHeader label="Updated" sortKey="updated" sort={sort} onSort={applySort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => {
                const last = t.comments[t.comments.length - 1];
                const isCurrent = focusRequest?.threadId === t.id;
                return (
                  <tr
                    key={t.id}
                    className={`summary__row ${isCurrent ? 'summary__row--current' : ''} ${t.closed ? 'summary__row--closed' : ''}`}
                    onClick={() => actions.focusThread(t.id)}
                    title="Jump to this comment"
                  >
                    <td>
                      <span
                        className={`thread__status thread__status--${threadDisplayStatus(t)}`}
                        title={threadStatusTitle(t)}
                      >
                        {threadStatusLabel(t)}
                      </span>
                    </td>
                    <td className="summary__file">{t.filename}</td>
                    <td
                      className={`summary__line${t.outdated ? ' summary__line--outdated' : ''}`}
                      title={threadAnchorTitle(t)}
                    >
                      {threadAnchorLabel(t)}
                    </td>
                    <td className="summary__author">{threadAuthor(t)}</td>
                    <td className="summary__preview">
                      {last?.body}
                      {t.comments.length > 1 && (
                        <span className="summary__more"> · {t.comments.length} comments</span>
                      )}
                    </td>
                    <td className="summary__updated" title={timeTitle(t.updatedAt)}>
                      {relativeTime(t.updatedAt)}
                    </td>
                    <td className="summary__actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className={`btn btn--sm thread__closebtn${t.closed ? ' thread__closebtn--reopen' : ''}`}
                        title={t.closed
                          ? 'Reopen this thread (also unresolves on GitHub)'
                          : 'Close this thread once you\u2019re satisfied (also resolves on GitHub)'}
                        onClick={() => actions.setThreadClosed(t.id, !t.closed)}
                      >
                        {t.closed ? 'Reopen' : 'Close'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
