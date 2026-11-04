/**
 * Shared storage core. Synced verbatim into every template from `shared/storage-core`;
 * do not edit the per-app copies — app-specific code lives in `src/storage/` next to `core/`.
 */
export * from './types';
export * from './errors';
export { queryRecords, matchesWhere, sortRecords, DEFAULT_PAGE_SIZE } from './query';
export { withConflictRetry } from './retry';
export { describeCollections, type CollectionDescription } from './describe';
export { createWebStorageProvider, type WebStorageLike, type WebStorageProviderOptions } from './providers/webStorage';
export { createLocalProvider, type LocalProviderOptions } from './providers/local';
export { createMemoryProvider, MemoryStorage, type MemoryProviderOptions } from './providers/memory';
export {
  createTableBackedProvider,
  createInMemoryTableBackend,
  type BackendPage,
  type BackendRow,
  type TableBackend,
  type TableBackedProvider,
  type TableBackedProviderOptions,
} from './providers/tableBacked';
export { downloadSnapshot, readSnapshotFile } from './snapshotFiles';
