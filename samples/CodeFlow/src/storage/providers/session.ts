import { createWebStorageProvider, MemoryStorage, type KeyValueStore } from '../core';

/**
 * Tab-scoped key/value store (backed by `sessionStorage`).
 *
 * Used only for "which PR was this tab on", which must survive a reload of the
 * same tab but must not leak into a newly opened one. Falls back to memory when
 * the browser blocks storage.
 */
export function createSessionKv(prefix: string): KeyValueStore {
  let storage: Storage | MemoryStorage;
  try {
    storage = window.sessionStorage;
    const probe = `${prefix}:probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
  } catch {
    storage = new MemoryStorage();
  }
  return createWebStorageProvider({ storage, prefix, id: 'session' }).kv('session');
}
