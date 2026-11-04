/**
 * Review state for the current reviewer: seen marks, review progress, local
 * comment threads, the "closed" thread overlay and the dashboard lists.
 *
 * Everything lives in the storage provider (see `src/storage`):
 * - per-PR review progress and dashboard flags -> `reviewState` collection
 * - the closed-thread overlay                  -> `prNotes` collection
 * - pinned repositories                        -> `prefs` key/value namespace
 *
 * Reads are synchronous (served from an in-memory mirror of the collection) so
 * they can be called from React state updaters; writes persist in the background.
 */

import type { FileChange, Iteration, PrCoordinates } from '../types';
import type { IterationHistory } from './forcePush';
import { isLastReviewed, nextLastReviewed, type LastReviewed } from './lastReviewed';
import {
  applyClosed,
  closedAttribution,
  closedFlags,
  normalizeSharedClosed,
  type ClosedEntry,
  type SharedClosedMap,
} from './sharedClosed';
import { z } from 'zod';
import { appStorage, type PrNotes, type ReviewState } from '../storage';

/** Stable string key for a PR, used to namespace persisted state. */
export function prKey(coords: PrCoordinates): string {
  return `${coords.owner}/${coords.name}#${coords.number}`;
}

/** Inverse of {@link prKey}. */
export function parsePrKey(key: string): { owner: string; repo: string; number: number } | undefined {
  const match = /^([^/]+)\/(.+)#(\d+)$/.exec(key);
  if (!match) return undefined;
  const number = Number(match[3]);
  return Number.isSafeInteger(number) && number >= 0 ? { owner: match[1], repo: match[2], number } : undefined;
}

/* ------------------------------ Hash util ------------------------------ */

/** Simple fast string hash (djb2 variant). Not cryptographic. */
function hashString(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/* ----------------------------- Record access ---------------------------- */

function emptyReviewState(pr: string): ReviewState {
  const ref = parsePrKey(pr) ?? { owner: pr, repo: '-', number: 1 };
  return { ...ref, seen: {}, patchHashes: {}, comments: [] };
}

function readState(pr: string): ReviewState {
  return appStorage().reviewState.get(pr) ?? emptyReviewState(pr);
}

function writeState(pr: string, update: (state: ReviewState) => ReviewState): ReviewState {
  const next = update(readState(pr));
  appStorage().reviewState.set(pr, next);
  return next;
}

function readNotes(pr: string): PrNotes {
  const existing = appStorage().prNotes.get(pr);
  if (existing) return existing;
  const ref = parsePrKey(pr) ?? { owner: pr, repo: '-', number: 1 };
  return { ...ref, closedThreads: {} };
}

/** Re-reads one PR's stored state from the provider (picks up other tabs or users). */
export async function refreshPrState(pr: string): Promise<void> {
  await Promise.all([appStorage().reviewState.refresh(pr), appStorage().prNotes.refresh(pr)]);
}

/** Subscribe to any review-state change (for views that read during render). */
export function subscribeReviewState(listener: () => void): () => void {
  const storage = appStorage();
  const a = storage.reviewState.subscribe(listener);
  const b = storage.prefs.subscribe((key) => {
    if (key === PINNED_KEY) listener();
  });
  return () => {
    a();
    b();
  };
}

/* ------------------------------ Seen state ----------------------------- */

/**
 * "Seen" state is tracked per (PR, iteration-pair, file). Keying by the compared
 * range means marking a file seen in one comparison doesn't bleed into another.
 */
export function getSeenFiles(pr: string, rangeId: string): Record<string, boolean> {
  return { ...(readState(pr).seen[rangeId] ?? {}) };
}

export function setFileSeen(
  pr: string,
  rangeId: string,
  filename: string,
  seen: boolean,
): Record<string, boolean> {
  return setManyFilesSeen(pr, rangeId, [filename], seen);
}

export function setManyFilesSeen(
  pr: string,
  rangeId: string,
  filenames: string[],
  seen: boolean,
): Record<string, boolean> {
  const map = getSeenFiles(pr, rangeId);
  for (const f of filenames) {
    if (seen) map[f] = true;
    else delete map[f];
  }
  writeState(pr, (state) => ({ ...state, seen: { ...state.seen, [rangeId]: map } }));
  return { ...map };
}

/* --------------------------- Patch hashes ------------------------------ */

/** Compute patch hashes for a set of file changes. */
export function computePatchHashes(files: FileChange[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const f of files) {
    // Use patch text if available; fall back to a composite of stats.
    const content = f.patch ?? `${f.status}:+${f.additions}-${f.deletions}`;
    hashes[f.filename] = hashString(content);
  }
  return hashes;
}

/** Persist patch hashes for a range and record it as the last active range. */
export function savePatchHashes(pr: string, rangeId: string, files: FileChange[]): void {
  const hashes = computePatchHashes(files);
  writeState(pr, (state) => ({
    ...state,
    patchHashes: { ...state.patchHashes, [rangeId]: hashes },
    lastRange: rangeId,
  }));
}

/** Get the last active rangeId for a PR. */
export function getLastRangeId(pr: string): string | undefined {
  return readState(pr).lastRange;
}

/**
 * Migrate seen marks from a previous range to a new one based on patch content.
 * Files whose diff hash hasn't changed keep their "seen" status.
 * Returns the merged seen map for the new range.
 */
export function migrateSeenByContent(
  pr: string,
  prevRangeId: string,
  newRangeId: string,
  newFiles: FileChange[],
): Record<string, boolean> {
  if (prevRangeId === newRangeId) return getSeenFiles(pr, newRangeId);

  const state = readState(pr);
  const prevSeen = state.seen[prevRangeId] ?? {};
  const prevHashes = state.patchHashes[prevRangeId] ?? {};
  const newHashes = computePatchHashes(newFiles);

  // Start with any existing seen state for the new range (e.g. user already marked files).
  const newSeen = { ...(state.seen[newRangeId] ?? {}) };

  // Carry forward: if a file was seen AND its patch hash is unchanged, mark it seen.
  for (const [filename, wasSeen] of Object.entries(prevSeen)) {
    if (!wasSeen) continue;
    const oldHash = prevHashes[filename];
    const curHash = newHashes[filename];
    if (oldHash && curHash && oldHash === curHash && !newSeen[filename]) {
      newSeen[filename] = true;
    }
  }

  writeState(pr, (current) => ({
    ...current,
    seen: { ...current.seen, [newRangeId]: newSeen },
    patchHashes: { ...current.patchHashes, [newRangeId]: newHashes },
    lastRange: newRangeId,
  }));
  return { ...newSeen };
}

/* ----------------------------- Comments -------------------------------- */

/** Threads kept by the local comment backend. */
export function getStoredThreadsRaw<T>(pr: string): T[] {
  return structuredClone(readState(pr).comments) as T[];
}

export function setStoredThreadsRaw<T>(pr: string, threads: T[]): void {
  writeState(pr, (state) => ({ ...state, comments: structuredClone(threads) as unknown[] }));
}

/* --------------------------- Closed threads ---------------------------- */

/**
 * "Closed" review state, keyed by thread id and namespaced per PR.
 *
 * GitHub has no "closed" status, so reviewers use this to mark a thread as
 * "reviewed & satisfied" and stop re-reviewing it. It is independent of GitHub's
 * active/resolved status. It lives in the `prNotes` collection, so it is shared
 * with other reviewers only when a shared storage provider is configured. Entries
 * carry their author and timestamp; see `utils/sharedClosed`.
 */
export function getSharedClosed(pr: string): SharedClosedMap {
  return normalizeSharedClosed(readNotes(pr).closedThreads);
}

/** Close state as the view layer wants it: closed threads only. */
export function getClosedThreads(pr: string): Record<string, boolean> {
  return closedFlags(getSharedClosed(pr));
}

/** Who closed each currently-closed thread. */
export function getClosedAttribution(pr: string): Record<string, ClosedEntry> {
  return closedAttribution(getSharedClosed(pr));
}

/**
 * Record a close or reopen. Reopening writes a tombstone rather than dropping
 * the key, so the change survives merging with a copy that still believes the
 * thread is closed.
 */
export function setThreadClosed(
  pr: string,
  threadId: string,
  closed: boolean,
  actor: { by: string; login?: string } = { by: '' },
): Record<string, boolean> {
  const next = applyClosed(getSharedClosed(pr), threadId, closed, actor);
  appStorage().prNotes.set(pr, { ...readNotes(pr), closedThreads: next });
  return closedFlags(next);
}

/* ------------------------ Iteration history ---------------------------- */

/**
 * Commit SHAs observed on a PR branch. Comparing successive visits is the only
 * way this app can prove a force-push happened: GitHub's commit list simply
 * stops mentioning the discarded commits.
 */
export function getIterationHistory(pr: string): IterationHistory | undefined {
  const history = readState(pr).iterationHistory;
  return history ? { ...history } : undefined;
}

/**
 * Record the branch's current commit SHAs and fold any that have disappeared
 * since the last visit into the accumulated `lostShas` list.
 */
export function recordIterationShas(pr: string, shas: string[]): IterationHistory {
  const previous = getIterationHistory(pr);
  const current = new Set(shas);
  const lost = new Set(previous?.lostShas ?? []);
  for (const sha of previous?.knownShas ?? []) {
    if (!current.has(sha)) lost.add(sha);
  }
  // A SHA can reappear (e.g. the author force-pushed back to an earlier state),
  // in which case it's no longer lost.
  for (const sha of current) lost.delete(sha);

  const next: IterationHistory = {
    knownShas: shas,
    lostShas: [...lost],
    updatedAt: new Date().toISOString(),
  };
  writeState(pr, (state) => ({ ...state, iterationHistory: next }));
  return next;
}

/* ----------------------- Last reviewed iteration ----------------------- */

/** The iteration this reviewer last worked on, if they ever have. */
export function getLastReviewed(pr: string): LastReviewed | undefined {
  const stored = readState(pr).lastReviewed;
  return isLastReviewed(stored) ? { ...stored } : undefined;
}

/**
 * Remember `iterations[toIndex]` as the point this reviewer has reached, and
 * return the stored record — the new one when it moved, the existing one when
 * it did not.
 */
export function recordLastReviewed(
  pr: string,
  iterations: Iteration[],
  toIndex: number,
): LastReviewed | undefined {
  const current = getLastReviewed(pr);
  const next = nextLastReviewed(iterations, current, toIndex, new Date().toISOString());
  if (!next) return current;
  writeState(pr, (state) => ({ ...state, lastReviewed: next }));
  return next;
}

/* ------------------------- Dashboard lists ----------------------------- */

interface PrIdentity {
  owner: string;
  name: string;
  number: number;
  title?: string;
}

function keyOf(entry: { owner: string; name: string; number: number }): string {
  return prKey({ owner: entry.owner, name: entry.name, number: entry.number });
}

function listBy<R>(
  pick: (state: ReviewState) => string | undefined,
  build: (state: ReviewState, at: string) => R,
): R[] {
  return appStorage()
    .reviewState.entries()
    .map(([, state]) => ({ state, at: pick(state) }))
    .filter((e): e is { state: ReviewState; at: string } => !!e.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map((e) => build(e.state, e.at));
}

function patchEntry(entry: PrIdentity, patch: Partial<ReviewState>): void {
  writeState(keyOf(entry), (state) => ({
    ...state,
    owner: entry.owner,
    repo: entry.name,
    number: entry.number,
    ...(entry.title ? { title: entry.title } : {}),
    ...patch,
  }));
}

let lastStamp = 0;

/** ISO timestamp strictly later than the previous one, so list order is stable. */
function stamp(): string {
  const now = Date.now();
  // A clock that jumped backwards (e.g. a test's fake timers) starts over.
  lastStamp = now < lastStamp - 1000 ? now : Math.max(now, lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

function clearField(key: string, field: 'viewedAt' | 'flaggedAt' | 'inProgressSince'): void {
  if (!appStorage().reviewState.get(key)?.[field]) return;
  writeState(key, (state) => {
    const next = { ...state };
    delete next[field];
    if (field === 'inProgressSince') delete next.inProgressTouchedAt;
    return next;
  });
}

/* --------------------------- Recent PRs -------------------------------- */

export interface RecentPr {
  owner: string;
  name: string;
  number: number;
  title?: string;
  viewedAt: string;
}

const RECENT_LIMIT = 10;

export function getRecentPrs(): RecentPr[] {
  return listBy(
    (s) => s.viewedAt,
    (s, at) => ({ owner: s.owner, name: s.repo, number: s.number, title: s.title, viewedAt: at }),
  ).slice(0, RECENT_LIMIT);
}

export function pushRecentPr(entry: RecentPr): RecentPr[] {
  patchEntry(entry, { viewedAt: entry.viewedAt });
  // Older entries fall off the list rather than accumulating.
  const all = listBy((s) => s.viewedAt, (s) => keyOf({ owner: s.owner, name: s.repo, number: s.number }));
  for (const key of all.slice(RECENT_LIMIT)) clearField(key, 'viewedAt');
  return getRecentPrs();
}

/* --------------------------- Pinned repos ------------------------------ */

/** A repository the user has bookmarked for quick PR browsing. */
export interface PinnedRepo {
  owner: string;
  name: string;
  pinnedAt: string;
}

const PINNED_KEY = 'pinnedRepos';
const pinnedSchema = z.array(z.object({ owner: z.string(), name: z.string(), pinnedAt: z.string() }));

export function getPinnedRepos(): PinnedRepo[] {
  return appStorage().prefs.get(PINNED_KEY, pinnedSchema) ?? [];
}

export function isRepoPinned(owner: string, name: string): boolean {
  return getPinnedRepos().some((r) => r.owner === owner && r.name === name);
}

/** Add a repo to the pinned list (no-op if already pinned). Newest first. */
export function addPinnedRepo(owner: string, name: string): PinnedRepo[] {
  const existing = getPinnedRepos();
  if (existing.some((r) => r.owner === owner && r.name === name)) return existing;
  const next = [{ owner, name, pinnedAt: new Date().toISOString() }, ...existing];
  appStorage().prefs.set(PINNED_KEY, next);
  return next;
}

export function removePinnedRepo(owner: string, name: string): PinnedRepo[] {
  const next = getPinnedRepos().filter((r) => !(r.owner === owner && r.name === name));
  appStorage().prefs.set(PINNED_KEY, next);
  return next;
}

/* --------------------------- Flagged PRs ------------------------------- */

/** A PR the user has flagged/starred to follow. */
export interface FlaggedPr {
  owner: string;
  name: string;
  number: number;
  title?: string;
  flaggedAt: string;
}

export function getFlaggedPrs(): FlaggedPr[] {
  return listBy(
    (s) => s.flaggedAt,
    (s, at) => ({ owner: s.owner, name: s.repo, number: s.number, title: s.title, flaggedAt: at }),
  );
}

export function isPrFlagged(owner: string, name: string, number: number): boolean {
  return !!appStorage().reviewState.get(keyOf({ owner, name, number }))?.flaggedAt;
}

/** Toggle a PR's flagged state. Returns the updated list, newest first. */
export function toggleFlaggedPr(entry: PrIdentity): FlaggedPr[] {
  if (isPrFlagged(entry.owner, entry.name, entry.number)) clearField(keyOf(entry), 'flaggedAt');
  else patchEntry(entry, { flaggedAt: stamp() });
  return getFlaggedPrs();
}

/**
 * Flag a PR if it isn't already flagged, leaving an existing flag (and its
 * original `flaggedAt`) untouched. Unlike `toggleFlaggedPr` this never unflags.
 */
export function addFlaggedPr(entry: PrIdentity): FlaggedPr[] {
  if (!isPrFlagged(entry.owner, entry.name, entry.number)) {
    patchEntry(entry, { flaggedAt: stamp() });
  }
  return getFlaggedPrs();
}

/** Unflag every PR for which `shouldRemove` returns true. Returns the resulting list. */
export function pruneFlaggedPrs(shouldRemove: (pr: FlaggedPr) => boolean): FlaggedPr[] {
  for (const pr of getFlaggedPrs()) {
    if (shouldRemove(pr)) clearField(keyOf(pr), 'flaggedAt');
  }
  return getFlaggedPrs();
}

/* ------------------------ In-progress reviews -------------------------- */

/**
 * A PR the reviewer has opened but not yet finished reviewing. Populated
 * automatically when a PR is loaded and cleared when the reviewer submits an
 * Approve or Request-changes vote.
 */
export interface InProgressReview {
  owner: string;
  name: string;
  number: number;
  title?: string;
  startedAt: string;
}

/**
 * How long a tracked in-progress review survives before it is dropped, so
 * reviews finished elsewhere don't sit in "Needs your attention" forever.
 */
export const IN_PROGRESS_MAX_AGE_DAYS = 14;

const IN_PROGRESS_LIMIT = 30;

/**
 * True once an entry has aged out. A missing or unparseable `startedAt` is
 * treated as fresh, so a malformed record is never silently discarded.
 */
export function isInProgressExpired(
  entry: { startedAt?: string },
  now: number,
  maxAgeDays = IN_PROGRESS_MAX_AGE_DAYS,
): boolean {
  if (!entry.startedAt) return false;
  const started = Date.parse(entry.startedAt);
  if (Number.isNaN(started)) return false;
  return now - started > maxAgeDays * 24 * 60 * 60 * 1000;
}

/** Tracked in-progress reviews, newest first, dropping any that have aged out. */
export function getInProgressReviews(): InProgressReview[] {
  const all = listBy(
    (s) => (s.inProgressSince ? s.inProgressTouchedAt ?? s.inProgressSince : undefined),
    (s) => ({ owner: s.owner, name: s.repo, number: s.number, title: s.title, startedAt: s.inProgressSince ?? '' }),
  );
  const now = Date.now();
  const fresh: InProgressReview[] = [];
  for (const entry of all) {
    if (isInProgressExpired(entry, now) || fresh.length >= IN_PROGRESS_LIMIT) {
      clearField(keyOf(entry), 'inProgressSince');
    } else {
      fresh.push(entry);
    }
  }
  return fresh;
}

/** Record that the user is reviewing a PR, keeping the original start time. */
export function addInProgressReview(entry: PrIdentity): InProgressReview[] {
  const existing = appStorage().reviewState.get(keyOf(entry))?.inProgressSince;
  const now = stamp();
  patchEntry(entry, { inProgressSince: existing ?? now, inProgressTouchedAt: now });
  return getInProgressReviews();
}

export function removeInProgressReview(owner: string, name: string, number: number): InProgressReview[] {
  clearField(keyOf({ owner, name, number }), 'inProgressSince');
  return getInProgressReviews();
}
