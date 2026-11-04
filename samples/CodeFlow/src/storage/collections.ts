import { z } from 'zod';
import type { CollectionDefinition } from './core';

/**
 * Every collection this app stores, as zod schemas.
 *
 * The schema is the single source of truth: it gives the TypeScript type, the
 * runtime validation applied on every read and write, and the field list that
 * `npm run storage:describe` prints for anyone moving data to a shared backend.
 *
 * Record ids for per-PR collections are the PR key, `owner/repo#number`.
 */

const prRef = {
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().nonnegative(),
};

/* ----------------------------- reviewState ------------------------------ */

export const reviewStateSchema = z.object({
  ...prRef,
  /** PR title as of the last visit, for dashboard lists. */
  title: z.string().optional(),
  /** Seen marks per compared range: `rangeId -> filename -> true`. */
  seen: z.record(z.string(), z.record(z.string(), z.boolean())).default({}),
  /** Patch hash per file per range, used to carry seen marks across pushes. */
  patchHashes: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  /** The range the reviewer last compared. */
  lastRange: z.string().optional(),
  /** Commit SHAs observed on the branch, for force-push detection. */
  iterationHistory: z
    .object({
      knownShas: z.array(z.string()),
      lostShas: z.array(z.string()),
      updatedAt: z.string(),
    })
    .optional(),
  /** The iteration this reviewer last reviewed. */
  lastReviewed: z.object({ sha: z.string(), index: z.number(), at: z.string() }).optional(),
  /** Comment threads kept by the local comment backend (when GitHub sync is unavailable). */
  comments: z.array(z.unknown()).default([]),
  /** When the PR was last opened (drives "Recent"). */
  viewedAt: z.string().optional(),
  /** Set while the PR is flagged/followed. */
  flaggedAt: z.string().optional(),
  /** Set while the reviewer has an unfinished review of the PR. */
  inProgressSince: z.string().optional(),
  /** Last time the unfinished review was opened (orders the in-progress list). */
  inProgressTouchedAt: z.string().optional(),
});
export type ReviewState = z.infer<typeof reviewStateSchema>;

export const reviewStateCollection: CollectionDefinition<ReviewState> = {
  name: 'reviewState',
  schema: reviewStateSchema,
  description: "One record per pull request (id `owner/repo#number`): the reviewer's seen marks, review progress and dashboard flags.",
};

/* -------------------------------- prNotes ------------------------------- */

export const closedEntrySchema = z.object({
  /** Stable id of whoever closed or reopened the thread. */
  by: z.string(),
  login: z.string().optional(),
  at: z.string(),
  /** `false` is a tombstone: explicitly reopened. */
  closed: z.boolean(),
});

export const prNotesSchema = z.object({
  ...prRef,
  /** App-level "closed" overlay on comment threads: `threadId -> entry`. */
  closedThreads: z.record(z.string(), closedEntrySchema).default({}),
});
export type PrNotes = z.infer<typeof prNotesSchema>;

export const prNotesCollection: CollectionDefinition<PrNotes> = {
  name: 'prNotes',
  schema: prNotesSchema,
  description: 'One record per pull request (id `owner/repo#number`): review notes such as which threads were closed in the app. Shared with other reviewers only when a shared storage provider is configured.',
};

/* ------------------------------- approvals ------------------------------ */

export const approvalSchema = z.object({
  ...prRef,
  /** `owner/repo#number`, for filtering. */
  prKey: z.string().min(1),
  authorLogin: z.string().min(1),
  /** The head commit that was approved. */
  commitId: z.string().min(1),
  submittedAt: z.string(),
  body: z.string().max(10_000).optional(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const approvalsCollection: CollectionDefinition<Approval> = {
  name: 'approvals',
  schema: approvalSchema,
  description: "App-only author approvals of a pull request's head commit. Append-only.",
};

/* ------------------------------- feedback ------------------------------- */

export const FEEDBACK_TITLE_MAX = 200;
export const FEEDBACK_BODY_MAX = 10_000;

export const feedbackSchema = z.object({
  title: z.string().min(1).max(FEEDBACK_TITLE_MAX),
  body: z.string().max(FEEDBACK_BODY_MAX).default(''),
  kind: z.enum(['bug', 'idea', 'question']),
  status: z.enum(['open', 'pending', 'blocked', 'closed', 'wontfix']),
  authorId: z.string().default(''),
  authorLogin: z.string().optional(),
  authorName: z.string().optional(),
  closedBy: z.string().optional(),
  closedAt: z.string().optional(),
  appVersion: z.string().optional(),
});
export type FeedbackRecord = z.infer<typeof feedbackSchema>;

export const feedbackCollection: CollectionDefinition<FeedbackRecord> = {
  name: 'feedback',
  schema: feedbackSchema,
  description: 'Notes and feedback items (bugs, ideas, questions) with a simple status.',
};

export const feedbackCommentSchema = z.object({
  feedbackId: z.string().min(1),
  body: z.string().min(1).max(FEEDBACK_BODY_MAX),
  kind: z.enum(['comment', 'status', 'question']),
  authorId: z.string().default(''),
  authorLogin: z.string().optional(),
  authorName: z.string().optional(),
});
export type FeedbackCommentRecord = z.infer<typeof feedbackCommentSchema>;

export const feedbackCommentsCollection: CollectionDefinition<FeedbackCommentRecord> = {
  name: 'feedbackComments',
  schema: feedbackCommentSchema,
  description: 'Replies on feedback items (`feedbackId` references a `feedback` record).',
};

/* ------------------------------- registry ------------------------------- */

export const allCollections = [
  reviewStateCollection,
  prNotesCollection,
  approvalsCollection,
  feedbackCollection,
  feedbackCommentsCollection,
] as unknown as CollectionDefinition<unknown>[];

/**
 * Key/value namespaces. These hold small, device-local state and are not part of
 * the collection list above.
 *
 * - `prefs`  — settings and pinned repositories
 * - `drafts` — unsent comment text
 * - `ui`     — pane sizes and other layout state
 */
export const KV_NAMESPACES = ['prefs', 'drafts', 'ui'] as const;
export type KvNamespace = (typeof KV_NAMESPACES)[number];
