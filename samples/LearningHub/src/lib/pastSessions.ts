import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PersonRef } from '../storage/collections';
import { useCollectionChanges } from '../storage/core/hooks';
import type { AppStorage } from '../storage';
import { useAppStorage } from '../storage/useAppStorage';
import { storageError } from './format';

export type Presenter = PersonRef;

export interface Resource {
  label: string;
  url: string;
}

export interface PastSession {
  id: string;
  date: string;
  title: string;
  presenters: Presenter[];
  recordingUrl: string | null;
  synopsis: string | null;
  tags: string[];
  resources: Resource[];
  /** Recording length; null when unknown. */
  durationSeconds: number | null;
  /** Fictional sample data seeded on first run. */
  sample: boolean;
}

export const pastSessionsKey = ['pastSessions'] as const;

/** Sessions that happened, newest first. */
export async function fetchPastSessions(storage: AppStorage): Promise<PastSession[]> {
  let records;
  try {
    records = await storage.pastSessions.listAll({ orderBy: [{ field: 'date', direction: 'desc' }] });
  } catch (error) {
    throw storageError('Couldn’t load past sessions', error);
  }
  return records.map((r) => ({
    id: r.id,
    date: r.date,
    title: r.title,
    presenters: r.presenters.filter((p) => p.id || p.name),
    recordingUrl: r.recordingUrl,
    synopsis: r.synopsis,
    tags: r.tags,
    resources: r.resources,
    durationSeconds: r.durationSeconds,
    sample: r.sample,
  }));
}

export function usePastSessions() {
  const storage = useAppStorage();
  const client = useQueryClient();
  useCollectionChanges(storage.pastSessions, () => void client.invalidateQueries({ queryKey: pastSessionsKey }));
  return useQuery({ queryKey: pastSessionsKey, queryFn: () => fetchPastSessions(storage), staleTime: 30_000 });
}

/** Every date that already has a past-session record; these dates are no longer upcoming. */
export function recordedDates(sessions: PastSession[] | undefined): Set<string> {
  return new Set((sessions ?? []).map((s) => s.date));
}

export function findPastSession(sessions: PastSession[] | undefined, idOrDate: string): PastSession | undefined {
  const list = sessions ?? [];
  return list.find((s) => s.id === idOrDate) ?? list.find((s) => s.date === idOrDate);
}
