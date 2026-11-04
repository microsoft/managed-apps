import type { Collection } from './core';
import { createLogger } from '../lib/logger';

const log = createLogger('storage');

/**
 * Synchronous, in-memory view of a collection with write-through persistence.
 *
 * Review state is read from inside React state updaters, so reads must be
 * synchronous. The mirror loads every record once (`ready()`), serves reads from
 * memory, and persists each change with `collection.put` — coalesced per record
 * and serialised so a burst of edits can't race itself. The provider remains the
 * store of record: changes it reports (another tab, or a shared backend after a
 * refresh) are folded back in, except for records with an unsaved local edit.
 */
export interface CollectionMirror<T> {
  readonly name: string;
  /** Loads every record. Safe to call repeatedly. */
  ready(): Promise<void>;
  get(id: string): T | undefined;
  entries(): Array<[string, T]>;
  set(id: string, value: T): void;
  remove(id: string): void;
  /** Re-reads one record (or all) from the provider. */
  refresh(id?: string): Promise<void>;
  /** Persists pending edits now. */
  flush(): Promise<void>;
  subscribe(listener: () => void): () => void;
  revision(): number;
}

export interface MirrorOptions {
  /** Delay before a change is written, so bursts coalesce into one write. */
  writeDelayMs?: number;
  onWriteError?: (error: unknown) => void;
}

export function createCollectionMirror<T>(
  collection: Collection<T>,
  options: MirrorOptions = {},
): CollectionMirror<T> {
  const delay = options.writeDelayMs ?? 250;
  const records = new Map<string, T>();
  const dirty = new Map<string, T | null>();
  const listeners = new Set<() => void>();
  let rev = 0;
  let loading: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();
  let selfWrite = false;

  function emit(): void {
    rev += 1;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        log.warn('listener failed', error);
      }
    }
  }

  function stripMeta(record: object): T {
    const { id: _id, version: _version, createdAt: _c, updatedAt: _u, ...data } = record as Record<string, unknown>;
    return data as T;
  }

  async function loadAll(): Promise<void> {
    const all = await collection.listAll();
    const seen = new Set<string>();
    for (const record of all) {
      seen.add(record.id);
      if (!dirty.has(record.id)) records.set(record.id, stripMeta(record));
    }
    for (const id of [...records.keys()]) {
      if (!seen.has(id) && !dirty.has(id)) records.delete(id);
    }
    emit();
  }

  function scheduleWrite(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void writePending();
    }, delay);
  }

  function writePending(): Promise<void> {
    const batch = [...dirty.entries()];
    dirty.clear();
    if (batch.length === 0) return writing;
    writing = writing.then(async () => {
      for (const [id, value] of batch) {
        try {
          selfWrite = true;
          const pending = value === null ? collection.delete(id) : collection.put(id, value);
          selfWrite = false;
          await pending;
        } catch (error) {
          selfWrite = false;
          log.warn(`could not save ${collection.name} record`, error);
          options.onWriteError?.(error);
        }
      }
    });
    return writing;
  }

  collection.subscribe(() => {
    if (selfWrite) return;
    void loadAll().catch((error) => log.warn(`could not reload ${collection.name}`, error));
  });

  return {
    name: collection.name,
    ready() {
      loading ??= loadAll().catch((error) => {
        loading = undefined;
        log.warn(`could not load ${collection.name}`, error);
      });
      return loading;
    },
    get(id) {
      return records.get(id);
    },
    entries() {
      return [...records.entries()];
    },
    set(id, value) {
      records.set(id, value);
      dirty.set(id, value);
      scheduleWrite();
      emit();
    },
    remove(id) {
      if (!records.has(id)) return;
      records.delete(id);
      dirty.set(id, null);
      scheduleWrite();
      emit();
    },
    async refresh(id) {
      if (id === undefined) return loadAll();
      if (dirty.has(id)) return;
      const record = await collection.get(id);
      if (dirty.has(id)) return;
      if (record) records.set(id, stripMeta(record));
      else records.delete(id);
      emit();
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      return writePending();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    revision() {
      return rev;
    },
  };
}
