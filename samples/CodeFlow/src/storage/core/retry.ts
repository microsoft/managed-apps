import { ConflictError } from './errors';

/**
 * Runs a read-modify-write `operation`, re-running it when another writer wins the race
 * (ConflictError). The operation must re-read the record on each attempt.
 */
export async function withConflictRetry<R>(
  operation: (attempt: number) => Promise<R>,
  options: { attempts?: number } = {},
): Promise<R> {
  const attempts = Math.max(1, options.attempts ?? 3);
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!(error instanceof ConflictError) || attempt >= attempts) throw error;
    }
  }
}
