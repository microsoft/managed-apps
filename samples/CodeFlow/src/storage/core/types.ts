import type { z } from 'zod';

/**
 * Storage abstraction shared by every template.
 *
 * App code talks only to these interfaces. The default provider keeps data in the
 * browser (localStorage); other providers (SharePoint, Dataverse, a REST API, …) can be
 * added with the `add-data-source` skill without touching UI or domain code.
 */

/** Provider-owned fields present on every stored record. */
export interface RecordMeta {
  /** Stable identifier, unique within the collection. */
  id: string;
  /** Opaque concurrency token (ETag equivalent). Changes on every write. */
  version: string;
  /** ISO-8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

export type Stored<T> = T & RecordMeta;

export type FilterOp = 'eq' | 'ne' | 'in' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';

/**
 * Declarative filter. Deliberately not a JS predicate so remote providers can translate
 * it into OData / CAML / SQL and filter server-side.
 */
export interface Where<T> {
  field: Extract<keyof T, string> | keyof RecordMeta;
  op: FilterOp;
  value: unknown;
}

export interface OrderBy<T> {
  field: Extract<keyof T, string> | keyof RecordMeta;
  direction?: 'asc' | 'desc';
}

export interface ListOptions<T> {
  where?: Where<T>[];
  orderBy?: OrderBy<T>[];
  /** Page size. Providers may cap it. */
  limit?: number;
  /** Opaque cursor returned by a previous page. */
  cursor?: string;
}

export interface Page<T> {
  items: Stored<T>[];
  /** Present when more results are available. */
  nextCursor?: string;
}

export interface WriteOptions {
  /** Optimistic concurrency: fail with ConflictError unless the stored version matches. */
  ifVersion?: string;
}

export interface CreateOptions {
  /** Caller-chosen id (e.g. a natural key). Generated when omitted. */
  id?: string;
}

export interface Collection<T> {
  readonly name: string;
  list(options?: ListOptions<T>): Promise<Page<T>>;
  /** Follows cursors until every matching record is returned. */
  listAll(options?: Omit<ListOptions<T>, 'cursor'>): Promise<Stored<T>[]>;
  get(id: string): Promise<Stored<T> | undefined>;
  /** Fails with ConflictError when `options.id` already exists. */
  create(data: T, options?: CreateOptions): Promise<Stored<T>>;
  /** Shallow-merges `patch` into the stored record. Fails with NotFoundError when missing. */
  update(id: string, patch: Partial<T>, options?: WriteOptions): Promise<Stored<T>>;
  /** Creates or fully replaces the record with this id. */
  put(id: string, data: T, options?: WriteOptions): Promise<Stored<T>>;
  /** Idempotent: deleting a missing record succeeds unless `ifVersion` is supplied. */
  delete(id: string, options?: WriteOptions): Promise<void>;
  /** Notified after any change to the collection (including other tabs/users when supported). */
  subscribe(listener: () => void): () => void;
}

/**
 * Small typed key/value store for preferences, drafts and UI state.
 * Reads are synchronous (served from memory); writes persist in the background.
 */
export interface KeyValueStore {
  readonly namespace: string;
  /** Resolves once the store has been hydrated. Local providers resolve immediately. */
  ready(): Promise<void>;
  /** Returns undefined when missing or when the stored value fails validation. */
  get<V>(key: string, schema: z.ZodType<V>): V | undefined;
  set<V>(key: string, value: V): void;
  remove(key: string): void;
  keys(): string[];
  subscribe(listener: (key: string) => void): () => void;
}

export interface Capabilities {
  /** True when records are visible to other users (not just this browser). */
  shared: boolean;
  /** Whether `ifVersion` is enforced. */
  concurrency: 'version' | 'none';
  /** Whether `where`/`orderBy` run server-side. */
  serverFilter: boolean;
}

export interface CollectionDefinition<T> {
  /** Collection name; becomes a list/table/container name in remote providers. */
  name: string;
  /** Source of truth for the record shape: TypeScript type, runtime validation, field list. */
  schema: z.ZodType<T>;
  description?: string;
}

export interface StorageSnapshot {
  format: 'app-storage-snapshot';
  formatVersion: 1;
  exportedAt: string;
  collections: Record<string, Stored<unknown>[]>;
  kv: Record<string, Record<string, unknown>>;
}

export interface ImportOptions {
  /** `replace` clears each imported collection/namespace first. Default `merge`. */
  mode?: 'merge' | 'replace';
}

export interface StorageProvider {
  /** Provider id, e.g. `local`, `memory`, `sharepoint`. */
  readonly id: string;
  readonly capabilities: Capabilities;
  collection<T>(definition: CollectionDefinition<T>): Collection<T>;
  kv(namespace: string): KeyValueStore;
  exportAll(): Promise<StorageSnapshot>;
  importAll(snapshot: StorageSnapshot, options?: ImportOptions): Promise<void>;
}

export type StorageWarningHandler = (message: string, detail?: unknown) => void;
