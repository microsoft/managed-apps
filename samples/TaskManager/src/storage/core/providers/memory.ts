import type { StorageProvider, StorageWarningHandler } from '../types';
import { createWebStorageProvider, type WebStorageLike } from './webStorage';

/** Web Storage-compatible in-memory map. Useful for tests and as a fallback. */
export class MemoryStorage implements WebStorageLike {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

export interface MemoryProviderOptions {
  prefix?: string;
  storage?: MemoryStorage;
  onWarning?: StorageWarningHandler;
  now?: () => Date;
  newId?: () => string;
}

/** Non-persistent provider with the same semantics as `local`. Ideal for unit tests. */
export function createMemoryProvider(options: MemoryProviderOptions = {}): StorageProvider {
  return createWebStorageProvider({
    storage: options.storage ?? new MemoryStorage(),
    prefix: options.prefix ?? 'app',
    id: 'memory',
    onWarning: options.onWarning,
    now: options.now,
    newId: options.newId,
  });
}
