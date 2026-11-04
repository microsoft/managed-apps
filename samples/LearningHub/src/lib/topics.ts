import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AppStorage } from '../storage';
import type { TopicData } from '../storage/collections';
import type { Stored } from '../storage/core';
import { useCollectionChanges } from '../storage/core/hooks';
import { editRecord, SkipEdit } from '../storage/edit';
import { useAppStorage } from '../storage/useAppStorage';
import { storageError } from './format';
import type { Me } from './identity';
import { formatWeekdayDate } from './time';

export type TopicStatus = 'open' | 'scheduled' | 'covered';

export interface Topic {
  itemId: string;
  createdTime: string;
  name: string;
  details: string;
  /** User id of the requester. */
  requestedBy: string;
  status: TopicStatus;
  /** User ids of everyone who voted. */
  voters: string[];
  voteCount: number;
  /** Session date (yyyy-mm-dd) this topic is linked to, or '' */
  sessionRef: string;
  /** Optimistic row that hasn't been saved yet (temporary id). */
  pending?: boolean;
}

export const topicsKey = ['topics'] as const;

/** Every optimistic topic write carries this key prefix, so refetches can wait for them. */
export const topicMutationKey = ['topics', 'write'] as const;

/**
 * Refetch topics only when no optimistic topic write is in flight; an earlier refetch could
 * overwrite optimistic rows with stale data. Pass self = 1 from inside a topic write's onSettled.
 */
export function refreshTopicsWhenIdle(client: QueryClient, self = 0): void {
  if (client.isMutating({ mutationKey: topicMutationKey }) <= self) {
    void client.invalidateQueries({ queryKey: topicsKey });
  }
}

export function toTopic(r: Stored<TopicData>): Topic {
  const voters = [...new Set(r.voters.filter(Boolean))];
  return {
    itemId: r.id,
    createdTime: r.createdAt,
    name: r.name,
    details: r.details,
    requestedBy: r.requestedBy,
    status: r.status,
    voters,
    voteCount: voters.length,
    sessionRef: r.sessionRef,
  };
}

export async function fetchTopics(storage: AppStorage): Promise<Topic[]> {
  try {
    return (await storage.topics.listAll()).map(toTopic);
  } catch (error) {
    throw storageError('Couldn’t load topics', error);
  }
}

export function useTopics() {
  const storage = useAppStorage();
  const client = useQueryClient();
  useCollectionChanges(storage.topics, () => refreshTopicsWhenIdle(client));
  return useQuery({ queryKey: topicsKey, queryFn: () => fetchTopics(storage), staleTime: 30_000 });
}

export function hasVoted(topic: Topic, myId: string | undefined): boolean {
  return !!myId && topic.voters.includes(myId);
}

export function isMine(topic: Topic, myId: string | undefined): boolean {
  return !!myId && (topic.requestedBy === myId || hasVoted(topic, myId));
}

async function editTopicRecord(
  storage: AppStorage,
  id: string,
  change: (current: Stored<TopicData>) => Partial<TopicData>,
  action: string,
) {
  try {
    return await editRecord(storage.topics, id, change);
  } catch (error) {
    throw storageError(action, error);
  }
}

export async function createTopic(storage: AppStorage, input: { name: string; details: string; me: Me }): Promise<Topic> {
  try {
    const created = await storage.topics.create({
      name: input.name,
      details: input.details,
      requestedBy: input.me.id,
      status: 'open',
      voters: [input.me.id],
      sessionRef: '',
    });
    return toTopic(created);
  } catch (error) {
    throw storageError('Couldn’t add your topic', error);
  }
}

/** Sets (not toggles) the current user's vote, so retries after a conflict stay correct. */
export async function setVote(storage: AppStorage, topicId: string, me: Me, voted: boolean): Promise<Topic> {
  const action = voted ? 'Couldn’t add your vote' : 'Couldn’t remove your vote';
  const result = await editTopicRecord(
    storage,
    topicId,
    (current) => {
      const voters = current.voters.filter((v) => v !== me.id);
      if (voted) voters.push(me.id);
      return { voters };
    },
    action,
  );
  if (result.status !== 'updated') throw new Error(`${action}: that topic request was deleted.`);
  return toTopic(result.record);
}

export async function editTopic(
  storage: AppStorage,
  topicId: string,
  patch: { status?: TopicStatus; sessionRef?: string },
  action = 'Couldn’t update the topic',
): Promise<Topic> {
  const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<TopicData>;
  const result = await editTopicRecord(storage, topicId, () => changes, action);
  if (result.status !== 'updated') throw new Error(`${action}: that topic request was deleted.`);
  return toTopic(result.record);
}

/**
 * Why a topic can't be linked to `dateKey`, or null if it can. A topic is linkable only when it is
 * open and unlinked, or already linked to this same date. `alsoAllowRef` lets a session that is
 * moving dates carry its own topic along.
 */
export function linkBlocker(
  current: { name: string; status: string; sessionRef?: string },
  dateKey: string,
  alsoAllowRef?: string,
): string | null {
  const ref = current.sessionRef ?? '';
  if (ref === dateKey || (alsoAllowRef && ref === alsoAllowRef)) return null;
  if (current.status === 'open' && !ref) return null;
  if (ref) {
    const verb = current.status === 'covered' ? 'was covered on' : 'is now scheduled for';
    return `“${current.name}” ${verb} ${formatWeekdayDate(ref)}`;
  }
  return `“${current.name}” is already marked ${current.status}`;
}

/** Read-only pre-check before a claim or edit, so the user can pick another topic and keep the draft. */
export async function topicLinkBlocker(storage: AppStorage, topicId: string, dateKey: string, alsoAllowRef?: string): Promise<string | null> {
  let current;
  try {
    current = await storage.topics.get(topicId);
  } catch (error) {
    throw storageError('Couldn’t check the topic', error);
  }
  if (!current) return 'That topic request was deleted';
  return linkBlocker(current, dateKey, alsoAllowRef);
}

export type LinkResult = { linked: true; topic: Topic } | { linked: false; reason: string };

/**
 * Links a topic to a session date (status scheduled) only if it is still linkable; the check runs
 * inside the version-checked edit, so a topic linked elsewhere in the meantime is never stolen.
 */
export async function linkTopic(storage: AppStorage, topicId: string, dateKey: string): Promise<LinkResult> {
  const result = await editTopicRecord(
    storage,
    topicId,
    (current) => {
      const blocker = linkBlocker(current, dateKey);
      if (blocker) throw new SkipEdit(blocker);
      return { status: current.status === 'covered' ? 'covered' : 'scheduled', sessionRef: dateKey };
    },
    'Couldn’t link the topic',
  );
  if (result.status === 'updated') return { linked: true, topic: toTopic(result.record) };
  if (result.status === 'skipped') return { linked: false, reason: result.reason };
  return { linked: false, reason: 'That topic request was deleted' };
}

/** Returns a topic to the open list if it is still linked to `dateKey` (covered topics stay covered). */
export async function unlinkTopic(storage: AppStorage, topicId: string, dateKey: string): Promise<void> {
  await editTopicRecord(
    storage,
    topicId,
    (current) => {
      if (current.sessionRef !== dateKey || current.status === 'covered') throw new SkipEdit();
      return { status: 'open', sessionRef: '' };
    },
    'Couldn’t reopen the linked topic',
  );
}

/** Moves a topic that is still linked to `fromKey` onto `toKey` (a session changed dates). */
export async function moveTopic(storage: AppStorage, topicId: string, fromKey: string, toKey: string): Promise<void> {
  await editTopicRecord(
    storage,
    topicId,
    (current) => {
      if (current.sessionRef !== fromKey) throw new SkipEdit();
      return { sessionRef: toKey };
    },
    'Couldn’t move the linked topic',
  );
}

/** Fresh list of topic ids whose sessionRef is `dateKey` (the source of truth for a session's topics). */
export async function topicIdsLinkedTo(storage: AppStorage, dateKey: string): Promise<string[]> {
  try {
    const linked = await storage.topics.listAll({ where: [{ field: 'sessionRef', op: 'eq', value: dateKey }] });
    return linked.map((t) => t.id);
  } catch (error) {
    throw storageError('Couldn’t load topics', error);
  }
}

export async function deleteTopic(storage: AppStorage, topicId: string): Promise<void> {
  try {
    await storage.topics.delete(topicId);
  } catch (error) {
    throw storageError('Couldn’t delete the topic', error);
  }
}

/** The topic with the current user's vote set (not toggled) to `voted`. */
export function applyVote(topic: Topic, myId: string, voted: boolean): Topic {
  const voters = topic.voters.filter((v) => v !== myId);
  if (voted) voters.push(myId);
  return { ...topic, voters, voteCount: voters.length };
}

const STOP_WORDS = new Set(
  'the and for with how what why when into from about our your using use via are can does this that these those intro introduction overview deep dive session talk topic learn learning more best new'.split(
    ' ',
  ),
);

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}+#\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
  return new Set(words);
}

/** Up to `max` existing open or scheduled topics that share words with `title`. */
export function similarTopics(title: string, topics: Topic[], max = 3): Topic[] {
  const query = tokenize(title);
  if (query.size === 0) return [];
  const scored: { topic: Topic; overlap: number; jaccard: number }[] = [];
  for (const topic of topics) {
    if (topic.status === 'covered') continue;
    const words = tokenize(`${topic.name} ${topic.details}`);
    let overlap = 0;
    for (const w of query) if (words.has(w)) overlap++;
    if (overlap === 0) continue;
    const titleWords = tokenize(topic.name);
    const union = new Set([...query, ...titleWords]).size || 1;
    scored.push({ topic, overlap, jaccard: overlap / union });
  }
  return scored
    .sort((a, b) => b.overlap - a.overlap || b.jaccard - a.jaccard || b.topic.voteCount - a.topic.voteCount)
    .slice(0, max)
    .map((s) => s.topic);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}+#\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const STATUS_ORDER: Record<TopicStatus, number> = { open: 0, scheduled: 1, covered: 2 };

/**
 * Live matches for the request composer, across open, scheduled, and covered topics: the whole
 * query as a substring, plus word-prefix overlap. Title hits outweigh detail hits.
 */
export function matchTopics(query: string, topics: Topic[], max = 5): Topic[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const terms = words(q)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
  const hit = (list: string[], term: string) =>
    list.some((w) => w.startsWith(term) || (w.length >= 4 && term.startsWith(w)));

  const scored: { topic: Topic; score: number }[] = [];
  for (const topic of topics) {
    const name = topic.name.toLowerCase();
    const details = topic.details.toLowerCase();
    const nameWords = words(name);
    const detailWords = words(details);
    let score = name.includes(q) ? 6 : details.includes(q) ? 2 : 0;
    for (const term of terms) {
      if (hit(nameWords, term)) score += 3;
      else if (hit(detailWords, term)) score += 1;
    }
    if (score > 0) scored.push({ topic, score });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        STATUS_ORDER[a.topic.status] - STATUS_ORDER[b.topic.status] ||
        b.topic.voteCount - a.topic.voteCount,
    )
    .slice(0, max)
    .map((s) => s.topic);
}
