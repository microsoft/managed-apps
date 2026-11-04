import type { z } from 'zod';
import { ConflictError, NotFoundError, QuotaExceededError, StorageUnavailableError, ValidationError } from '../errors';
import { stripMeta } from '../meta';
import { queryRecords } from '../query';
import type {
  Capabilities,
  Collection,
  CollectionDefinition,
  CreateOptions,
  ImportOptions,
  KeyValueStore,
  ListOptions,
  Stored,
  StorageProvider,
  StorageSnapshot,
  StorageWarningHandler,
  WriteOptions,
} from '../types';

/** The subset of the Web Storage API the provider needs. */
export interface WebStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WebStorageProviderOptions {
  /** Backing store, e.g. `window.localStorage` or a `MemoryStorage`. */
  storage: WebStorageLike;
  /** Key prefix that isolates this app's data from other apps on the same origin. */
  prefix: string;
  id?: string;
  /** Receives non-fatal problems such as quarantined records. */
  onWarning?: StorageWarningHandler;
  /** Source of `storage` events for cross-tab updates (pass `window` for localStorage). */
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  now?: () => Date;
  newId?: () => string;
}

interface CollectionBlob {
  formatVersion: 1;
  items: Record<string, Stored<unknown>>;
}

const LOCAL_CAPABILITIES: Capabilities = { shared: false, concurrency: 'version', serverFilter: false };

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

/**
 * Provider over any Web Storage-compatible store. Data is browser-local:
 * `capabilities.shared` is false and the UI should say so.
 */
export function createWebStorageProvider(options: WebStorageProviderOptions): StorageProvider {
  const { storage, prefix } = options;
  const warn: StorageWarningHandler = options.onWarning ?? (() => {});
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? defaultId;

  const collectionKey = (name: string) => `${prefix}:c:${name}`;
  const quarantineKey = (name: string) => `${prefix}:quarantine:${name}`;
  const kvPrefix = (namespace: string) => `${prefix}:kv:${namespace}:`;

  const collectionListeners = new Map<string, Set<() => void>>();
  const kvListeners = new Map<string, Set<(key: string) => void>>();
  const definitions = new Map<string, CollectionDefinition<unknown>>();

  function emitCollection(name: string): void {
    collectionListeners.get(name)?.forEach((listener) => listener());
  }
  function emitKv(namespace: string, key: string): void {
    kvListeners.get(namespace)?.forEach((listener) => listener(key));
  }

  options.eventTarget?.addEventListener('storage', (event: Event) => {
    const key = (event as StorageEvent).key;
    if (!key || !key.startsWith(`${prefix}:`)) return;
    const rest = key.slice(prefix.length + 1);
    if (rest.startsWith('c:')) emitCollection(rest.slice(2));
    if (rest.startsWith('kv:')) {
      const [namespace, ...keyParts] = rest.slice(3).split(':');
      emitKv(namespace, keyParts.join(':'));
    }
  });

  function readRaw(key: string): string | null {
    try {
      return storage.getItem(key);
    } catch (error) {
      throw new StorageUnavailableError('Browser storage is unavailable.', { cause: error });
    }
  }

  function writeRaw(key: string, value: string): void {
    try {
      storage.setItem(key, value);
    } catch (error) {
      if (isQuotaError(error)) throw new QuotaExceededError({ cause: error });
      throw new StorageUnavailableError('Browser storage is unavailable.', { cause: error });
    }
  }

  function readBlob(name: string): CollectionBlob {
    const raw = readRaw(collectionKey(name));
    if (!raw) return { formatVersion: 1, items: {} };
    try {
      const parsed = JSON.parse(raw) as CollectionBlob;
      if (parsed && typeof parsed === 'object' && parsed.items && typeof parsed.items === 'object') return parsed;
    } catch {
      // fall through to quarantine
    }
    writeRaw(quarantineKey(name), raw);
    warn(`Stored data for "${name}" was unreadable and has been set aside.`);
    return { formatVersion: 1, items: {} };
  }

  function writeBlob(name: string, blob: CollectionBlob): void {
    writeRaw(collectionKey(name), JSON.stringify(blob));
  }

  function readQuarantine(name: string): unknown[] {
    const raw = readRaw(quarantineKey(name));
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function quarantine(name: string, record: unknown, issues: unknown): void {
    const bucket = readQuarantine(name);
    bucket.push(record);
    writeRaw(quarantineKey(name), JSON.stringify(bucket));
    warn(`A record in "${name}" did not match its schema and was set aside.`, issues);
  }

  function collection<T>(definition: CollectionDefinition<T>): Collection<T> {
    const { name, schema } = definition;
    definitions.set(name, definition as CollectionDefinition<unknown>);

    function parseData(data: unknown): T {
      const result = schema.safeParse(data);
      if (!result.success) throw new ValidationError(name, result.error.issues);
      return result.data;
    }

    /** Reads and validates every record, quarantining any that no longer fit the schema. */
    function readValid(): { blob: CollectionBlob; records: Map<string, Stored<T>> } {
      const blob = readBlob(name);
      const records = new Map<string, Stored<T>>();
      let dirty = false;
      for (const [id, raw] of Object.entries(blob.items)) {
        const meta = raw as Stored<unknown>;
        const result = schema.safeParse(stripMeta(raw));
        if (!result.success || typeof meta.version !== 'string') {
          quarantine(name, raw, result.success ? 'missing version' : result.error.issues);
          delete blob.items[id];
          dirty = true;
          continue;
        }
        records.set(id, { ...result.data, id, version: meta.version, createdAt: meta.createdAt, updatedAt: meta.updatedAt });
      }
      if (dirty) writeBlob(name, blob);
      return { blob, records };
    }

    function nextVersion(previous?: string): string {
      const n = previous ? Number.parseInt(previous, 10) : 0;
      return String((Number.isFinite(n) ? n : 0) + 1);
    }

    function save(blob: CollectionBlob, record: Stored<T>): Stored<T> {
      blob.items[record.id] = record as Stored<unknown>;
      writeBlob(name, blob);
      emitCollection(name);
      return { ...record };
    }

    function checkVersion(existing: Stored<T> | undefined, id: string, options?: WriteOptions): void {
      if (options?.ifVersion === undefined) return;
      if (!existing || existing.version !== options.ifVersion) throw new ConflictError(name, id);
    }

    return {
      name,
      async list(options?: ListOptions<T>) {
        return queryRecords([...readValid().records.values()], options);
      },
      async listAll(options?: Omit<ListOptions<T>, 'cursor'>) {
        const all = [...readValid().records.values()];
        return queryRecords(all, { ...options, limit: Math.max(all.length, 1) }).items;
      },
      async get(id: string) {
        const record = readValid().records.get(id);
        return record ? { ...record } : undefined;
      },
      async create(data: T, options?: CreateOptions) {
        const parsed = parseData(data);
        const { blob, records } = readValid();
        const id = options?.id ?? newId();
        if (records.has(id)) throw new ConflictError(name, id);
        const timestamp = now().toISOString();
        return save(blob, { ...parsed, id, version: nextVersion(), createdAt: timestamp, updatedAt: timestamp });
      },
      async update(id: string, patch: Partial<T>, options?: WriteOptions) {
        const { blob, records } = readValid();
        const existing = records.get(id);
        if (!existing) {
          if (options?.ifVersion !== undefined) throw new ConflictError(name, id);
          throw new NotFoundError(name, id);
        }
        checkVersion(existing, id, options);
        const merged = parseData({ ...stripMeta(existing), ...patch });
        return save(blob, {
          ...merged,
          id,
          version: nextVersion(existing.version),
          createdAt: existing.createdAt,
          updatedAt: now().toISOString(),
        });
      },
      async put(id: string, data: T, options?: WriteOptions) {
        const parsed = parseData(data);
        const { blob, records } = readValid();
        const existing = records.get(id);
        checkVersion(existing, id, options);
        const timestamp = now().toISOString();
        return save(blob, {
          ...parsed,
          id,
          version: nextVersion(existing?.version),
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        });
      },
      async delete(id: string, options?: WriteOptions) {
        const { blob, records } = readValid();
        const existing = records.get(id);
        checkVersion(existing, id, options);
        if (!existing) return;
        delete blob.items[id];
        writeBlob(name, blob);
        emitCollection(name);
      },
      subscribe(listener: () => void) {
        const set = collectionListeners.get(name) ?? new Set();
        set.add(listener);
        collectionListeners.set(name, set);
        return () => set.delete(listener);
      },
    };
  }

  function kv(namespace: string): KeyValueStore {
    const keyPrefix = kvPrefix(namespace);
    return {
      namespace,
      ready: () => Promise.resolve(),
      get<V>(key: string, schema: z.ZodType<V>): V | undefined {
        const raw = readRaw(keyPrefix + key);
        if (raw === null) return undefined;
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          warn(`Stored value "${namespace}:${key}" was unreadable and was ignored.`);
          return undefined;
        }
        const result = schema.safeParse(value);
        if (!result.success) {
          warn(`Stored value "${namespace}:${key}" did not match its schema and was ignored.`, result.error.issues);
          return undefined;
        }
        return result.data;
      },
      set<V>(key: string, value: V): void {
        writeRaw(keyPrefix + key, JSON.stringify(value));
        emitKv(namespace, key);
      },
      remove(key: string): void {
        try {
          storage.removeItem(keyPrefix + key);
        } catch (error) {
          throw new StorageUnavailableError('Browser storage is unavailable.', { cause: error });
        }
        emitKv(namespace, key);
      },
      keys(): string[] {
        const result: string[] = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key?.startsWith(keyPrefix)) result.push(key.slice(keyPrefix.length));
        }
        return result;
      },
      subscribe(listener: (key: string) => void) {
        const set = kvListeners.get(namespace) ?? new Set();
        set.add(listener);
        kvListeners.set(namespace, set);
        return () => set.delete(listener);
      },
    };
  }

  function allKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(`${prefix}:`)) keys.push(key);
    }
    return keys;
  }

  return {
    id: options.id ?? 'local',
    capabilities: LOCAL_CAPABILITIES,
    collection,
    kv,
    async exportAll(): Promise<StorageSnapshot> {
      const snapshot: StorageSnapshot = {
        format: 'app-storage-snapshot',
        formatVersion: 1,
        exportedAt: now().toISOString(),
        collections: {},
        kv: {},
      };
      for (const key of allKeys()) {
        const rest = key.slice(prefix.length + 1);
        if (rest.startsWith('c:')) {
          const name = rest.slice(2);
          const definition = definitions.get(name);
          snapshot.collections[name] = definition
            ? await collection(definition).listAll()
            : Object.values(readBlob(name).items);
        } else if (rest.startsWith('kv:')) {
          const [namespace, ...keyParts] = rest.slice(3).split(':');
          const raw = readRaw(key);
          if (raw === null) continue;
          try {
            (snapshot.kv[namespace] ??= {})[keyParts.join(':')] = JSON.parse(raw);
          } catch {
            warn(`Skipped unreadable value "${rest}" during export.`);
          }
        }
      }
      return snapshot;
    },
    async importAll(snapshot: StorageSnapshot, importOptions?: ImportOptions): Promise<void> {
      if (snapshot?.format !== 'app-storage-snapshot' || snapshot.formatVersion !== 1) {
        throw new ValidationError('snapshot', 'format', 'The file is not a data export from this app.');
      }
      const replace = importOptions?.mode === 'replace';
      for (const [name, records] of Object.entries(snapshot.collections)) {
        const definition = definitions.get(name);
        const blob: CollectionBlob = replace ? { formatVersion: 1, items: {} } : readBlob(name);
        for (const record of records) {
          if (!record || typeof record.id !== 'string') continue;
          if (definition) {
            const { id, version, createdAt, updatedAt, ...data } = record as Stored<Record<string, unknown>>;
            const result = definition.schema.safeParse(data);
            if (!result.success) {
              quarantine(name, record, result.error.issues);
              continue;
            }
            blob.items[id] = { ...(result.data as object), id, version: version ?? '1', createdAt, updatedAt };
          } else {
            blob.items[record.id] = record;
          }
        }
        writeBlob(name, blob);
        emitCollection(name);
      }
      for (const [namespace, values] of Object.entries(snapshot.kv)) {
        const store = kv(namespace);
        if (replace) store.keys().forEach((key) => store.remove(key));
        for (const [key, value] of Object.entries(values)) store.set(key, value);
      }
    },
  };
}
