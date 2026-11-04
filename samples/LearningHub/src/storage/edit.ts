import { withConflictRetry, type Collection, type Stored } from './core';

/** Throw inside an `editRecord` change function to leave the record untouched. */
export class SkipEdit extends Error {
  readonly reason: string;
  constructor(reason = '') {
    super(reason || 'Edit skipped');
    this.name = 'SkipEdit';
    this.reason = reason;
  }
}

export type EditResult<T> =
  | { status: 'updated'; record: Stored<T> }
  | { status: 'skipped'; reason: string }
  | { status: 'missing' };

/**
 * Conflict-safe read-modify-write. `change` sees the freshest record and returns a patch (or throws
 * SkipEdit); the write is conditional on the version it read, and the whole step re-runs when
 * someone else wrote first (ConflictError). Decisions made in `change` are therefore never based
 * on stale data.
 */
export function editRecord<T>(
  collection: Collection<T>,
  id: string,
  change: (current: Stored<T>) => Partial<T>,
  options: { attempts?: number } = {},
): Promise<EditResult<T>> {
  return withConflictRetry(async () => {
    const current = await collection.get(id);
    if (!current) return { status: 'missing' } as const;
    let patch: Partial<T>;
    try {
      patch = change(current);
    } catch (error) {
      if (error instanceof SkipEdit) return { status: 'skipped', reason: error.reason } as const;
      throw error;
    }
    const record = await collection.update(id, patch, { ifVersion: current.version });
    return { status: 'updated', record } as const;
  }, { attempts: options.attempts ?? 5 });
}
