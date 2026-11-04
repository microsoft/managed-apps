import type { Issue, IssueStatus } from '../../types';

/**
 * A status that earns its own tab.
 *
 * `wontfix` is excluded on purpose: it is a closure, and it files under `Closed`
 * rather than splitting the terminal state across two tabs. Excluding it here
 * rather than merely omitting it from {@link ISSUE_FILTERS} means a tab for it
 * isn't even representable, so it can't creep back in.
 */
export type IssueTab = Exclude<IssueStatus, 'wontfix'>;

/** Which slice of the tracker is on screen. */
export type IssueFilter = IssueTab | 'all';

/**
 * One tab per status, plus everything.
 *
 * `all` sits before `closed` so the terminal state stays the rightmost tab and
 * the three live states read left-to-right in pipeline order. `Open` is the
 * default landing tab and is a superset of `Pending` — see `FILTER_STATUSES`.
 */
export const ISSUE_FILTERS: readonly { value: IssueFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'all', label: 'All' },
  { value: 'closed', label: 'Closed' },
];

/** How each status reads on screen — badges, dropdowns and empty states alike. */
export const STATUS_LABELS: Record<IssueStatus, string> = {
  open: 'Open',
  pending: 'Pending',
  blocked: 'Blocked',
  closed: 'Closed',
  wontfix: 'Won’t fix',
};

/** One-line explanation of each status, for the triage control's tooltip. */
export const STATUS_HINTS: Record<IssueStatus, string> = {
  open: 'Raised, not triaged yet',
  pending: 'Picked up and being worked',
  blocked: 'Triaged, but can’t be finished yet',
  closed: 'Done',
  wontfix: 'Closed without doing it — a deliberate no',
};

/**
 * Which statuses each tab shows.
 *
 * `open` deliberately includes `pending`: both are live work, and seeing what is
 * already in flight is what stops the same thing being raised twice. `pending`
 * stays as the narrower view of just the work someone has picked up, so the tabs
 * overlap rather than partition — the counts are per-tab totals, not a breakdown
 * that adds up to `all`.
 *
 * `closed` is the umbrella over both endings: something declined is still off
 * the list, and a reader looking for "what happened to that?" shouldn't have to
 * know which kind of no it got.
 */
const FILTER_STATUSES: Record<IssueTab, readonly IssueStatus[]> = {
  open: ['open', 'pending'],
  pending: ['pending'],
  blocked: ['blocked'],
  closed: ['closed', 'wontfix'],
};

/** The tabs that map onto a status, derived so they can't drift from the map. */
const TAB_FILTERS = Object.keys(FILTER_STATUSES) as IssueTab[];

/** Does this issue belong on the given tab? */
export function matchesFilter(issue: Issue, filter: IssueFilter): boolean {
  return filter === 'all' || FILTER_STATUSES[filter].includes(issue.status);
}

/** Empty-state copy per tab, so an empty list still says something useful. */
export const EMPTY_COPY: Record<IssueFilter, string> = {
  open: 'Nothing open. Found a bug or have an idea? Raise one.',
  pending: 'Nothing in progress.',
  blocked: 'Nothing blocked.',
  closed: 'Nothing closed yet.',
  all: 'No issues yet. Be the first.',
};

export type IssueCounts = Record<IssueFilter, number>;

export function countIssues(issues: readonly Issue[]): IssueCounts {
  const counts = { all: issues.length } as IssueCounts;
  for (const filter of TAB_FILTERS) counts[filter] = 0;
  for (const issue of issues) {
    for (const filter of TAB_FILTERS) {
      if (matchesFilter(issue, filter)) counts[filter] += 1;
    }
  }
  return counts;
}

/**
 * Apply the status filter. The server already returns newest-activity-first, but
 * sorting again keeps the list stable after an optimistic local update, which
 * lands out of order.
 */
export function filterIssues(issues: readonly Issue[], filter: IssueFilter): Issue[] {
  const matching = issues.filter((i) => matchesFilter(i, filter));
  return matching.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}
