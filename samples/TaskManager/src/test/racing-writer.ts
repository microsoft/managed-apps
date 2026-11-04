import type { Collection } from "@/storage/core";

/**
 * Wraps a collection so the next `times` versioned updates lose a race: just
 * before each one, "someone else" writes `concurrentPatch` to the same record,
 * so the caller's `ifVersion` is stale and the provider throws ConflictError.
 */
export function withRacingWriter<T>(
  collection: Collection<T>,
  concurrentPatch: (id: string) => Partial<T>,
  times = 1,
): Collection<T> & { races: number } {
  let remaining = times;
  const wrapped = Object.create(collection) as Collection<T> & { races: number };
  wrapped.races = 0;
  wrapped.update = async (id, patch, options) => {
    if (remaining > 0 && options?.ifVersion !== undefined) {
      remaining -= 1;
      wrapped.races += 1;
      await collection.update(id, concurrentPatch(id));
    }
    return collection.update(id, patch, options);
  };
  return wrapped;
}
