import type { StorageProvider, StorageWarningHandler } from '../types';
import { createWebStorageProvider } from './webStorage';
import { createMemoryProvider } from './memory';

export interface LocalProviderOptions {
  /** Key prefix that isolates this app's data from other apps on the same origin. */
  prefix: string;
  onWarning?: StorageWarningHandler;
}

/**
 * Default provider: persists to `window.localStorage` and syncs across tabs.
 * Falls back to an in-memory store (with a warning) when localStorage is blocked,
 * e.g. in some privacy modes or sandboxed iframes.
 */
export function createLocalProvider(options: LocalProviderOptions): StorageProvider {
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
    const probe = `${options.prefix}:probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
  } catch {
    storage = undefined;
  }
  if (!storage) {
    options.onWarning?.('Browser storage is blocked; data will be lost when this page closes.');
    return createMemoryProvider({ prefix: options.prefix, onWarning: options.onWarning });
  }
  return createWebStorageProvider({
    storage,
    prefix: options.prefix,
    id: 'local',
    onWarning: options.onWarning,
    eventTarget: window,
  });
}
