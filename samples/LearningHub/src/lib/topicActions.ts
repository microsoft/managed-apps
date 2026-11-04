import { useEffect } from 'react';
import { useQueryClient, type MutationOptions, type QueryClient } from '@tanstack/react-query';
import { errorMessage } from './format';
import type { AppStorage } from '../storage';
import { useAppStorage } from '../storage/useAppStorage';
import { useMe, type Me } from './identity';
import { KeyedQueue, OptimisticLane, reasonOf } from './optimistic';
import { activeFor, adoptPrimaryTopic, dropPrimaryTopic, refreshSessionsWhenIdle, type SessionRecord } from './sessions';
import { formatWeekdayDate } from './time';
import { useToast, type ShowToast } from './toast';
import {
  applyVote,
  createTopic,
  deleteTopic,
  editTopic,
  refreshTopicsWhenIdle,
  setVote,
  topicMutationKey,
  topicsKey,
  type Topic,
  type TopicStatus,
} from './topics';

export { refreshTopicsWhenIdle, topicMutationKey };

export interface CreateHandlers {
  /** Runs immediately: clear the composer, highlight the temporary row. */
  onStart?: (tempId: string) => void;
  /** The server saved it; the temporary row has been replaced. */
  onCreated?: (tempId: string, topic: Topic) => void;
  /** The create failed and the temporary row was removed. */
  onFailed?: (input: { name: string; details: string }) => void;
}

type TopicPatch = { status?: TopicStatus; sessionRef?: string };

const STATUS_LABEL: Record<TopicStatus, string> = { open: 'Open', scheduled: 'Scheduled', covered: 'Covered' };

function describePatch(name: string, patch: TopicPatch): string {
  if (patch.sessionRef !== undefined) {
    return patch.sessionRef ? `Linking “${name}” to ${formatWeekdayDate(patch.sessionRef)}` : `Unlinking “${name}”`;
  }
  return `Changing “${name}” to ${STATUS_LABEL[patch.status ?? 'open']}`;
}

/**
 * Optimistic topic writes: votes, creates, status/link edits and deletes. One instance per QueryClient,
 * so every component shares the same per-topic queue and bookkeeping.
 */
export class TopicActions {
  private readonly client: QueryClient;
  private readonly storage: AppStorage;
  private readonly lane = new OptimisticLane<Topic>();
  private readonly queue = new KeyedQueue();
  private me: Me | undefined;
  private toast: ShowToast = () => {};
  private tempSeq = 0;

  constructor(client: QueryClient, storage: AppStorage) {
    this.client = client;
    this.storage = storage;
  }

  configure(deps: { me: Me | undefined; toast: ShowToast }): void {
    this.me = deps.me;
    this.toast = deps.toast;
  }

  private find(id: string): Topic | undefined {
    return this.client.getQueryData<Topic[]>(topicsKey)?.find((t) => t.itemId === id);
  }

  private put(topic: Topic): void {
    this.client.setQueryData<Topic[]>(topicsKey, (list) => list?.map((t) => (t.itemId === topic.itemId ? topic : t)));
  }

  private run<TVars, TData>(options: MutationOptions<TData, Error, TVars>, variables: TVars): Promise<TData | undefined> {
    // Errors are handled in the options' callbacks; the returned promise never rejects.
    return this.client
      .getMutationCache()
      .build(this.client, options)
      .execute(variables)
      .catch(() => undefined);
  }

  private requireMe(action: string): Me | undefined {
    if (!this.me) this.toast({ tone: 'error', message: `Your profile hasn’t loaded, so ${action} is unavailable right now.` });
    return this.me;
  }

  /**
   * Sets (not toggles) the user's vote. The latest intent paints instantly; writes per topic run in
   * order and superseded intents are skipped, so rapid toggles always end on the last click.
   */
  vote(topic: Topic, voted: boolean): Promise<unknown> {
    const me = this.requireMe('voting');
    if (!me || topic.pending) return Promise.resolve();
    const id = topic.itemId;
    const start = this.find(id) ?? topic;
    const seq = this.lane.begin(id, start);

    return this.run<{ id: string; voted: boolean }, Topic | null>(
      {
        mutationKey: [...topicMutationKey, 'vote'],
        onMutate: async () => {
          await this.client.cancelQueries({ queryKey: topicsKey });
          if (this.lane.isLatest(id, seq)) this.put(applyVote(this.find(id) ?? start, me.id, voted));
        },
        mutationFn: () => this.queue.run(`topic:${id}`, async () => (this.lane.isLatest(id, seq) ? setVote(this.storage, id, me, voted) : null)),
        onSuccess: (server) => {
          if (server) this.lane.confirm(id, server);
        },
        onSettled: (_server, error) => {
          const { last, settled } = this.lane.end(id);
          if (last && settled) this.put(settled);
          // A failed intent that a newer click already replaced doesn't matter; only the last one does.
          if (error && last) {
            this.toast({
              tone: 'error',
              message: `${voted ? 'Your vote' : 'Removing your vote'} on “${start.name}” didn’t save, so it was undone. ${reasonOf(error)}`,
              action: { label: 'Retry', onAction: () => void this.vote(this.find(id) ?? start, voted) },
            });
          }
          refreshTopicsWhenIdle(this.client, 1);
        },
      },
      { id, voted },
    );
  }

  /**
   * Inserts a temporary row (with the requester's vote) right away, then swaps in the saved record.
   * On failure the row is removed and onFailed can put the text back.
   */
  create(input: { name: string; details: string }, handlers: CreateHandlers = {}): string | undefined {
    const me = this.requireMe('requesting topics');
    if (!me) return undefined;
    const tempId = `temp-${++this.tempSeq}`;
    const temp: Topic = {
      itemId: tempId,
      createdTime: new Date().toISOString(),
      name: input.name,
      details: input.details,
      requestedBy: me.id,
      status: 'open',
      voters: [me.id],
      voteCount: 1,
      sessionRef: '',
      pending: true,
    };
    handlers.onStart?.(tempId);

    void this.run<{ name: string; details: string }, Topic>(
      {
        mutationKey: [...topicMutationKey, 'create'],
        onMutate: async () => {
          await this.client.cancelQueries({ queryKey: topicsKey });
          this.client.setQueryData<Topic[]>(topicsKey, (list) => [temp, ...(list ?? []).filter((t) => t.itemId !== tempId)]);
        },
        mutationFn: () => createTopic(this.storage, { ...input, me }),
        onSuccess: (topic) => {
          this.client.setQueryData<Topic[]>(topicsKey, (list) => {
            // Replace the temp row in place; drop any copy a refetch already brought in.
            const rest = (list ?? []).filter((t) => t.itemId !== topic.itemId);
            const at = rest.findIndex((t) => t.itemId === tempId);
            if (at < 0) return [topic, ...rest];
            return [...rest.slice(0, at), topic, ...rest.slice(at + 1)];
          });
          handlers.onCreated?.(tempId, topic);
        },
        onError: (error) => {
          this.client.setQueryData<Topic[]>(topicsKey, (list) => list?.filter((t) => t.itemId !== tempId));
          handlers.onFailed?.(input);
          this.toast({
            tone: 'error',
            message: `“${input.name}” wasn’t added. ${reasonOf(error)}`,
            action: { label: 'Retry', onAction: () => void this.create(input, handlers) },
          });
        },
        onSettled: () => refreshTopicsWhenIdle(this.client, 1),
      },
      input,
    );
    return tempId;
  }

  /** Changes status and/or the linked session. Keeps session.topicId (the primary) consistent. */
  edit(topic: Topic, patch: TopicPatch, records: SessionRecord[]): Promise<unknown> {
    const id = topic.itemId;
    const start = this.find(id) ?? topic;
    this.lane.begin(id, start);
    const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as TopicPatch;

    return this.run<TopicPatch, { updated: Topic; warning?: string }>(
      {
        mutationKey: [...topicMutationKey, 'edit'],
        onMutate: async () => {
          await this.client.cancelQueries({ queryKey: topicsKey });
          this.put({ ...(this.find(id) ?? start), ...changes });
        },
        mutationFn: () =>
          this.queue.run(`topic:${id}`, async () => {
            const updated = await editTopic(this.storage, id, changes);
            if (changes.sessionRef === undefined) return { updated };
            // The topic saved, so a failed follow-up is a warning, not a rollback. topic.sessionRef is
            // the source of truth; session.topicId is only the primary topic.
            const problems: string[] = [];
            for (const r of records.filter((r) => r.topicId === id && r.key !== updated.sessionRef)) {
              try {
                await dropPrimaryTopic(this.storage, r, id);
              } catch (error) {
                problems.push(errorMessage(error));
              }
            }
            const next = updated.sessionRef ? activeFor(records, updated.sessionRef).claimed : undefined;
            if (next) {
              try {
                await adoptPrimaryTopic(this.storage, next, id);
              } catch (error) {
                problems.push(errorMessage(error));
              }
            }
            return {
              updated,
              warning: problems.length ? `Saved, but the session’s topic link wasn’t updated: ${problems.join(' ')}` : undefined,
            };
          }),
        onSuccess: ({ updated, warning }) => {
          this.lane.confirm(id, updated);
          if (warning) this.toast({ tone: 'error', message: warning });
        },
        onSettled: (_server, error) => {
          const { last, settled } = this.lane.end(id);
          if (last && settled) this.put(settled);
          if (error) {
            this.toast({
              tone: 'error',
              message: `${describePatch(start.name, changes)} didn’t save, so it was undone. ${reasonOf(error)}`,
              action: { label: 'Retry', onAction: () => void this.edit(this.find(id) ?? start, changes, records) },
            });
          }
          refreshTopicsWhenIdle(this.client, 1);
          if (changes.sessionRef !== undefined) refreshSessionsWhenIdle(this.client);
        },
      },
      changes,
    );
  }

  /** Deletes a topic. The row disappears at once and comes back if the delete fails. */
  remove(topic: Topic, records: SessionRecord[]): Promise<unknown> {
    const id = topic.itemId;
    const snapshot = this.find(id) ?? topic;
    const index = this.client.getQueryData<Topic[]>(topicsKey)?.findIndex((t) => t.itemId === id) ?? -1;

    return this.run<string, string | undefined>(
      {
        mutationKey: [...topicMutationKey, 'delete'],
        onMutate: async () => {
          await this.client.cancelQueries({ queryKey: topicsKey });
          this.client.setQueryData<Topic[]>(topicsKey, (list) => list?.filter((t) => t.itemId !== id));
        },
        mutationFn: () =>
          this.queue.run(`topic:${id}`, async () => {
            await deleteTopic(this.storage, id);
            // The topic is gone either way; a stale session.topicId is only worth a warning.
            const problems: string[] = [];
            for (const r of records.filter((r) => r.topicId === id)) {
              try {
                await dropPrimaryTopic(this.storage, r, id);
              } catch (error) {
                problems.push(errorMessage(error));
              }
            }
            return problems.length ? `Deleted, but a session still lists it. ${problems.join(' ')}` : undefined;
          }),
        onSuccess: (warning) => {
          this.toast({ tone: 'success', message: `Deleted “${snapshot.name}”.` });
          if (warning) this.toast({ tone: 'error', message: warning });
        },
        onError: (error) => {
          this.client.setQueryData<Topic[]>(topicsKey, (list) => {
            if (!list || list.some((t) => t.itemId === id)) return list;
            const at = index < 0 ? 0 : Math.min(index, list.length);
            return [...list.slice(0, at), snapshot, ...list.slice(at)];
          });
          this.toast({
            tone: 'error',
            message: `“${snapshot.name}” wasn’t deleted, so it’s back. ${reasonOf(error)}`,
            action: { label: 'Retry', onAction: () => void this.remove(snapshot, records) },
          });
        },
        onSettled: () => {
          refreshTopicsWhenIdle(this.client, 1);
          refreshSessionsWhenIdle(this.client);
        },
      },
      id,
    );
  }
}

const instances = new WeakMap<QueryClient, WeakMap<AppStorage, TopicActions>>();

export function topicActions(client: QueryClient, storage: AppStorage): TopicActions {
  let byStorage = instances.get(client);
  if (!byStorage) {
    byStorage = new WeakMap();
    instances.set(client, byStorage);
  }
  let actions = byStorage.get(storage);
  if (!actions) {
    actions = new TopicActions(client, storage);
    byStorage.set(storage, actions);
  }
  return actions;
}

export function useTopicActions(): TopicActions {
  const client = useQueryClient();
  const storage = useAppStorage();
  const { data: me } = useMe();
  const toast = useToast();
  const actions = topicActions(client, storage);
  useEffect(() => {
    actions.configure({ me, toast });
  }, [actions, me, toast]);
  return actions;
}
