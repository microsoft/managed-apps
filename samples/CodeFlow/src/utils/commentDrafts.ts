/**
 * Persistence for comment text that has been typed but not yet posted.
 *
 * The review screen is unmounted wholesale whenever the app reloads a pull
 * request: `App` only renders it while `status === 'ready'`, and the background
 * poll in `usePrPolling` drops the status back to `loading` the moment it sees
 * a new head sha. Every composer is a plain `useState`, so a reviewer part-way
 * through writing a comment when the auto-refresh fired watched their text
 * vanish — the app had thrown it away, and there was nowhere to get it back
 * from.
 *
 * Drafts therefore live outside React, keyed by pull request and by the thing
 * being written about, and are read back when the composer mounts again. They
 * are kept in the `drafts` key/value namespace of app storage: an unsent draft is
 * a scratchpad, not a document worth sharing.
 */

import { z } from 'zod';
import { validStartLine } from './commentRange';
import { appStorage } from '../storage';

/** Namespace for every draft key, so a sweep can find them all. */
export const DRAFT_PREFIX = 'draft:';

/** Drafts untouched for this long are treated as abandoned and swept. */
export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface StoredDraft {
  text: string;
  at: number;
}

/** The side of the diff a line-anchored draft belongs to. */
export type DraftSide = 'left' | 'right';

/** An anchor recovered from a stored line draft. */
export interface DraftAnchor {
  side: DraftSide;
  line: number;
  startLine?: number;
}

/**
 * Build a draft key, or `null` when there is no pull request to scope it to.
 *
 * A `null` key disables persistence rather than falling back to a shared one:
 * drafts from different pull requests must never be able to collide.
 */
function keyFor(prKey: string | undefined, scope: string): string | null {
  return prKey ? `${DRAFT_PREFIX}${prKey}|${scope}` : null;
}

/** The pull-request-level comment box on the description view. */
export function prDraftKey(prKey: string | undefined): string | null {
  return keyFor(prKey, 'pr');
}

/** The body of an in-progress approve / request-changes review. */
export function reviewDraftKey(prKey: string | undefined, event: string | null): string | null {
  if (!event) return null;
  return keyFor(prKey, `review|${event}`);
}

/** A reply being written on an existing thread. */
export function replyDraftKey(prKey: string | undefined, threadId: string): string | null {
  return keyFor(prKey, `reply|${threadId}`);
}

/** An in-place edit of a comment that has already been posted. */
export function editDraftKey(prKey: string | undefined, commentId: string): string | null {
  return keyFor(prKey, `edit|${commentId}`);
}

/**
 * A brand-new thread being started on a line.
 *
 * The filename goes last because it is the only part that can itself contain a
 * separator, which keeps {@link findLineDraftAnchor} able to recover the anchor
 * by splitting from the front.
 */
export function lineDraftKey(
  prKey: string | undefined,
  filename: string | undefined,
  side: DraftSide,
  line: number,
  startLine?: number,
): string | null {
  if (!filename) return null;
  const range = startLine === undefined ? String(line) : `${startLine}-${line}`;
  return keyFor(prKey, `line|${side}|${range}|${filename}`);
}

const draftSchema = z.object({ text: z.string(), at: z.number() });

function load(key: string): StoredDraft | null {
  return appStorage().drafts.get(key, draftSchema) ?? null;
}

function remove(key: string): void {
  try {
    appStorage().drafts.remove(key);
  } catch {
    /* storage is a nicety here; never let it break the composer */
  }
}

function expired(draft: StoredDraft, now: number): boolean {
  return now - draft.at > DRAFT_TTL_MS;
}

/** Read back a draft, or `''` when there isn't a usable one. */
export function readDraft(key: string | null, now = Date.now()): string {
  if (!key) return '';
  try {
    const draft = load(key);
    if (!draft) return '';
    if (expired(draft, now)) {
      remove(key);
      return '';
    }
    return draft.text;
  } catch {
    return '';
  }
}

/** Whether there is text worth restoring under `key`. */
export function hasDraft(key: string | null, now = Date.now()): boolean {
  return readDraft(key, now).trim().length > 0;
}

/**
 * Save a draft. Blank text removes the entry rather than storing an empty
 * string, so "I cleared the box" never comes back as a restored draft.
 */
export function writeDraft(key: string | null, text: string, now = Date.now()): void {
  if (!key) return;
  if (!text.trim()) {
    remove(key);
    return;
  }
  try {
    const draft: StoredDraft = { text, at: now };
    appStorage().drafts.set(key, draft);
  } catch {
    /* storage is a nicety here; never let it break the composer */
  }
}

/** Forget a draft outright — the reviewer posted it, or cancelled. */
export function clearDraft(key: string | null): void {
  if (!key) return;
  remove(key);
}

/** Every draft key currently in storage. */
function draftKeys(): string[] {
  try {
    return appStorage().drafts.keys().filter((k) => k.startsWith(DRAFT_PREFIX));
  } catch {
    return [];
  }
}

/** Drop drafts that have aged out, so storage can't grow without bound. */
export function pruneDrafts(now = Date.now()): void {
  for (const key of draftKeys()) {
    const draft = load(key);
    if (!draft || expired(draft, now)) remove(key);
  }
}

/**
 * Find where in a file the reviewer had a new-thread composer open.
 *
 * Reopening the composer is what makes a restored draft visible: after a reload
 * the anchor that was being commented on is gone from React state, so without
 * this the text would sit in storage with nothing on screen to show it.
 */
export function findLineDraftAnchor(
  prKey: string | undefined,
  filename: string | undefined,
  now = Date.now(),
): DraftAnchor | null {
  if (!prKey || !filename) return null;
  const prefix = `${DRAFT_PREFIX}${prKey}|line|`;
  for (const key of draftKeys()) {
    if (!key.startsWith(prefix)) continue;
    // `<side>|<line>|<filename>` — the filename may contain separators of its
    // own, so take it as everything after the second one.
    const rest = key.slice(prefix.length);
    const first = rest.indexOf('|');
    if (first < 0) continue;
    const second = rest.indexOf('|', first + 1);
    if (second < 0) continue;
    const side = rest.slice(0, first);
    const range = /^(\d+)(?:-(\d+))?$/.exec(rest.slice(first + 1, second));
    if (!range) continue;
    const line = Number(range[2] ?? range[1]);
    const startLine = range[2] ? validStartLine(range[1], line) : undefined;
    if ((side !== 'left' && side !== 'right') || !Number.isSafeInteger(line) || line <= 0) continue;
    if (range[2] && startLine === undefined) continue;
    if (rest.slice(second + 1) !== filename) continue;
    if (!hasDraft(key, now)) continue;
    return { side, line, ...(startLine !== undefined ? { startLine } : {}) };
  }
  return null;
}
