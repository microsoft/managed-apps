import { z } from 'zod';
import type { CollectionDefinition } from './core';

/**
 * Every collection this app stores. The zod schemas are the single source of truth for record
 * shapes: TypeScript types, runtime validation, and `npm run storage:describe` (which the
 * add-data-source skill uses to create lists/tables in a shared backend).
 *
 * People are stored by directory user id (never email). Display names in `presenters` are a
 * snapshot for offline display; the app resolves current details via the Office 365 Users adapter.
 */

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd date.');

export const personRefSchema = z.object({
  /** Directory user id, or '' for someone outside the directory (e.g. sample data). */
  id: z.string().max(100),
  name: z.string().max(200),
});
export type PersonRef = z.infer<typeof personRefSchema>;

export const sessionSchema = z.object({
  /** Calendar date (yyyy-mm-dd) in the series time zone. */
  date: dateKey,
  /** `cancelled` marks a date with no session; a claimed session keeps its details for a restore. */
  status: z.enum(['claimed', 'cancelled']),
  name: z.string().max(200).default(''),
  description: z.string().max(4000).default(''),
  presenters: z.array(personRefSchema).max(20).default([]),
  /** User id of whoever signed up. */
  ownerId: z.string().max(100).default(''),
  /** Primary linked topic request id, or ''. Topics' `sessionRef` is the source of truth. */
  topicId: z.string().max(100).default(''),
});
export type SessionData = z.infer<typeof sessionSchema>;

export const topicSchema = z.object({
  name: z.string().trim().min(1).max(200),
  details: z.string().max(4000).default(''),
  /** User id of the requester. */
  requestedBy: z.string().max(100).default(''),
  status: z.enum(['open', 'scheduled', 'covered']).default('open'),
  /** User ids of everyone who voted. */
  voters: z.array(z.string().max(100)).max(5000).default([]),
  /** Session date (yyyy-mm-dd) this topic is linked to, or ''. */
  sessionRef: z.string().max(10).default(''),
});
export type TopicData = z.infer<typeof topicSchema>;

export const resourceSchema = z.object({
  label: z.string().min(1).max(200),
  url: z.string().max(2000),
});

export const pastSessionSchema = z.object({
  date: dateKey,
  title: z.string().trim().min(1).max(200),
  presenters: z.array(personRefSchema).max(20).default([]),
  /** Link to a recording. Rendered only when it passes `safeUrl()`. */
  recordingUrl: z.string().max(2000).nullable().default(null),
  synopsis: z.string().max(8000).nullable().default(null),
  tags: z.array(z.string().max(60)).max(20).default([]),
  resources: z.array(resourceSchema).max(20).default([]),
  durationSeconds: z.number().int().positive().nullable().default(null),
  /** True for the fictional sessions seeded on first run; "Remove sample data" deletes them. */
  sample: z.boolean().default(false),
});
export type PastSessionData = z.infer<typeof pastSessionSchema>;

export const SESSIONS: CollectionDefinition<SessionData> = {
  name: 'sessions',
  schema: sessionSchema,
  description: 'Upcoming and recent session sign-ups, one record per claimed or cancelled date.',
};

export const TOPICS: CollectionDefinition<TopicData> = {
  name: 'topics',
  schema: topicSchema,
  description: 'Topic requests and the user ids that voted for them.',
};

export const PAST_SESSIONS: CollectionDefinition<PastSessionData> = {
  name: 'pastSessions',
  schema: pastSessionSchema,
  description: 'Sessions that happened, with recordings and resources.',
};

export const allCollections: CollectionDefinition<unknown>[] = [
  SESSIONS as CollectionDefinition<unknown>,
  TOPICS as CollectionDefinition<unknown>,
  PAST_SESSIONS as CollectionDefinition<unknown>,
];

/** Key/value namespaces (preferences and small app flags). */
export const KV_NAMESPACES = {
  prefs: 'prefs',
  app: 'app',
  nav: 'nav',
} as const;
