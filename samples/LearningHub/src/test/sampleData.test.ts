import { describe, expect, it } from 'vitest';
import { fetchPastSessions } from '../lib/pastSessions';
import { buildSampleSessions, ensureSampleData, removeSampleData } from '../lib/sampleData';
import { weekdayOf } from '../lib/time';
import { makeStorage } from './helpers';

const NOW = new Date('2031-03-10T18:00:00Z');

describe('sample data', () => {
  it('builds obviously fictional sessions on the series weekday, in the past', () => {
    const samples = buildSampleSessions(NOW, 4);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(samples.length).toBeLessThanOrEqual(4);
    for (const { data } of samples) {
      expect(data.sample).toBe(true);
      expect(data.title.startsWith('Sample:')).toBe(true);
      expect(weekdayOf(data.date)).toBe(4);
      expect(data.date < '2031-03-10').toBe(true);
      for (const p of data.presenters) expect(p.id).toBe('');
      for (const url of [data.recordingUrl, ...data.resources.map((r) => r.url)]) {
        if (url) expect(new URL(url).hostname).toBe('example.com');
      }
    }
  });

  it('seeds once, even when called concurrently or repeatedly', async () => {
    const storage = makeStorage();
    const [a, b] = await Promise.all([
      ensureSampleData(storage, { now: NOW, weekday: 4 }),
      ensureSampleData(storage, { now: NOW, weekday: 4 }),
    ]);
    expect([a, b]).toContain('seeded');
    expect(await ensureSampleData(storage, { now: NOW, weekday: 4 })).toBe('already-seeded');
    const sessions = await fetchPastSessions(storage);
    expect(sessions).toHaveLength(buildSampleSessions(NOW, 4).length);
    expect(sessions.every((s) => s.sample)).toBe(true);
  });

  it('removes sample data in one call and never re-seeds afterwards', async () => {
    const storage = makeStorage();
    await ensureSampleData(storage, { now: NOW, weekday: 4 });
    await storage.pastSessions.create({
      date: '2031-01-02',
      title: 'A real session',
      presenters: [],
      recordingUrl: null,
      synopsis: null,
      tags: [],
      resources: [],
      durationSeconds: null,
      sample: false,
    });
    const removed = await removeSampleData(storage);
    expect(removed).toBe(buildSampleSessions(NOW, 4).length);
    expect((await fetchPastSessions(storage)).map((s) => s.title)).toEqual(['A real session']);

    expect(await ensureSampleData(storage, { now: NOW, weekday: 4 })).toBe('already-seeded');
    expect(await fetchPastSessions(storage)).toHaveLength(1);
  });

  it('does not seed into shared storage, into existing data, or when disabled', async () => {
    expect(await ensureSampleData(makeStorage({ shared: true }), { now: NOW, weekday: 4 })).toBe('skipped-shared');
    expect(await ensureSampleData(makeStorage(), { now: NOW, weekday: 4, enabled: false })).toBe('disabled');

    const storage = makeStorage();
    await storage.pastSessions.create({
      date: '2031-01-02',
      title: 'Imported',
      presenters: [],
      recordingUrl: null,
      synopsis: null,
      tags: [],
      resources: [],
      durationSeconds: null,
      sample: false,
    });
    expect(await ensureSampleData(storage, { now: NOW, weekday: 4 })).toBe('skipped-not-empty');
    expect(await fetchPastSessions(storage)).toHaveLength(1);
  });
});
