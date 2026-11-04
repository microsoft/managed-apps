import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fetchPastSessions } from '../lib/pastSessions';
import { ensureSampleData } from '../lib/sampleData';
import { claimSession, fetchSessions } from '../lib/sessions';
import { createTopic, fetchTopics, setVote } from '../lib/topics';
import { createStorage, openAppStorage, providers } from '../storage';
import { allCollections } from '../storage/collections';
import { createMemoryProvider, describeCollections, readSnapshotFile, ValidationError } from '../storage/core';
import { ADA, BEN, makeStorage } from './helpers';

describe('storage setup', () => {
  it('registers the local provider and falls back to it for unknown names', () => {
    expect(Object.keys(providers)).toContain('local');
    expect(createStorage({ storageProvider: 'local' }).id).toBe('local');
    expect(createStorage({ storageProvider: 'does-not-exist' }).id).toBe('local');
    expect(createStorage({ storageProvider: 'local' }).capabilities.shared).toBe(false);
  });

  it('describes every collection for remote backends', () => {
    const described = describeCollections(allCollections);
    expect(described.map((c) => c.name)).toEqual(['sessions', 'topics', 'pastSessions']);
    for (const c of described) expect(c.schema).toMatchObject({ type: 'object' });
  });
});

describe('export and import', () => {
  it('round-trips every collection and preference into another provider', async () => {
    const source = makeStorage();
    await ensureSampleData(source, { now: new Date('2031-03-10T00:00:00Z'), weekday: 4 });
    const topic = await createTopic(source, { name: 'Accessibility', details: '', me: ADA });
    await setVote(source, topic.itemId, BEN, true);
    await claimSession(
      source,
      { key: '2031-03-13', name: 'Widgets', description: 'Hands-on', presenters: [{ id: ADA.id, name: ADA.displayName }], topicId: topic.itemId },
      { id: ADA.id, name: ADA.displayName },
    );
    source.prefs.set('theme', 'dark');

    const snapshot = await source.provider.exportAll();
    // Simulate the download/upload through a file.
    const file = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
    const restored = await readSnapshotFile(file);

    const target = openAppStorage(createMemoryProvider({ prefix: 'other' }));
    await createTopic(target, { name: 'Replaced on import', details: '', me: BEN });
    await target.provider.importAll(restored, { mode: 'replace' });

    expect(await fetchSessions(target)).toEqual(await fetchSessions(source));
    expect(await fetchTopics(target)).toEqual(await fetchTopics(source));
    expect(await fetchPastSessions(target)).toEqual(await fetchPastSessions(source));
    expect(target.prefs.get('theme', z.string())).toBe('dark');
    expect(target.app.get('sampleDataSeeded', z.boolean())).toBe(true);
  });

  it('rejects files that are not exports', async () => {
    await expect(readSnapshotFile(new Blob(['{"hello":1}']))).rejects.toBeInstanceOf(ValidationError);
    await expect(readSnapshotFile(new Blob(['not json']))).rejects.toThrow('The file is not valid JSON.');
  });
});
