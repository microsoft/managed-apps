import { useEffect } from 'react';
import { useQueryClient, type MutationOptions, type QueryClient } from '@tanstack/react-query';
import { KeyedQueue, OptimisticLane, reasonOf } from './optimistic';
import type { AppStorage } from '../storage';
import { useAppStorage } from '../storage/useAppStorage';
import {
  editSessionDetails,
  refreshSessionsWhenIdle,
  sessionMutationKey,
  sessionsKey,
  type MutationOutcome,
  type SessionDetails,
  type SessionRecord,
} from './sessions';
import { useToast, type ShowToast } from './toast';

export { refreshSessionsWhenIdle, sessionMutationKey };

/**
 * Optimistic session writes. Only detail edits (title, description, presenters) are optimistic:
 * claims, releases, date moves, cancel and restore depend on conflict checks against fresh data.
 */
export class SessionActions {
  private readonly client: QueryClient;
  private readonly storage: AppStorage;
  private readonly lane = new OptimisticLane<SessionRecord>();
  private readonly queue = new KeyedQueue();
  private toast: ShowToast = () => {};

  constructor(client: QueryClient, storage: AppStorage) {
    this.client = client;
    this.storage = storage;
  }

  configure(deps: { toast: ShowToast }): void {
    this.toast = deps.toast;
  }

  private find(id: string): SessionRecord | undefined {
    return this.client.getQueryData<SessionRecord[]>(sessionsKey)?.find((r) => r.itemId === id);
  }

  private put(record: SessionRecord): void {
    this.client.setQueryData<SessionRecord[]>(sessionsKey, (list) =>
      list?.map((r) => (r.itemId === record.itemId ? record : r)),
    );
  }

  private run<TVars, TData>(options: MutationOptions<TData, Error, TVars>, variables: TVars): Promise<TData | undefined> {
    return this.client
      .getMutationCache()
      .build(this.client, options)
      .execute(variables)
      .catch(() => undefined);
  }

  /**
   * Title, description and presenters only; the write takes everything else from the stored item.
   * Date or topic changes go through updateSession, since those can be refused.
   */
  editDetails(record: SessionRecord, input: SessionDetails): Promise<unknown> {
    const id = record.itemId;
    const start = this.find(id) ?? record;
    this.lane.begin(id, start);
    const details: SessionDetails = { name: input.name, description: input.description, presenters: input.presenters };

    return this.run<SessionDetails, MutationOutcome>(
      {
        mutationKey: [...sessionMutationKey, 'edit'],
        onMutate: async () => {
          await this.client.cancelQueries({ queryKey: sessionsKey });
          this.put({ ...(this.find(id) ?? start), ...details });
        },
        mutationFn: () => this.queue.run(`session:${id}`, () => editSessionDetails(this.storage, id, details)),
        onSuccess: (outcome) => {
          if (outcome.record) this.lane.confirm(id, outcome.record);
          if (outcome.warning) this.toast({ tone: 'error', message: outcome.warning });
        },
        onSettled: (_outcome, error) => {
          const { last, settled } = this.lane.end(id);
          if (last && settled) this.put(settled);
          if (error) {
            this.toast({
              tone: 'error',
              message: `Changes to “${details.name}” didn’t save, so they were undone. ${reasonOf(error)}`,
              action: { label: 'Retry', onAction: () => void this.editDetails(this.find(id) ?? start, details) },
            });
          }
          refreshSessionsWhenIdle(this.client, 1);
        },
      },
      details,
    );
  }
}

const instances = new WeakMap<QueryClient, WeakMap<AppStorage, SessionActions>>();

export function sessionActions(client: QueryClient, storage: AppStorage): SessionActions {
  let byStorage = instances.get(client);
  if (!byStorage) {
    byStorage = new WeakMap();
    instances.set(client, byStorage);
  }
  let actions = byStorage.get(storage);
  if (!actions) {
    actions = new SessionActions(client, storage);
    byStorage.set(storage, actions);
  }
  return actions;
}

export function useSessionActions(): SessionActions {
  const client = useQueryClient();
  const storage = useAppStorage();
  const toast = useToast();
  const actions = sessionActions(client, storage);
  useEffect(() => {
    actions.configure({ toast });
  }, [actions, toast]);
  return actions;
}
