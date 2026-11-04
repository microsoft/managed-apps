/**
 * Shared "closed" review state: which comment threads a *team* has marked as
 * dealt with, as opposed to the per-reviewer seen marks in `prReviewState`.
 *
 * Two things make this more than a boolean map.
 *
 * 1. **Attribution.** Every entry records who closed (or reopened) the thread
 *    and when. Provenance cannot be recovered later — once several reviewers'
 *    maps have been unioned together there is no way to work out who
 *    contributed what — so it is captured from the very first write.
 *
 * 2. **Tombstones.** Reopening records `closed: false` rather than deleting the
 *    key. The old per-user map deleted on reopen, which meant any device still
 *    holding a stale `true` re-introduced it on the next union and silently
 *    resurrected a thread the reviewer had deliberately reopened. With several
 *    reviewers writing the same document that would happen constantly, so
 *    removals have to be representable rather than implied by absence.
 *
 * Entries therefore merge last-write-wins on `at`. Timestamps come from client
 * clocks, so a badly skewed device can lose a race; that is accepted here
 * because the payload is opaque to the server and there is no server-side clock
 * to borrow. The failure mode is a stale close/reopen, not lost comments.
 */

/** Who closed or reopened a thread, and when. */
export interface ClosedEntry {
  /** Stable id of whoever acted (their GitHub login when known). */
  by: string;
  /** Display login, for "Closed by @x". */
  login?: string;
  /** ISO timestamp of the action. */
  at: string;
  /** `false` is a tombstone: explicitly reopened, not merely absent. */
  closed: boolean;
}

export type SharedClosedMap = Record<string, ClosedEntry>;

/** Timestamp used when an entry has none recorded; it loses every race. */
export const UNKNOWN_AT = '1970-01-01T00:00:00.000Z';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Coerce stored data into the current shape, dropping anything malformed. */
export function normalizeSharedClosed(raw: unknown): SharedClosedMap {
  if (!isRecord(raw)) return {};

  const out: SharedClosedMap = {};
  for (const [threadId, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    if (typeof value.closed !== 'boolean') continue;

    const entry: ClosedEntry = {
      by: typeof value.by === 'string' ? value.by : '',
      at: typeof value.at === 'string' ? value.at : UNKNOWN_AT,
      closed: value.closed,
    };
    if (typeof value.login === 'string' && value.login) entry.login = value.login;
    out[threadId] = entry;
  }
  return out;
}

/**
 * Pick the entry that should win for one thread.
 *
 * Ties break towards `closed`.
 */
function pickEntry(a: ClosedEntry, b: ClosedEntry): ClosedEntry {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  if (a.closed !== b.closed) return a.closed ? a : b;
  return a;
}

/** Merge two shared maps last-write-wins per thread. */
export function mergeSharedClosed(
  local: SharedClosedMap,
  remote: SharedClosedMap,
): SharedClosedMap {
  const out: SharedClosedMap = { ...remote };
  for (const [threadId, entry] of Object.entries(local)) {
    const existing = out[threadId];
    out[threadId] = existing ? pickEntry(entry, existing) : entry;
  }
  return out;
}

/** Record a close/reopen, replacing any previous entry for the thread. */
export function applyClosed(
  map: SharedClosedMap,
  threadId: string,
  closed: boolean,
  actor: { by: string; login?: string },
  now: () => Date = () => new Date(),
): SharedClosedMap {
  const entry: ClosedEntry = {
    by: actor.by,
    at: now().toISOString(),
    closed,
  };
  if (actor.login) entry.login = actor.login;
  return { ...map, [threadId]: entry };
}

/**
 * Collapse to the boolean map the view layer consumes. Tombstones drop out
 * here, so a reopened thread reads exactly like one that was never closed.
 */
export function closedFlags(map: SharedClosedMap): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [threadId, entry] of Object.entries(map)) {
    if (entry.closed) out[threadId] = true;
  }
  return out;
}

/** Attribution for currently-closed threads only. */
export function closedAttribution(map: SharedClosedMap): Record<string, ClosedEntry> {
  const out: Record<string, ClosedEntry> = {};
  for (const [threadId, entry] of Object.entries(map)) {
    if (entry.closed) out[threadId] = entry;
  }
  return out;
}
