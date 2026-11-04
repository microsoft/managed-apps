import type { CommentThread } from '../../types';
import { threadDisplayStatus, type ThreadDisplayStatus } from '../../utils/threadStatus';

/**
 * Which column the summary list is ordered by.
 *
 * Only the columns that answer a question worth asking are sortable. "Author"
 * is the one this exists for — reviewers work a PR one correspondent at a time
 * ("what did Jesse raise?") and a strictly chronological list scatters that
 * across the whole table. The rest come along because the same header row can
 * carry them for free, and because "everything still open, oldest first" is the
 * other list people build by hand.
 */
export type SummarySortKey = 'status' | 'file' | 'author' | 'updated';

export type SummarySortDir = 'asc' | 'desc';

export interface SummarySort {
  key: SummarySortKey;
  dir: SummarySortDir;
}

/** Newest activity first — what the list showed before it could be re-sorted. */
export const DEFAULT_SUMMARY_SORT: SummarySort = { key: 'updated', dir: 'desc' };

/**
 * Where a column starts when you first click it. Names read forwards (A→Z) and
 * times read backwards (newest first), so neither needs a second click to be
 * useful.
 */
const NATURAL_DIR: Record<SummarySortKey, SummarySortDir> = {
  status: 'asc',
  file: 'asc',
  author: 'asc',
  updated: 'desc',
};

/** Unresolved work first, then what has been dealt with. */
const STATUS_RANK: Record<ThreadDisplayStatus, number> = {
  active: 0,
  resolved: 1,
  closed: 2,
};

/**
 * Who a thread is filed under: whoever opened it, not whoever replied last.
 * That matches the Author column, and it is the person you go looking for when
 * you sort by author — a thread belongs to the reviewer who raised it.
 */
export function threadAuthor(thread: CommentThread): string {
  const author = thread.comments[0]?.author;
  return (author?.name || author?.login || '').trim();
}

/** Case-insensitive, and locale-aware so accented names land where they read. */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function compareBy(key: SummarySortKey, a: CommentThread, b: CommentThread): number {
  switch (key) {
    case 'status':
      return STATUS_RANK[threadDisplayStatus(a)] - STATUS_RANK[threadDisplayStatus(b)];
    case 'file': {
      const byName = compareNames(a.filename, b.filename);
      // Within one file the line number is the only order that makes sense.
      return byName !== 0 ? byName : a.line - b.line;
    }
    case 'author':
      return compareNames(threadAuthor(a), threadAuthor(b));
    case 'updated':
      return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
  }
}

/**
 * Order threads for the summary table.
 *
 * Two rules keep the list from shuffling under the reader. Threads whose author
 * is unknown sink to the bottom in *both* directions — reversing the sort should
 * bring the last named author to the top, not a row with an empty cell. And
 * every tie falls back to newest-updated first, so re-sorting by a coarse column
 * like status leaves the familiar chronological order inside each group.
 */
export function sortThreads(threads: CommentThread[], sort: SummarySort): CommentThread[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...threads].sort((a, b) => {
    if (sort.key === 'author') {
      const anon = Number(!threadAuthor(a)) - Number(!threadAuthor(b));
      if (anon !== 0) return anon;
    }
    const primary = compareBy(sort.key, a, b);
    if (primary !== 0) return primary * sign;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
}

/**
 * What clicking a header does: adopt the column at its natural direction, or
 * flip the direction if it is already the one in force.
 */
export function nextSort(current: SummarySort, key: SummarySortKey): SummarySort {
  if (current.key !== key) return { key, dir: NATURAL_DIR[key] };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/** `aria-sort` for a header cell, so screen readers announce the order. */
export function ariaSort(
  sort: SummarySort,
  key: SummarySortKey,
): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

/** Tooltip explaining what the next click on this header would do. */
export function sortHint(sort: SummarySort, key: SummarySortKey, label: string): string {
  const next = nextSort(sort, key);
  return `Sort by ${label.toLowerCase()}, ${next.dir === 'asc' ? 'ascending' : 'descending'}`;
}
