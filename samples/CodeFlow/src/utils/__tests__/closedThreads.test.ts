import { describe, it, expect } from 'vitest';
import {
  getClosedAttribution,
  getClosedThreads,
  getSharedClosed,
  setThreadClosed,
} from '../storage';
import { appStorage, prNotesCollection } from '../../storage';

const PR = 'owner/repo#1';

describe('closed thread state', () => {
  it('round-trips a close with its author', () => {
    const flags = setThreadClosed(PR, 'thread-1', true, { by: 'gh:7', login: 'ada' });

    expect(flags).toEqual({ 'thread-1': true });
    expect(getClosedThreads(PR)).toEqual({ 'thread-1': true });
    expect(getClosedAttribution(PR)['thread-1']).toMatchObject({ by: 'gh:7', login: 'ada' });
  });

  it('keeps a tombstone when a thread is reopened', () => {
    setThreadClosed(PR, 'thread-1', true, { by: 'gh:7' });
    const flags = setThreadClosed(PR, 'thread-1', false, { by: 'gh:8' });

    expect(flags).toEqual({});
    expect(getClosedThreads(PR)).toEqual({});
    // The key survives so the reopen can beat a stale copy on merge.
    expect(getSharedClosed(PR)['thread-1']).toMatchObject({ closed: false, by: 'gh:8' });
  });

  it('stores close state in the prNotes collection, not in review state', async () => {
    setThreadClosed(PR, 'thread-1', true, { by: 'gh:7' });
    const storage = appStorage();
    await storage.prNotes.flush();

    const notes = await storage.provider.collection(prNotesCollection).get(PR);
    expect(notes).toMatchObject({ owner: 'owner', repo: 'repo', number: 1 });
    expect(notes?.closedThreads['thread-1']).toMatchObject({ closed: true, by: 'gh:7' });
    expect(storage.reviewState.get(PR)).toBeUndefined();
  });

  it('tolerates a missing actor rather than refusing to close', () => {
    expect(setThreadClosed(PR, 'thread-1', true)).toEqual({ 'thread-1': true });
    expect(getClosedAttribution(PR)['thread-1'].by).toBe('');
  });
});
