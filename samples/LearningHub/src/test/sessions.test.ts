import { describe, expect, it } from 'vitest';
import { ConflictError } from '../storage/core';
import { editRecord, SkipEdit } from '../storage/edit';
import {
  activeFor,
  buildSlots,
  cancelSlot,
  claimSession,
  ClaimConflictError,
  editSessionDetails,
  fetchSessions,
  releaseSession,
  restoreSession,
  updateSession,
  type SessionDraft,
} from '../lib/sessions';
import { createTopic, fetchTopics } from '../lib/topics';
import { ADA, BEN, makeStorage } from './helpers';

const DATE = '2031-03-06';
const OTHER_DATE = '2031-03-13';

function draft(extra: Partial<SessionDraft> = {}): SessionDraft {
  return { key: DATE, name: 'Intro to widgets', description: '', presenters: [], topicId: '', ...extra };
}

const owner = (me: typeof ADA) => ({ id: me.id, name: me.displayName });

describe('claiming sessions', () => {
  it('claims an open date and stores the owner by user id', async () => {
    const storage = makeStorage();
    const outcome = await claimSession(storage, draft({ presenters: [{ id: ADA.id, name: ADA.displayName }] }), owner(ADA));
    expect(outcome.warning).toBeUndefined();
    const [record] = await fetchSessions(storage);
    expect(record).toMatchObject({ key: DATE, status: 'claimed', ownerId: ADA.id, name: 'Intro to widgets' });
    expect(JSON.stringify(record)).not.toContain('@');
  });

  it('refuses a date someone already claimed', async () => {
    const storage = makeStorage();
    await claimSession(storage, draft(), owner(ADA));
    await expect(claimSession(storage, draft({ name: 'Other' }), owner(BEN))).rejects.toBeInstanceOf(ClaimConflictError);
  });

  it('resolves a simultaneous claim: the earliest record wins and the loser removes its own', async () => {
    const storage = makeStorage();
    const results = await Promise.allSettled([
      claimSession(storage, draft({ name: 'First' }), owner(ADA)),
      claimSession(storage, draft({ name: 'Second' }), owner(BEN)),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(ClaimConflictError);
    const records = await fetchSessions(storage);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ name: 'First', ownerId: ADA.id });
  });

  it('links the chosen topic and reopens it when the session is released', async () => {
    const storage = makeStorage();
    const topic = await createTopic(storage, { name: 'Widgets 101', details: '', me: BEN });
    const { record } = await claimSession(storage, draft({ topicId: topic.itemId }), owner(ADA));
    expect((await fetchTopics(storage))[0]).toMatchObject({ status: 'scheduled', sessionRef: DATE });

    await releaseSession(storage, record!);
    expect(await fetchSessions(storage)).toEqual([]);
    expect((await fetchTopics(storage))[0]).toMatchObject({ status: 'open', sessionRef: '' });
  });

  it('moves linked topics along when the date changes', async () => {
    const storage = makeStorage();
    const topic = await createTopic(storage, { name: 'Widgets 101', details: '', me: BEN });
    const { record } = await claimSession(storage, draft({ topicId: topic.itemId }), owner(ADA));
    await updateSession(storage, record!, draft({ key: OTHER_DATE, topicId: topic.itemId }));
    expect((await fetchSessions(storage))[0].key).toBe(OTHER_DATE);
    expect((await fetchTopics(storage))[0].sessionRef).toBe(OTHER_DATE);
  });
});

describe('cancelling and restoring dates', () => {
  it('marks an open date as no session, blocks claims, and restores it', async () => {
    const storage = makeStorage();
    const now = new Date('2031-03-01T00:00:00Z');
    const slot = buildSlots([], now).find((s) => s.key === DATE)!;
    expect(slot.state).toBe('open');

    await cancelSlot(storage, slot);
    const records = await fetchSessions(storage);
    expect(activeFor(records, DATE).cancelled).toBeDefined();
    await expect(claimSession(storage, draft(), owner(ADA))).rejects.toThrow(/no session/);

    await restoreSession(storage, activeFor(records, DATE).cancelled!);
    expect(await fetchSessions(storage)).toEqual([]);
  });

  it('cancels a claimed session but keeps its details for a restore', async () => {
    const storage = makeStorage();
    const topic = await createTopic(storage, { name: 'Widgets 101', details: '', me: BEN });
    await claimSession(storage, draft({ topicId: topic.itemId }), owner(ADA));
    const slot = buildSlots(await fetchSessions(storage), new Date('2031-03-01T00:00:00Z')).find((s) => s.key === DATE)!;

    await cancelSlot(storage, slot);
    const [cancelled] = await fetchSessions(storage);
    expect(cancelled).toMatchObject({ status: 'cancelled', name: 'Intro to widgets' });
    expect((await fetchTopics(storage))[0].status).toBe('open');

    await restoreSession(storage, cancelled);
    expect((await fetchSessions(storage))[0].status).toBe('claimed');
    expect((await fetchTopics(storage))[0]).toMatchObject({ status: 'scheduled', sessionRef: DATE });
  });
});

describe('optimistic concurrency', () => {
  it('rejects a stale write with ConflictError', async () => {
    const storage = makeStorage();
    const { record } = await claimSession(storage, draft(), owner(ADA));
    const stored = (await storage.sessions.get(record!.itemId))!;
    await storage.sessions.update(stored.id, { name: 'Changed' }, { ifVersion: stored.version });
    await expect(storage.sessions.update(stored.id, { name: 'Stale' }, { ifVersion: stored.version })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('editRecord re-reads and retries after a conflict, and honours SkipEdit', async () => {
    const storage = makeStorage();
    const { record } = await claimSession(storage, draft(), owner(ADA));
    const id = record!.itemId;
    let calls = 0;
    const result = await editRecord(storage.sessions, id, (current) => {
      calls++;
      // Another writer sneaks in during the first attempt.
      if (calls === 1) void storage.sessions.update(id, { description: 'from someone else' });
      return { name: `${current.name}!` };
    });
    expect(calls).toBe(2);
    expect(result.status).toBe('updated');
    const stored = await storage.sessions.get(id);
    expect(stored).toMatchObject({ name: 'Intro to widgets!', description: 'from someone else' });

    const skipped = await editRecord(storage.sessions, id, () => {
      throw new SkipEdit('not needed');
    });
    expect(skipped).toEqual({ status: 'skipped', reason: 'not needed' });
    expect(await editRecord(storage.sessions, 'missing', () => ({}))).toEqual({ status: 'missing' });
  });

  it('turns a persistent conflict into a readable error', async () => {
    const base = makeStorage();
    const { record } = await claimSession(base, draft(), owner(ADA));
    const storage = {
      ...base,
      sessions: { ...base.sessions, update: (id: string) => Promise.reject(new ConflictError('sessions', id)) },
    };
    await expect(editSessionDetails(storage, record!.itemId, { name: 'x', description: '', presenters: [] })).rejects.toThrow(
      /Someone else changed this/,
    );
  });
});
