import type { CommentThread, CommentThreadStatus } from '../types';

/**
 * Status a thread is shown with. `closed` is the app's own review flag, which
 * has no GitHub equivalent and *supersedes* the GitHub status rather than
 * sitting alongside it — matching how threads are counted and filtered in the
 * comment summary. Rendering both would read as "Active Closed".
 */
export type ThreadDisplayStatus = CommentThreadStatus | 'closed';

export const THREAD_STATUS_LABELS: Record<ThreadDisplayStatus, string> = {
  active: 'Active',
  resolved: 'Resolved',
  closed: 'Closed',
};

/** Just the fields the status badge needs, so callers can pass partial threads. */
type ThreadStatusFields = Pick<CommentThread, 'status'> & {
  closed?: boolean;
  closedBy?: { login?: string };
};

export function threadDisplayStatus(thread: ThreadStatusFields): ThreadDisplayStatus {
  return thread.closed ? 'closed' : thread.status;
}

export function threadStatusLabel(thread: ThreadStatusFields): string {
  return THREAD_STATUS_LABELS[threadDisplayStatus(thread)];
}

/**
 * Tooltip for the status badge. Closed threads keep their underlying GitHub
 * status here, since the badge itself only shows "Closed".
 *
 * Attribution is omitted rather than guessed when the closer is unknown, which
 * is the case for state carried over from before closing was shared.
 */
export function threadStatusTitle(thread: ThreadStatusFields): string | undefined {
  if (!thread.closed) return undefined;
  const login = thread.closedBy?.login;
  const who = login ? `Closed by @${login}` : 'Closed';
  return `${who} · shared with all reviewers, not a GitHub state · GitHub status: ${THREAD_STATUS_LABELS[thread.status]}`;
}
