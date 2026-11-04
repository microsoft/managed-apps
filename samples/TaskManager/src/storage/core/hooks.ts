import { useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import type { z } from 'zod';
import { StorageContext } from './context';
import type { Collection, KeyValueStore, StorageProvider } from './types';

export function useStorageProvider(): StorageProvider {
  const provider = useContext(StorageContext);
  if (!provider) throw new Error('useStorageProvider must be used inside <StorageRoot>.');
  return provider;
}

/** Calls `onChange` whenever the collection changes (this tab, other tabs, or other users). */
export function useCollectionChanges<T>(collection: Collection<T>, onChange: () => void): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => collection.subscribe(() => latest.current()), [collection]);
}

/**
 * Reactive, validated key/value state. Returns `fallback` when the key is missing or invalid.
 * Passing `undefined` to the setter removes the key.
 */
export function useKeyValue<V>(
  store: KeyValueStore,
  key: string,
  schema: z.ZodType<V>,
  fallback: V,
): [V, (next: V | undefined) => void] {
  const cache = useRef<{ json: string; value: V } | null>(null);

  const subscribe = useCallback(
    (notify: () => void) => store.subscribe((changed) => {
      if (changed === key) notify();
    }),
    [store, key],
  );

  const getSnapshot = useCallback((): V => {
    const value = store.get(key, schema) ?? fallback;
    const json = JSON.stringify(value) ?? 'undefined';
    if (cache.current?.json === json) return cache.current.value;
    cache.current = { json, value };
    return value;
  }, [store, key, schema, fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setValue = useCallback(
    (next: V | undefined) => {
      if (next === undefined) store.remove(key);
      else store.set(key, next);
    },
    [store, key],
  );

  return [value, setValue];
}
