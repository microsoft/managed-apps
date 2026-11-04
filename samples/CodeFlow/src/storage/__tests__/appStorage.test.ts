import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runProviderContract } from '../core/contract';
import { createLocalProvider, createMemoryProvider, describeCollections, MemoryStorage } from '../core';
import { createCollectionMirror } from '../mirror';
import {
  allCollections,
  appStorage,
  createStorage,
  reviewStateCollection,
  storageProviders,
} from '..';

// jsdom in this setup has no Web Storage; give the local provider a stand-in so the
// contract exercises its real code path rather than its in-memory fallback.
Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true });

let n = 0;
runProviderContract('local', () => createLocalProvider({ prefix: `contract-${Date.now()}-${n++}` }));

describe('createStorage', () => {
  it('defaults to the local provider and shows local mode', () => {
    const provider = createStorage({ prefix: `default-${n++}` });
    expect(provider.id).toBe('local');
    expect(provider.capabilities.shared).toBe(false);
  });

  it('builds a registered provider by id', () => {
    expect(createStorage({ provider: 'memory' }).id).toBe('memory');
    expect(Object.keys(storageProviders)).toEqual(expect.arrayContaining(['local', 'memory']));
  });

  it('explains an unknown provider id', () => {
    expect(() => createStorage({ provider: 'nope' })).toThrow(/Unknown storage provider "nope"/);
  });
});

describe('collections', () => {
  it('describes every collection for remote providers', () => {
    const described = describeCollections(allCollections);
    expect(described.map((c) => c.name)).toEqual([
      'reviewState',
      'prNotes',
      'approvals',
      'feedback',
      'feedbackComments',
    ]);
    expect(described.every((c) => typeof c.schema === 'object')).toBe(true);
  });

  it('starts tests with empty in-memory app storage', async () => {
    expect(appStorage().provider.id).toBe('memory');
    expect(await appStorage().feedback.listAll()).toEqual([]);
  });
});

describe('collection mirror', () => {
  const record = { owner: 'octo-org', repo: 'octo-repo', number: 123, seen: {}, patchHashes: {}, comments: [] };

  it('serves reads synchronously and persists writes', async () => {
    const provider = createMemoryProvider();
    const mirror = createCollectionMirror(provider.collection(reviewStateCollection), { writeDelayMs: 0 });
    await mirror.ready();
    mirror.set('octo-org/octo-repo#123', { ...record, title: 'Hello' });
    expect(mirror.get('octo-org/octo-repo#123')?.title).toBe('Hello');
    await mirror.flush();
    expect(await provider.collection(reviewStateCollection).get('octo-org/octo-repo#123')).toMatchObject({ title: 'Hello' });
  });

  it('loads existing records and picks up changes from elsewhere', async () => {
    const provider = createMemoryProvider();
    const collection = provider.collection(reviewStateCollection);
    await collection.put('a/b#1', { ...record, owner: 'a', repo: 'b', number: 1 });
    const mirror = createCollectionMirror(collection);
    await mirror.ready();
    expect(mirror.get('a/b#1')).toMatchObject({ owner: 'a' });

    const listener = vi.fn();
    mirror.subscribe(listener);
    // Another writer (tab or user) changes the record.
    await collection.put('a/b#1', { ...record, owner: 'a', repo: 'b', number: 1, title: 'Changed' });
    await vi.waitFor(() => expect(mirror.get('a/b#1')?.title).toBe('Changed'));
    expect(listener).toHaveBeenCalled();
  });

  it('reports a failed write without losing the in-memory value', async () => {
    const provider = createMemoryProvider();
    const collection = provider.collection(reviewStateCollection);
    const onWriteError = vi.fn();
    const mirror = createCollectionMirror(collection, { writeDelayMs: 0, onWriteError });
    vi.spyOn(collection, 'put').mockRejectedValue(new Error('quota'));
    mirror.set('a/b#1', { ...record, owner: 'a', repo: 'b', number: 1 });
    await mirror.flush();
    expect(onWriteError).toHaveBeenCalled();
    expect(mirror.get('a/b#1')).toBeDefined();
  });

  it('round-trips through export and import', async () => {
    const source = createMemoryProvider();
    await source.collection(reviewStateCollection).put('a/b#1', { ...record, owner: 'a', repo: 'b', number: 1 });
    source.kv('prefs').set('pinnedRepos', [{ owner: 'a', name: 'b', pinnedAt: '2026-01-01T00:00:00.000Z' }]);
    const snapshot = await source.exportAll();

    const target = createMemoryProvider();
    target.collection(reviewStateCollection);
    await target.importAll(snapshot);
    expect(await target.collection(reviewStateCollection).get('a/b#1')).toMatchObject({ owner: 'a' });
    expect(target.kv('prefs').get('pinnedRepos', z.array(z.unknown()))).toHaveLength(1);
  });
});
