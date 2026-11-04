import { z } from 'zod';
import type { PastSessionData } from '../storage/collections';
import type { AppStorage } from '../storage';
import { addDays, seriesDateKey, weekdayOf } from './time';

/**
 * First-run sample data: a few obviously fictional past sessions so the app isn't empty.
 * Seeded at most once per browser (a KV flag remembers it, even after removal), never into a
 * shared provider, and removable in one click.
 */

const SEEDED_FLAG = 'sampleDataSeeded';

interface SampleTemplate {
  id: string;
  weeksAgo: number;
  data: Omit<PastSessionData, 'date' | 'sample'>;
}

const SAMPLES: SampleTemplate[] = [
  {
    id: 'sample-design-system',
    weeksAgo: 1,
    data: {
      title: 'Sample: Getting started with the Contoso design system',
      presenters: [{ id: '', name: 'Avery Example' }],
      recordingUrl: 'https://example.com/recordings/design-system',
      synopsis:
        'Fictional sample session. A walkthrough of tokens, components and accessibility checks in an imaginary design system. Remove sample data from Settings when you are ready.',
      tags: ['Sample', 'Design'],
      resources: [{ label: 'Slides (example link)', url: 'https://example.com/slides/design-system' }],
      durationSeconds: 2940,
    },
  },
  {
    id: 'sample-release-notes',
    weeksAgo: 2,
    data: {
      title: 'Sample: Writing release notes people actually read',
      presenters: [
        { id: '', name: 'Jordan Sample' },
        { id: '', name: 'Riley Placeholder' },
      ],
      recordingUrl: null,
      synopsis: 'Fictional sample session from the made-up Fabrikam docs team. This one has no recording, to show how that looks.',
      tags: ['Sample', 'Writing'],
      resources: [],
      durationSeconds: null,
    },
  },
  {
    id: 'sample-data-pipeline',
    weeksAgo: 3,
    data: {
      title: 'Sample: A tour of the Contoso data pipeline',
      presenters: [{ id: '', name: 'Morgan Demo' }],
      recordingUrl: 'https://example.com/recordings/data-pipeline',
      synopsis: 'Fictional sample session. How an imaginary team moves data from ingestion to dashboards.',
      tags: ['Sample', 'Data'],
      resources: [{ label: 'Pipeline diagram (example link)', url: 'https://example.com/docs/pipeline' }],
      durationSeconds: 3300,
    },
  },
  {
    id: 'sample-accessibility',
    weeksAgo: 4,
    data: {
      title: 'Sample: Accessibility quick wins',
      presenters: [
        { id: '', name: 'Casey Fictional' },
        { id: '', name: 'Avery Example' },
      ],
      recordingUrl: 'https://example.com/recordings/accessibility',
      synopsis: 'Fictional sample session. Five small changes that make an app easier to use with a keyboard and a screen reader.',
      tags: ['Sample', 'Accessibility'],
      resources: [],
      durationSeconds: 2700,
    },
  },
];

/** The most recent series weekday strictly before `today` (yyyy-mm-dd). */
function lastSeriesDay(today: string, weekday: number): string {
  const back = (weekdayOf(today) - weekday + 7) % 7 || 7;
  return addDays(today, -back);
}

export function buildSampleSessions(now: Date, weekday: number): { id: string; data: PastSessionData }[] {
  const latest = lastSeriesDay(seriesDateKey(now), weekday);
  return SAMPLES.map((s) => ({
    id: s.id,
    data: { ...s.data, date: addDays(latest, -7 * (s.weeksAgo - 1)), sample: true },
  }));
}

export type SeedResult = 'seeded' | 'already-seeded' | 'skipped-shared' | 'skipped-not-empty' | 'disabled';

/** Seeds sample past sessions once. Safe to call on every start (and twice concurrently). */
export async function ensureSampleData(
  storage: AppStorage,
  options: { now?: Date; weekday: number; enabled?: boolean },
): Promise<SeedResult> {
  if (options.enabled === false) return 'disabled';
  if (storage.app.get(SEEDED_FLAG, z.boolean())) return 'already-seeded';
  // Never put fake records in front of other people.
  if (storage.provider.capabilities.shared) return 'skipped-shared';
  const existing = await storage.pastSessions.list({ limit: 1 });
  if (existing.items.length > 0) {
    storage.app.set(SEEDED_FLAG, true);
    return 'skipped-not-empty';
  }
  // Fixed ids + put make concurrent or repeated runs converge on the same records.
  for (const sample of buildSampleSessions(options.now ?? new Date(), options.weekday)) {
    await storage.pastSessions.put(sample.id, sample.data);
  }
  storage.app.set(SEEDED_FLAG, true);
  return 'seeded';
}

/** Deletes every sample record. The seeded flag stays, so samples never come back. */
export async function removeSampleData(storage: AppStorage): Promise<number> {
  const samples = await storage.pastSessions.listAll({ where: [{ field: 'sample', op: 'eq', value: true }] });
  for (const record of samples) await storage.pastSessions.delete(record.id);
  return samples.length;
}
