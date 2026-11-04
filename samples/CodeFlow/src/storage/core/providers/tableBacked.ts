import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
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
import { createMemoryProvider } from './memory';

/**
 * One stored record as a remote backend sees it: a key, the record body serialized as JSON,
 * and backend-managed concurrency/timestamps. Mapping to SharePoint, Dataverse or SQL:
 *
 *   key        → a unique, indexed text column (e.g. "RecordKey")
 *   data       → a multi-line plain-text column holding JSON (e.g. "Data")
 *   etag       → the backend's ETag / row version
 *   createdAt  → the backend's created timestamp
 *   updatedAt  → the backend's modified timestamp
 */
export interface BackendRow {
  key: string;
  data: string;
  etag: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackendPage {
  rows: BackendRow[];
  /** Opaque continuation token (e.g. OData nextLink / skip token). */
  nextCursor?: string;
}

/**
 * The only thing a new backend has to implement — one instance per collection.
 * Throw ConflictError from `create` when the key exists and from `update`/`delete` when
 * `etag` is supplied and does not match. Throw NotFoundError from `update` when missing.
 */
export interface TableBackend {
  list(cursor?: string): Promise<BackendPage>;
  get(key: string): Promise<BackendRow | undefined>;
  create(key: string, data: string): Promise<BackendRow>;
  update(key: string, data: string, etag?: string): Promise<BackendRow>;
  delete(key: string, etag?: string): Promise<void>;
}

export interface TableBackedProviderOptions {
  /** Provider id, e.g. `sharepoint`. */
  id: string;
  /** True when the backend is visible to other users (almost always true for remote stores). */
  shared: boolean;
  /** Returns the backend for a collection, e.g. the SharePoint list with the same name. */
  tableFor: (collectionName: string) => TableBackend;
  /**
   * Key/value stores (preferences, drafts, UI state). Defaults to an in-memory store; pass a
   * local provider's `kv` to keep device preferences in the browser.
   */
  kv?: (namespace: string) => KeyValueStore;
  onWarning?: StorageWarningHandler;
  newId?: () => string;
}

export interface TableBackedProvider extends StorageProvider {
  /**
   * Notify subscribers that data may have changed remotely. Remote backends have no push
   * channel, so call this on window focus or a timer when other users share the data.
   */
  refresh(collectionName?: string): void;
}

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Builds a full StorageProvider (validation, queries, conflicts, export/import) on top of
 * simple row backends. Filtering and sorting run in memory after listing all rows, which is
 * right for template-sized data; push filters down to the backend if collections grow large.
 */
export function createTableBackedProvider(options: TableBackedProviderOptions): TableBackedProvider {
  const warn: StorageWarningHandler = options.onWarning ?? (() => {});
  const newId = options.newId ?? defaultId;
  const kvFactory = options.kv ?? ((namespace: string) => createMemoryProvider().kv(namespace));
  const kvStores = new Map<string, KeyValueStore>();
  const listeners = new Map<string, Set<() => void>>();
  const definitions = new Map<string, CollectionDefinition<unknown>>();
  const capabilities: Capabilities = { shared: options.shared, concurrency: 'version', serverFilter: false };

  function emit(name: string): void {
    listeners.get(name)?.forEach((listener) => listener());
  }

  function collection<T>(definition: CollectionDefinition<T>): Collection<T> {
    const { name, schema } = definition;
    definitions.set(name, definition as CollectionDefinition<unknown>);
    const table = options.tableFor(name);

    function parseData(data: unknown): T {
      const result = schema.safeParse(data);
      if (!result.success) throw new ValidationError(name, result.error.issues);
      return result.data;
    }

    function toRecord(row: BackendRow): Stored<T> | undefined {
      let body: unknown;
      try {
        body = JSON.parse(row.data);
      } catch {
        warn(`A record in "${name}" is not valid JSON and was skipped.`, row.key);
        return undefined;
      }
      const result = schema.safeParse(body);
      if (!result.success) {
        warn(`A record in "${name}" did not match its schema and was skipped.`, result.error.issues);
        return undefined;
      }
      return { ...result.data, id: row.key, version: row.etag, createdAt: row.createdAt, updatedAt: row.updatedAt };
    }

    async function readAll(): Promise<Stored<T>[]> {
      const records: Stored<T>[] = [];
      let cursor: string | undefined;
      do {
        const page = await table.list(cursor);
        for (const row of page.rows) {
          const record = toRecord(row);
          if (record) records.push(record);
        }
        cursor = page.nextCursor;
      } while (cursor);
      return records;
    }

    return {
      name,
      async list(listOptions?: ListOptions<T>) {
        return queryRecords(await readAll(), listOptions);
      },
      async listAll(listOptions?: Omit<ListOptions<T>, 'cursor'>) {
        const all = await readAll();
        return queryRecords(all, { ...listOptions, limit: Math.max(all.length, 1) }).items;
      },
      async get(id: string) {
        const row = await table.get(id);
        return row ? toRecord(row) : undefined;
      },
      async create(data: T, createOptions?: CreateOptions) {
        const parsed = parseData(data);
        const row = await table.create(createOptions?.id ?? newId(), JSON.stringify(parsed));
        emit(name);
        return { ...parsed, id: row.key, version: row.etag, createdAt: row.createdAt, updatedAt: row.updatedAt };
      },
      async update(id: string, patch: Partial<T>, writeOptions?: WriteOptions) {
        const existingRow = await table.get(id);
        const existing = existingRow ? toRecord(existingRow) : undefined;
        if (!existing) {
          if (writeOptions?.ifVersion !== undefined) throw new ConflictError(name, id);
          throw new NotFoundError(name, id);
        }
        if (writeOptions?.ifVersion !== undefined && writeOptions.ifVersion !== existing.version) {
          throw new ConflictError(name, id);
        }
        const merged = parseData({ ...stripMeta(existing), ...patch });
        const row = await table.update(id, JSON.stringify(merged), writeOptions?.ifVersion ?? existing.version);
        emit(name);
        return { ...merged, id, version: row.etag, createdAt: row.createdAt, updatedAt: row.updatedAt };
      },
      async put(id: string, data: T, writeOptions?: WriteOptions) {
        const parsed = parseData(data);
        const existing = await table.get(id);
        if (writeOptions?.ifVersion !== undefined && existing?.etag !== writeOptions.ifVersion) {
          throw new ConflictError(name, id);
        }
        const row = existing
          ? await table.update(id, JSON.stringify(parsed), writeOptions?.ifVersion)
          : await table.create(id, JSON.stringify(parsed));
        emit(name);
        return { ...parsed, id, version: row.etag, createdAt: row.createdAt, updatedAt: row.updatedAt };
      },
      async delete(id: string, writeOptions?: WriteOptions) {
        if (writeOptions?.ifVersion !== undefined) {
          const existing = await table.get(id);
          if (!existing || existing.etag !== writeOptions.ifVersion) throw new ConflictError(name, id);
        }
        await table.delete(id, writeOptions?.ifVersion);
        emit(name);
      },
      subscribe(listener: () => void) {
        const set = listeners.get(name) ?? new Set();
        set.add(listener);
        listeners.set(name, set);
        return () => set.delete(listener);
      },
    };
  }

  function kv(namespace: string): KeyValueStore {
    let store = kvStores.get(namespace);
    if (!store) {
      store = kvFactory(namespace);
      kvStores.set(namespace, store);
    }
    return store;
  }

  return {
    id: options.id,
    capabilities,
    collection,
    kv,
    refresh(collectionName?: string) {
      if (collectionName) emit(collectionName);
      else listeners.forEach((_set, name) => emit(name));
    },
    async exportAll(): Promise<StorageSnapshot> {
      const snapshot: StorageSnapshot = {
        format: 'app-storage-snapshot',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        collections: {},
        kv: {},
      };
      for (const definition of definitions.values()) {
        snapshot.collections[definition.name] = await collection(definition).listAll();
      }
      for (const [namespace, store] of kvStores) {
        const values: Record<string, unknown> = {};
        for (const key of store.keys()) {
          const value = store.get(key, z.unknown());
          if (value !== undefined) values[key] = value;
        }
        snapshot.kv[namespace] = values;
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
        if (!definition) {
          warn(`Skipped "${name}" during import: the app has not opened that collection.`);
          continue;
        }
        const target = collection(definition);
        if (replace) {
          for (const existing of await target.listAll()) await target.delete(existing.id);
        }
        for (const record of records) {
          if (!record || typeof record.id !== 'string') continue;
          try {
            await target.put(record.id, stripMeta(record));
          } catch (error) {
            warn(`Skipped a record in "${name}" during import.`, error);
          }
        }
      }
      for (const [namespace, values] of Object.entries(snapshot.kv)) {
        const store = kv(namespace);
        if (replace) store.keys().forEach((key) => store.remove(key));
        for (const [key, value] of Object.entries(values)) store.set(key, value);
      }
    },
  };
}

/**
 * Reference TableBackend kept entirely in memory. Use it in tests, and as the model for a
 * real backend: every behaviour here (etag changes on write, conflicts, idempotent delete)
 * must be reproduced by SharePoint/Dataverse/REST implementations.
 */
export function createInMemoryTableBackend(now: () => Date = () => new Date()): TableBackend {
  const rows = new Map<string, BackendRow>();
  let counter = 0;
  const etag = () => `W/"${++counter}"`;
  return {
    async list(cursor?: string) {
      const all = [...rows.values()];
      const offset = cursor ? Number(cursor) : 0;
      const pageSize = 2; // deliberately tiny so paging is always exercised
      const slice = all.slice(offset, offset + pageSize);
      return offset + pageSize < all.length ? { rows: slice, nextCursor: String(offset + pageSize) } : { rows: slice };
    },
    async get(key) {
      const row = rows.get(key);
      return row ? { ...row } : undefined;
    },
    async create(key, data) {
      if (rows.has(key)) throw new ConflictError('backend', key);
      const timestamp = now().toISOString();
      const row = { key, data, etag: etag(), createdAt: timestamp, updatedAt: timestamp };
      rows.set(key, row);
      return { ...row };
    },
    async update(key, data, expected) {
      const existing = rows.get(key);
      if (!existing) throw new NotFoundError('backend', key);
      if (expected !== undefined && existing.etag !== expected) throw new ConflictError('backend', key);
      const row = { ...existing, data, etag: etag(), updatedAt: now().toISOString() };
      rows.set(key, row);
      return { ...row };
    },
    async delete(key, expected) {
      const existing = rows.get(key);
      if (expected !== undefined && existing?.etag !== expected) throw new ConflictError('backend', key);
      rows.delete(key);
    },
  };
}
