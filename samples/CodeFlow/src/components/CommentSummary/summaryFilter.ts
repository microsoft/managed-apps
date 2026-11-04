import { DESCRIPTION_FILE, type CommentThread } from '../../types';
import { threadAuthor } from './summarySort';

export interface SummaryAuthor {
  key: string;
  login: string;
  label: string;
}

function authorKey(thread: CommentThread): string {
  return (thread.comments[0]?.author.login ?? '').trim().toLowerCase();
}

/** Use the thread starter, matching the Author column, rather than reply authors. */
export function summaryAuthors(threads: CommentThread[]): SummaryAuthor[] {
  const authors = new Map<string, SummaryAuthor>();
  for (const thread of threads) {
    const key = authorKey(thread);
    const login = thread.comments[0]?.author.login.trim() ?? '';
    const label = key ? threadAuthor(thread) : 'Unknown author';
    const existing = authors.get(key);
    if (!existing || existing.label === existing.login) {
      authors.set(key, { key, login, label });
    }
  }
  return [...authors.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true })
      || a.key.localeCompare(b.key),
  );
}

/** Exclusions keep newly arriving authors visible until explicitly unchecked. */
export function filterThreadAuthors(
  threads: CommentThread[],
  excluded: ReadonlySet<string>,
): CommentThread[] {
  return threads.filter((thread) => !excluded.has(authorKey(thread)));
}

/**
 * Which thread buckets are visible in the summary panel. "closed" is the
 * local-only review flag and takes precedence over the GitHub status: a closed
 * thread is counted/filtered as closed regardless of its active/resolved state.
 */
export interface SummaryFilters {
  active: boolean;
  resolved: boolean;
  closed: boolean;
}

/**
 * Which kind of conversation the summary is listing.
 *
 * The split earns its place because the two kinds carry different stakes: only
 * *file-level* threads — inline review comments anchored to a file and line —
 * can hold a merge up as an unresolved conversation. *Top-level* threads are
 * GitHub issue comments on the pull request itself and never block it. A
 * reviewer clearing the last obstacles to a merge wants one of those lists and
 * not the other.
 */
export type SummaryScope = 'all' | 'top' | 'file';

export const SUMMARY_SCOPES: SummaryScope[] = ['all', 'top', 'file'];

export const SUMMARY_SCOPE_LABELS: Record<SummaryScope, string> = {
  all: 'All',
  top: 'Top-level',
  file: 'File-level',
};

export const SUMMARY_SCOPE_TITLES: Record<SummaryScope, string> = {
  all: 'Every comment on this pull request',
  top: 'Comments on the pull request itself — these never block the merge',
  file: 'Inline comments on a file and line — these can block the merge while unresolved',
};

/**
 * Classify one thread as top-level or file-level.
 *
 * `isIssueComment` is the authoritative signal, but a thread with no file
 * anchor at all cannot be file-level whatever the backend recorded, so a
 * missing or placeholder filename counts as top-level too.
 *
 * Deliberately *not* the rule the Description pane uses. That one also sweeps in
 * review threads whose file has dropped out of the comparison, because it is
 * choosing where to render something that would otherwise have nowhere to go.
 * Here the question is whether the thread can block a merge, and an inline
 * comment still can even when its file no longer appears in the diff.
 */
export function threadScope(thread: CommentThread): Exclude<SummaryScope, 'all'> {
  if (thread.isIssueComment) return 'top';
  if (
    !thread.filename ||
    thread.filename === '(unknown)' ||
    thread.filename === DESCRIPTION_FILE
  ) {
    return 'top';
  }
  return 'file';
}

export type SummaryScopeCounts = Record<SummaryScope, number>;

/** Count threads per scope, for the labels on the scope picker. */
export function countScopes(threads: CommentThread[]): SummaryScopeCounts {
  const counts: SummaryScopeCounts = { all: threads.length, top: 0, file: 0 };
  for (const t of threads) counts[threadScope(t)] += 1;
  return counts;
}

/**
 * Narrow threads to one scope. Applied before the status buckets and the search
 * so that both — the checkbox counts included — describe the list on screen.
 */
export function scopeThreads(
  threads: CommentThread[],
  scope: SummaryScope,
): CommentThread[] {
  if (scope === 'all') return threads;
  return threads.filter((t) => threadScope(t) === scope);
}

export interface SummaryCounts {
  active: number;
  resolved: number;
  closed: number;
}

/**
 * Count threads by bucket. Closed threads count only toward `closed`; every
 * other thread counts toward its GitHub status.
 */
export function countThreads(threads: CommentThread[]): SummaryCounts {
  const counts: SummaryCounts = { active: 0, resolved: 0, closed: 0 };
  for (const t of threads) {
    if (t.closed) counts.closed += 1;
    else counts[t.status] += 1;
  }
  return counts;
}

/**
 * Apply the bucket filters + a free-text search, then sort newest-updated
 * first. Closed threads are gated solely by the `closed` filter.
 */
export function filterThreads(
  threads: CommentThread[],
  filters: SummaryFilters,
  search: string,
): CommentThread[] {
  const q = search.trim().toLowerCase();
  return threads
    .filter((t) => (t.closed ? filters.closed : filters[t.status]))
    .filter((t) => {
      if (!q) return true;
      if (t.filename.toLowerCase().includes(q)) return true;
      return t.comments.some((c) => c.body.toLowerCase().includes(q));
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
