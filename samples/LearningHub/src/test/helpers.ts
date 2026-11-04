import { createMemoryProvider } from '../storage/core';
import { openAppStorage, type AppStorage } from '../storage';
import type { Me } from '../lib/identity';

/** A fresh, isolated in-memory storage with deterministic ids and an advancing clock. */
export function makeStorage(options: { start?: string; shared?: boolean } = {}): AppStorage {
  let time = Date.parse(options.start ?? '2030-01-01T00:00:00Z');
  let seq = 0;
  const provider = createMemoryProvider({
    prefix: 'test',
    now: () => new Date((time += 1000)),
    newId: () => `id-${++seq}`,
  });
  if (options.shared) {
    return openAppStorage({ ...provider, capabilities: { ...provider.capabilities, shared: true } });
  }
  return openAppStorage(provider);
}

export const ADA: Me = { id: 'user-ada', displayName: 'Ada Example' };
export const BEN: Me = { id: 'user-ben', displayName: 'Ben Sample' };
