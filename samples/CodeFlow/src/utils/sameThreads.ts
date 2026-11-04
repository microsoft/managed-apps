/**
 * Whether two thread lists say the same thing.
 *
 * The poll re-fetches every thread on a timer and hands back freshly-parsed
 * objects, so the array's identity changes on every tick even when nothing
 * about the conversation has. Downstream that identity is load-bearing: it is
 * what the diff viewer's memoised rows compare against, so an unchanged poll
 * would re-render every line in the file — a freeze every interval on a long
 * one, which is exactly what "the app hangs on big files" feels like.
 *
 * Comparing is far cheaper than re-rendering. A pull request has tens of
 * threads and thousands of lines, and this runs once per poll rather than once
 * per row.
 *
 * ## Why every field is compared
 *
 * The obvious implementation picks the handful of fields that are "obviously
 * visible" — body, status, line. That is what this did first, and it was wrong
 * within one merge: it missed `nodeId` and `local`, which decide whether the
 * Edit button appears at all (see `canEditComment`), and `author`, which the
 * comment summary had meanwhile started sorting on.
 *
 * The failure mode is what makes the shortcut untenable. A missed field does
 * not throw, or render oddly, or fail a test — it silently suppresses a state
 * update, so a comment stays un-editable or a name stays stale until something
 * unrelated happens to change. Cheap to cause, very hard to trace back to here.
 *
 * So the rule is inverted: compare everything, and let the compiler enforce it.
 * The field maps below are total over their types, which means adding a field
 * to `Comment` or `CommentThread` fails to build until someone has said how it
 * compares. Being exhaustive costs a few property reads per poll and removes a
 * standing invitation to get it wrong.
 */

import type { Comment, CommentThread, GitUserRef } from '../types';
import type { ClosedEntry } from './sharedClosed';

/**
 * How each field is compared: `identity` for primitives, or the name of the
 * nested comparison to run.
 *
 * These are `Record<keyof T, …>` rather than plain arrays so that a new field is
 * a compile error naming the field, and so the comparisons below are driven by
 * the same list the compiler checks — two lists would drift.
 */
const USER_FIELDS: Record<keyof GitUserRef, 'identity'> = {
  login: 'identity',
  name: 'identity',
  avatarUrl: 'identity',
  htmlUrl: 'identity',
};

const CLOSED_FIELDS: Record<keyof ClosedEntry, 'identity'> = {
  by: 'identity',
  login: 'identity',
  at: 'identity',
  closed: 'identity',
};

const COMMENT_FIELDS: Record<keyof Comment, 'identity' | 'author'> = {
  id: 'identity',
  // An edit can land without moving the thread's `updatedAt`, and a comment
  // showing its old text is a real bug.
  body: 'identity',
  createdAt: 'identity',
  // `local` and `nodeId` gate the Edit affordance, and `nodeId` in particular
  // appears once an optimistic comment is replaced by GitHub's copy while
  // keeping its id — so it is precisely a field that can change between two
  // otherwise identical polls.
  local: 'identity',
  nodeId: 'identity',
  // Recovered on a later poll for the same reason as `nodeId`, and it decides
  // where the GitHub link points.
  htmlUrl: 'identity',
  // Stripped off `body` before display and written back on edit, so a stale one
  // silently un-anchors the comment.
  bodyPrefix: 'identity',
  author: 'author',
};

const THREAD_FIELDS: Record<keyof CommentThread, 'identity' | 'closedBy' | 'comments'> = {
  id: 'identity',
  // Needed to resolve/unresolve, and absent until the read path recovers it.
  threadNodeId: 'identity',
  prKey: 'identity',
  filename: 'identity',
  side: 'identity',
  line: 'identity',
  startLine: 'identity',
  status: 'identity',
  outdated: 'identity',
  createdAt: 'identity',
  updatedAt: 'identity',
  commitSha: 'identity',
  iterationIndex: 'identity',
  closed: 'identity',
  isIssueComment: 'identity',
  // Rendered as "Closed by @x" in the status tooltip.
  closedBy: 'closedBy',
  comments: 'comments',
};

// Hoisted so the key lists are built once, not once per thread per poll.
const USER_KEYS = Object.keys(USER_FIELDS) as (keyof GitUserRef)[];
const CLOSED_KEYS = Object.keys(CLOSED_FIELDS) as (keyof ClosedEntry)[];
const COMMENT_KEYS = Object.keys(COMMENT_FIELDS) as (keyof Comment)[];
const THREAD_KEYS = Object.keys(THREAD_FIELDS) as (keyof CommentThread)[];

function sameUser(a: GitUserRef | undefined, b: GitUserRef | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return USER_KEYS.every((k) => a[k] === b[k]);
}

function sameClosedBy(a: ClosedEntry | undefined, b: ClosedEntry | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return CLOSED_KEYS.every((k) => a[k] === b[k]);
}

function sameComment(a: Comment, b: Comment): boolean {
  return COMMENT_KEYS.every((key) =>
    COMMENT_FIELDS[key] === 'author' ? sameUser(a.author, b.author) : a[key] === b[key],
  );
}

function sameComments(a: readonly Comment[], b: readonly Comment[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((comment, i) => sameComment(comment, b[i]));
}

function sameThread(a: CommentThread, b: CommentThread): boolean {
  if (a === b) return true;
  return THREAD_KEYS.every((key) => {
    switch (THREAD_FIELDS[key]) {
      case 'comments':
        return sameComments(a.comments, b.comments);
      case 'closedBy':
        return sameClosedBy(a.closedBy, b.closedBy);
      default:
        return a[key] === b[key];
    }
  });
}

/**
 * Order matters: threads arrive in a stable order from the store, and a
 * reordering is a change worth re-rendering for.
 */
export function sameThreads(a: readonly CommentThread[], b: readonly CommentThread[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((thread, i) => sameThread(thread, b[i]));
}
