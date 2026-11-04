import type { RecordMeta } from './types';

const META_KEYS: ReadonlyArray<keyof RecordMeta> = ['id', 'version', 'createdAt', 'updatedAt'];

/** Returns a shallow copy of a stored record without its provider-owned metadata. */
export function stripMeta(record: object): Record<string, unknown> {
  const data: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const key of META_KEYS) delete data[key];
  return data;
}
