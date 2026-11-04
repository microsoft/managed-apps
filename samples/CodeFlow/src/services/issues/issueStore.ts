/**
 * Notes and feedback items, stored in the `feedback` collection of app storage.
 *
 * With the default local provider these stay in this browser: a personal list of
 * bugs, ideas and questions. With a shared provider everyone with access sees
 * the same list, and who may change what is governed by the backend's
 * permissions.
 */

import { appStorage, type FeedbackRecord } from '../../storage';
import { withConflictRetry, type Stored } from '../../storage/core';
import { APP_VERSION } from '../../config';
import type { Issue, IssueDraft, IssueKind, IssueStatus, IssueViewer } from '../../types';

export const TITLE_MAX_LENGTH = 200;
export const BODY_MAX_LENGTH = 10_000;

const KINDS: readonly IssueKind[] = ['bug', 'idea', 'question'];

/** Every status an issue may hold, in pipeline order. */
export const ISSUE_STATUSES: readonly IssueStatus[] = [
  'open',
  'pending',
  'blocked',
  'closed',
  'wontfix',
];

/**
 * The statuses that still want attention. `blocked` counts as active on
 * purpose: it is parked, not finished, and hiding it would be the quickest way
 * to lose track of it.
 */
export const ACTIVE_ISSUE_STATUSES: readonly IssueStatus[] = ['open', 'pending', 'blocked'];

/**
 * The two ways an issue ends. They differ only in *why* — done versus decided
 * against — so everything that groups by status treats them as one bucket, and
 * both carry a close record.
 */
export const CLOSED_ISSUE_STATUSES: readonly IssueStatus[] = ['closed', 'wontfix'];

/** True when the issue has been ended, either way. */
export function isClosedStatus(status: IssueStatus): boolean {
  return CLOSED_ISSUE_STATUSES.includes(status);
}

/** True when the issue is anything other than ended. */
export function isActiveStatus(status: IssueStatus): boolean {
  return !isClosedStatus(status);
}

function asKind(value: unknown): IssueKind {
  return KINDS.includes(value as IssueKind) ? (value as IssueKind) : 'bug';
}

/**
 * Coerce a stored status onto the union. Anything unrecognised reads as `open`
 * so a document written by a newer build — or a hand-edited one — degrades to
 * "still needs attention" rather than vanishing from every filter.
 */
function asStatus(value: unknown): IssueStatus {
  return ISSUE_STATUSES.includes(value as IssueStatus) ? (value as IssueStatus) : 'open';
}

/** Map a stored record onto the domain model the UI works with. */
export function toIssue(record: Stored<FeedbackRecord>): Issue {
  return {
    id: record.id,
    version: record.version,
    title: record.title,
    body: record.body,
    kind: asKind(record.kind),
    status: asStatus(record.status),
    authorId: record.authorId,
    authorLogin: record.authorLogin,
    authorName: record.authorName,
    closedBy: record.closedBy,
    closedAt: record.closedAt,
    appVersion: record.appVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toRecord(issue: Issue): FeedbackRecord {
  return {
    title: issue.title,
    body: issue.body,
    kind: issue.kind,
    status: issue.status,
    authorId: issue.authorId,
    ...(issue.authorLogin ? { authorLogin: issue.authorLogin } : {}),
    ...(issue.authorName ? { authorName: issue.authorName } : {}),
    ...(issue.closedBy ? { closedBy: issue.closedBy } : {}),
    ...(issue.closedAt ? { closedAt: issue.closedAt } : {}),
    ...(issue.appVersion ? { appVersion: issue.appVersion } : {}),
  };
}

/** Raised when a draft can't be stored, so the form can explain why. */
export class IssueValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IssueValidationError';
  }
}

/** Trim and bounds-check a draft, so every entry point gets the same rules. */
export function normalizeDraft(draft: IssueDraft): IssueDraft {
  const title = draft.title.trim();
  const body = draft.body.trim();
  if (!title) throw new IssueValidationError('Give the item a title.');
  if (title.length > TITLE_MAX_LENGTH) {
    throw new IssueValidationError(`Titles are limited to ${TITLE_MAX_LENGTH} characters.`);
  }
  if (body.length > BODY_MAX_LENGTH) {
    throw new IssueValidationError(
      `Descriptions are limited to ${BODY_MAX_LENGTH.toLocaleString()} characters.`,
    );
  }
  return { title, body, kind: asKind(draft.kind) };
}

/** Every item, newest activity first. Filtering by status happens in the UI. */
export async function listIssues(): Promise<Issue[]> {
  const records = await appStorage().feedback.listAll({
    orderBy: [{ field: 'updatedAt', direction: 'desc' }],
  });
  return records.map(toIssue);
}

/** Add a new item attributed to the signed-in user. */
export async function createIssue(draft: IssueDraft, viewer: IssueViewer): Promise<Issue> {
  const clean = normalizeDraft(draft);
  const record: FeedbackRecord = {
    title: clean.title,
    body: clean.body,
    kind: clean.kind,
    status: 'open',
    authorId: viewer.id,
    ...(viewer.login ? { authorLogin: viewer.login } : {}),
    ...(viewer.name ? { authorName: viewer.name } : {}),
    appVersion: APP_VERSION,
  };
  return toIssue(await appStorage().feedback.create(record));
}

/**
 * Write a changed item back, re-applying `apply` to a fresh copy if someone else
 * changed it first, so a retry re-applies the *intent* rather than clobbering.
 */
async function writeWithRetry(issue: Issue, apply: (current: Issue) => Issue): Promise<Issue> {
  const feedback = appStorage().feedback;
  return withConflictRetry(async (attempt) => {
    let base = issue;
    if (attempt > 1) {
      const fresh = await feedback.get(issue.id);
      if (!fresh) throw new Error('That item no longer exists.');
      base = toIssue(fresh);
    }
    const next = apply(base);
    const saved = await feedback.put(issue.id, toRecord(next), { ifVersion: base.version });
    return toIssue(saved);
  }, { attempts: 2 });
}

/** Save an edit to an existing item. Status is left untouched. */
export function saveIssue(issue: Issue, draft: IssueDraft): Promise<Issue> {
  const clean = normalizeDraft(draft);
  return writeWithRetry(issue, (current) => ({
    ...current,
    title: clean.title,
    body: clean.body,
    kind: clean.kind,
  }));
}

/**
 * Move an item to another status. The close record is derived from the target
 * status, so reopening clears the stamp instead of leaving a stale "closed by".
 */
export function setIssueStatus(
  issue: Issue,
  status: IssueStatus,
  viewer: IssueViewer,
): Promise<Issue> {
  const now = new Date().toISOString();
  const closing = isClosedStatus(status);
  return writeWithRetry(issue, (current) => ({
    ...current,
    status,
    closedBy: closing ? viewer.login || viewer.id : undefined,
    closedAt: closing ? now : undefined,
  }));
}

