import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { config } from '../config';
import type { AppStorage } from '../storage';
import type { SessionData } from '../storage/collections';
import type { Stored } from '../storage/core';
import { useCollectionChanges } from '../storage/core/hooks';
import { editRecord, SkipEdit } from '../storage/edit';
import { useAppStorage } from '../storage/useAppStorage';
import { errorMessage, storageError } from './format';
import type { Presenter } from './pastSessions';
import { linkTopic, moveTopic, topicIdsLinkedTo, topicLinkBlocker, unlinkTopic } from './topics';
import { addDays, formatWeekdayDate, seriesDateKey, seriesWallTime, weekdayOf } from './time';

export type SessionStatus = 'claimed' | 'cancelled';

export interface SessionRecord {
  itemId: string;
  createdTime: string;
  /** Calendar date (yyyy-mm-dd) in the series time zone. */
  key: string;
  status: SessionStatus;
  name: string;
  description: string;
  presenters: Presenter[];
  /** User id of whoever signed up. */
  ownerId: string;
  topicId: string;
}

export type SlotState = 'open' | 'claimed' | 'cancelled';

export interface Slot {
  key: string;
  state: SlotState;
  record?: SessionRecord;
  holiday?: string;
  onCadence: boolean;
}

export interface SessionDraft {
  key: string;
  name: string;
  description: string;
  presenters: Presenter[];
  topicId: string;
}

/** The fields a details-only edit may write. */
export type SessionDetails = Pick<SessionDraft, 'name' | 'description' | 'presenters'>;

/** The person who signs up for a session. */
export interface Owner {
  id: string;
  name: string;
}

export const sessionsKey = ['sessions'] as const;

/** Every optimistic session write carries this key prefix, so refetches can wait for them. */
export const sessionMutationKey = ['sessions', 'write'] as const;

/** Refetch sessions only when no optimistic session write is in flight (self = 1 from its own onSettled). */
export function refreshSessionsWhenIdle(client: QueryClient, self = 0): void {
  if (client.isMutating({ mutationKey: sessionMutationKey }) <= self) {
    void client.invalidateQueries({ queryKey: sessionsKey });
  }
}

export const HOLIDAY_WEEKS: Record<string, string> = Object.fromEntries(config.skipDates.map((d) => [d, 'Holiday week']));

export const SESSION_TIME = { start: config.startTime, end: config.endTime };

export function sessionStart(key: string): Date {
  return seriesWallTime(key, config.startTime);
}

export function sessionEnd(key: string): Date {
  return seriesWallTime(key, config.endTime);
}

export function isOver(key: string, now: Date): boolean {
  return now.getTime() >= sessionEnd(key).getTime();
}

function dedupePresenters(presenters: Presenter[]): Presenter[] {
  const seen = new Set<string>();
  const out: Presenter[] = [];
  for (const p of presenters) {
    const name = p.name.trim();
    const id = p.id.trim();
    if (!id && !name) continue;
    const key = id || `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, name });
  }
  return out;
}

export function toSessionRecord(r: Stored<SessionData>): SessionRecord {
  return {
    itemId: r.id,
    createdTime: r.createdAt,
    key: r.date,
    status: r.status,
    name: r.name,
    description: r.description,
    presenters: r.presenters,
    ownerId: r.ownerId,
    topicId: r.topicId,
  };
}

export async function fetchSessions(storage: AppStorage): Promise<SessionRecord[]> {
  try {
    return (await storage.sessions.listAll()).map(toSessionRecord);
  } catch (error) {
    throw storageError('Couldn’t load sessions', error);
  }
}

export function useSessionRecords() {
  const storage = useAppStorage();
  const client = useQueryClient();
  useCollectionChanges(storage.sessions, () => refreshSessionsWhenIdle(client));
  return useQuery({ queryKey: sessionsKey, queryFn: () => fetchSessions(storage), staleTime: 30_000 });
}

function byCreated(a: SessionRecord, b: SessionRecord): number {
  return Date.parse(a.createdTime) - Date.parse(b.createdTime) || a.itemId.localeCompare(b.itemId);
}

/** The winning claimed record (earliest created) and any cancelled record for one date. */
export function activeFor(records: SessionRecord[], key: string): { claimed?: SessionRecord; cancelled?: SessionRecord } {
  const forDate = records.filter((r) => r.key === key);
  const claimed = forDate.filter((r) => r.status === 'claimed').sort(byCreated)[0];
  const cancelled = forDate.filter((r) => r.status === 'cancelled').sort(byCreated)[0];
  return { claimed, cancelled };
}

/** Safety cap when the series has an explicit end date. */
const MAX_SLOTS = 104;

/** Series dates from today through the series end (or `weeksAhead` weeks). Today counts until the session ends. */
export function cadenceDates(now: Date, max = config.endDate ? MAX_SLOTS : config.weeksAhead): string[] {
  const today = seriesDateKey(now);
  let key = addDays(today, (config.weekday - weekdayOf(today) + 7) % 7);
  if (isOver(key, now)) key = addDays(key, 7);
  const out: string[] = [];
  while ((!config.endDate || key <= config.endDate) && out.length < max) {
    out.push(key);
    key = addDays(key, 7);
  }
  return out;
}

function slotFor(records: SessionRecord[], key: string, onCadence: boolean): Slot {
  const { claimed, cancelled } = activeFor(records, key);
  const holiday = HOLIDAY_WEEKS[key];
  if (claimed) return { key, state: 'claimed', record: claimed, holiday, onCadence };
  if (cancelled) return { key, state: 'cancelled', record: cancelled, holiday, onCadence };
  return { key, state: 'open', holiday, onCadence };
}

/** Upcoming slots: cadence dates merged with stored records by date. */
export function buildSlots(records: SessionRecord[], now: Date, max?: number): Slot[] {
  const cadence = cadenceDates(now, max);
  const keys = new Set(cadence);
  const extra = new Set<string>();
  for (const r of records) {
    if (!keys.has(r.key) && !isOver(r.key, now)) extra.add(r.key);
  }
  return [...cadence.map((k) => slotFor(records, k, true)), ...[...extra].map((k) => slotFor(records, k, false))].sort(
    (a, b) => a.key.localeCompare(b.key),
  );
}

/** Claimed sessions that have ended but have no past-session record yet. */
export function pastStateSessions(records: SessionRecord[], now: Date, recorded: Set<string>): SessionRecord[] {
  const keys = new Set(records.filter((r) => isOver(r.key, now) && !recorded.has(r.key)).map((r) => r.key));
  return [...keys]
    .map((k) => activeFor(records, k).claimed)
    .filter((r): r is SessionRecord => !!r)
    .sort((a, b) => b.key.localeCompare(a.key));
}

/** True when the signed-in user signed up for or presents this session. */
export function isMineSession(record: SessionRecord, isMe: (id: string) => boolean): boolean {
  return isMe(record.ownerId) || record.presenters.some((p) => isMe(p.id));
}

export function nextOpenDate(slots: Slot[], exclude?: string): string | undefined {
  return slots.find((s) => s.state === 'open' && s.key !== exclude)?.key;
}

export class ClaimConflictError extends Error {
  readonly key: string;
  readonly records: SessionRecord[];
  constructor(message: string, key: string, records: SessionRecord[]) {
    super(message);
    this.name = 'ClaimConflictError';
    this.key = key;
    this.records = records;
  }
}

export interface MutationOutcome {
  record?: SessionRecord;
  /** A follow-up step (topic link, verification) failed after the main change saved. */
  warning?: string;
}

/** The topic picked for a claim or edit can't be linked; nothing was saved, so the draft stays. */
export class TopicUnavailableError extends Error {
  constructor(reason: string) {
    super(`${reason}. Pick another topic, or none.`);
    this.name = 'TopicUnavailableError';
  }
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * True when `record` is the live session for its date: claimed, and no other claimed record shares
 * the date. Only the live session owns the topics linked to that date (topic.sessionRef).
 */
function ownsDate(records: SessionRecord[], record: SessionRecord): boolean {
  return (
    record.status === 'claimed' &&
    !records.some((r) => r.key === record.key && r.status === 'claimed' && r.itemId !== record.itemId)
  );
}

async function reopenTopics(storage: AppStorage, ids: Iterable<string>, key: string): Promise<string[]> {
  const problems: string[] = [];
  for (const id of new Set([...ids].filter(Boolean))) {
    try {
      await unlinkTopic(storage, id, key);
    } catch (error) {
      problems.push(errorMessage(error));
    }
  }
  return problems;
}

async function editSession(
  storage: AppStorage,
  id: string,
  change: (current: Stored<SessionData>) => Partial<SessionData>,
  action: string,
) {
  try {
    return await editRecord(storage.sessions, id, change);
  } catch (error) {
    throw storageError(action, error);
  }
}

/** Sets session.topicId only if the session has no primary topic yet. */
export async function adoptPrimaryTopic(storage: AppStorage, record: SessionRecord, topicId: string): Promise<void> {
  await editSession(
    storage,
    record.itemId,
    (current) => {
      if (current.topicId) throw new SkipEdit();
      return { topicId };
    },
    'Couldn’t update the session’s topic',
  );
}

/** Clears session.topicId only if it still points at `topicId`. */
export async function dropPrimaryTopic(storage: AppStorage, record: Pick<SessionRecord, 'itemId'>, topicId: string): Promise<void> {
  await editSession(
    storage,
    record.itemId,
    (current) => {
      if (current.topicId !== topicId) throw new SkipEdit();
      return { topicId: '' };
    },
    'Couldn’t update the session’s topic',
  );
}

/**
 * Links a session's primary topic after the session itself saved. If the topic was linked elsewhere
 * in the meantime it is left alone and session.topicId is cleared. Returns a problem sentence or undefined.
 */
async function linkPrimaryTopic(
  storage: AppStorage,
  itemId: string,
  key: string,
  topicId: string,
  verb = 'linked',
): Promise<string | undefined> {
  try {
    const result = await linkTopic(storage, topicId, key);
    if (result.linked) return undefined;
    let stale = false;
    try {
      await dropPrimaryTopic(storage, { itemId }, topicId);
    } catch {
      stale = true;
    }
    return `${result.reason}, so it wasn’t ${verb}${stale ? ' (the session still lists it)' : ''}.`;
  } catch (error) {
    return `The topic wasn’t ${verb}. ${errorMessage(error)}`;
  }
}

/**
 * Conflict-safe claim: re-check the date and the topic, create, then re-read. If two people claimed
 * at once (possible with shared providers), the earliest-created record wins and the other deletes
 * its own record.
 */
export async function claimSession(storage: AppStorage, draft: SessionDraft, owner: Owner): Promise<MutationOutcome> {
  const label = formatWeekdayDate(draft.key);
  const before = await fetchSessions(storage);
  const existing = activeFor(before, draft.key);
  if (existing.claimed) {
    throw new ClaimConflictError(`Someone already signed up for ${label}.`, draft.key, before);
  }
  if (existing.cancelled) {
    throw new ClaimConflictError(`There’s no session on ${label}.`, draft.key, before);
  }
  if (draft.topicId) {
    const blocker = await topicLinkBlocker(storage, draft.topicId, draft.key);
    if (blocker) throw new TopicUnavailableError(blocker);
  }

  let mine: SessionRecord;
  try {
    mine = toSessionRecord(
      await storage.sessions.create({
        date: draft.key,
        status: 'claimed',
        name: draft.name,
        description: draft.description,
        presenters: dedupePresenters(draft.presenters),
        ownerId: owner.id,
        topicId: draft.topicId,
      }),
    );
  } catch (error) {
    throw storageError('Couldn’t sign you up', error);
  }

  let after: SessionRecord[];
  try {
    after = await fetchSessions(storage);
  } catch (error) {
    return {
      record: mine,
      warning: `You’re signed up, but we couldn’t double-check for a simultaneous sign-up (${errorMessage(error)}).`,
    };
  }
  const contenders = [
    ...after.filter((r) => r.key === draft.key && r.status === 'claimed' && r.itemId !== mine.itemId),
    mine,
  ].sort(byCreated);
  if (contenders[0].itemId !== mine.itemId) {
    try {
      await storage.sessions.delete(mine.itemId);
    } catch {
      throw new Error(
        `Someone else signed up for ${label} at the same moment, and we couldn’t remove your duplicate. Release it from the list.`,
      );
    }
    throw new ClaimConflictError(
      `Someone else signed up for ${label} a moment before you.`,
      draft.key,
      after.filter((r) => r.itemId !== mine.itemId),
    );
  }

  if (draft.topicId) {
    const problem = await linkPrimaryTopic(storage, mine.itemId, draft.key, draft.topicId);
    if (problem) return { record: mine, warning: `You’re signed up, but ${lowerFirst(problem)}` };
  }
  return { record: mine };
}

/**
 * Writes only title, description and presenters. Date, topic, status and owner come from the
 * stored record, so a stale form can't revert a move or unlink a topic.
 */
export async function editSessionDetails(storage: AppStorage, itemId: string, details: SessionDetails): Promise<MutationOutcome> {
  const result = await editSession(
    storage,
    itemId,
    () => ({ name: details.name, description: details.description, presenters: dedupePresenters(details.presenters) }),
    'Couldn’t save the session',
  );
  if (result.status === 'missing') throw new Error('This session no longer exists. It may have been released.');
  return { record: result.status === 'updated' ? toSessionRecord(result.record) : undefined };
}

/**
 * Saves an edit made from `baseline` (the record the form started from), optionally with a new
 * date. Date and topic change only if the user changed them relative to the baseline; otherwise
 * they stay as stored, so a stale form can't undo someone else's change. A move is refused onto a
 * date with a claimed or cancelled record; every topic linked to the old date moves with it.
 */
export async function updateSession(storage: AppStorage, baseline: SessionRecord, draft: SessionDraft): Promise<MutationOutcome> {
  const fresh = await fetchSessions(storage);
  const current = fresh.find((r) => r.itemId === baseline.itemId);
  if (!current) throw new Error('This session no longer exists. It may have been released.');
  const key = draft.key !== baseline.key ? draft.key : current.key;
  const topicId = draft.topicId !== baseline.topicId ? draft.topicId : current.topicId;
  const keyChanged = key !== current.key;
  const topicChanged = topicId !== current.topicId;

  if (keyChanged) {
    const label = formatWeekdayDate(key);
    const others = fresh.filter((r) => r.key === key && r.itemId !== current.itemId);
    if (others.some((r) => r.status === 'claimed')) throw new Error(`${label} already has a session.`);
    if (others.some((r) => r.status === 'cancelled')) {
      throw new Error(`${label} is marked as no session. Restore that date first, then move this session onto it.`);
    }
  }

  const ownsOld = ownsDate(fresh, current);
  const ownsNew = current.status === 'claimed' && (keyChanged || ownsOld);
  const relink = ownsNew && !!topicId && (topicChanged || keyChanged);
  if (relink) {
    const carried = !topicChanged && ownsOld ? current.key : undefined;
    const blocker = await topicLinkBlocker(storage, topicId, key, carried);
    if (blocker) throw new TopicUnavailableError(blocker);
  }
  const moving = ownsOld && keyChanged ? await topicIdsLinkedTo(storage, current.key) : [];

  const result = await editSession(
    storage,
    current.itemId,
    () => ({
      ...(keyChanged ? { date: key } : {}),
      ...(topicChanged ? { topicId } : {}),
      name: draft.name,
      description: draft.description,
      presenters: dedupePresenters(draft.presenters),
    }),
    'Couldn’t save the session',
  );
  if (result.status === 'missing') throw new Error('This session no longer exists. It may have been released.');

  const problems: string[] = [];
  if (ownsOld && keyChanged) {
    for (const id of new Set([...moving, current.topicId].filter(Boolean))) {
      try {
        if (id === current.topicId && topicChanged) await unlinkTopic(storage, id, current.key);
        else await moveTopic(storage, id, current.key, key);
      } catch (error) {
        problems.push(errorMessage(error));
      }
    }
  } else if (ownsOld && topicChanged && current.topicId) {
    problems.push(...(await reopenTopics(storage, [current.topicId], current.key)));
  }
  if (relink) {
    const problem = await linkPrimaryTopic(storage, current.itemId, key, topicId);
    if (problem) problems.push(problem);
  }
  return {
    record: result.status === 'updated' ? toSessionRecord(result.record) : undefined,
    warning: problems.length ? `Saved, but ${lowerFirst(problems.join(' '))}` : undefined,
  };
}

/**
 * Deletes the record. Topics linked to its date reopen only if it was the live session; deleting a
 * duplicate or shadowed record leaves the live session's topics alone.
 */
export async function releaseSession(storage: AppStorage, record: SessionRecord): Promise<MutationOutcome> {
  const fresh = await fetchSessions(storage);
  const live = fresh.find((r) => r.itemId === record.itemId);
  const owns = !!live && ownsDate(fresh, live);
  const linked = owns ? await topicIdsLinkedTo(storage, record.key) : [];

  try {
    await storage.sessions.delete(record.itemId);
  } catch (error) {
    throw storageError('Couldn’t release the session', error);
  }
  const problems = owns && live ? await reopenTopics(storage, [...linked, live.topicId], live.key) : [];
  return { warning: problems.length ? `Released, but a linked topic wasn’t reopened. ${problems.join(' ')}` : undefined };
}

/** Marks a date as having no session. A claimed session keeps its details for a later restore. */
export async function cancelSlot(storage: AppStorage, slot: Slot): Promise<MutationOutcome> {
  const fresh = await fetchSessions(storage);
  const label = formatWeekdayDate(slot.key);
  if (!slot.record) {
    const now = activeFor(fresh, slot.key);
    if (now.claimed) throw new Error(`Someone signed up for ${label} in the meantime. Review it, then try again.`);
    if (now.cancelled) return {};
    try {
      await storage.sessions.create({
        date: slot.key,
        status: 'cancelled',
        name: '',
        description: '',
        presenters: [],
        ownerId: '',
        topicId: '',
      });
    } catch (error) {
      throw storageError('Couldn’t cancel the date', error);
    }
    return {};
  }

  const live = fresh.find((r) => r.itemId === slot.record?.itemId);
  if (!live) throw new Error(`The ${label} session no longer exists.`);
  if (live.status === 'cancelled') return {};
  const owns = ownsDate(fresh, live);
  const linked = owns ? await topicIdsLinkedTo(storage, live.key) : [];

  const result = await editSession(storage, live.itemId, () => ({ status: 'cancelled' }), 'Couldn’t cancel the session');
  if (result.status === 'missing') throw new Error(`The ${label} session no longer exists.`);
  const problems = owns ? await reopenTopics(storage, [...linked, live.topicId], live.key) : [];
  return { warning: problems.length ? `Cancelled, but a linked topic wasn’t reopened. ${problems.join(' ')}` : undefined };
}

/**
 * Undoes a cancellation. Records with details become claimed again and re-link only their own
 * topic, and only if it is still free; empty records are removed so the date reopens.
 */
export async function restoreSession(storage: AppStorage, record: SessionRecord): Promise<MutationOutcome> {
  const hasDetails = !!record.name || record.presenters.length > 0;
  if (!hasDetails) {
    try {
      await storage.sessions.delete(record.itemId);
    } catch (error) {
      throw storageError('Couldn’t restore the date', error);
    }
    return {};
  }
  const fresh = await fetchSessions(storage);
  if (fresh.some((r) => r.key === record.key && r.status === 'claimed' && r.itemId !== record.itemId)) {
    throw new Error(`${formatWeekdayDate(record.key)} has been claimed by someone else since it was cancelled.`);
  }
  const result = await editSession(storage, record.itemId, () => ({ status: 'claimed' }), 'Couldn’t restore the session');
  if (result.status === 'missing') throw new Error('This session no longer exists.');
  const topicId = result.status === 'updated' ? result.record.topicId : record.topicId;
  if (topicId) {
    const problem = await linkPrimaryTopic(storage, record.itemId, record.key, topicId, 're-linked');
    if (problem) return { warning: `Restored, but ${lowerFirst(problem)}` };
  }
  return {};
}
