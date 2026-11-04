/**
 * Helpers for optimistic writes that stay correct under rapid repeats.
 *
 * - KeyedQueue runs server writes for one item strictly one after another, so an older request can
 *   never land after a newer one.
 * - OptimisticLane tracks, per item, how many writes are in flight, which intent is the latest, and
 *   the last server-confirmed value. Only the latest intent paints the cache; when the last write
 *   settles, the confirmed value replaces the optimistic one (server truth, or a rollback).
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(task);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

export class OptimisticLane<T> {
  private readonly pending = new Map<string, number>();
  private readonly latest = new Map<string, number>();
  private readonly confirmed = new Map<string, T>();
  private seq = 0;

  /** Starts a write. `current` is the server truth to fall back to if this is the first in flight. */
  begin(id: string, current: T): number {
    if (!this.pending.get(id)) this.confirmed.set(id, current);
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    const seq = ++this.seq;
    this.latest.set(id, seq);
    return seq;
  }

  isLatest(id: string, seq: number): boolean {
    return this.latest.get(id) === seq;
  }

  confirm(id: string, value: T): void {
    if (this.pending.get(id)) this.confirmed.set(id, value);
  }

  /** Ends a write. When it was the last in flight, returns the value the cache should settle on. */
  end(id: string): { last: boolean; settled?: T } {
    const left = (this.pending.get(id) ?? 1) - 1;
    if (left > 0) {
      this.pending.set(id, left);
      return { last: false };
    }
    const settled = this.confirmed.get(id);
    this.pending.delete(id);
    this.latest.delete(id);
    this.confirmed.delete(id);
    return { last: true, settled };
  }
}

/** The human part of a "Couldn’t do X: reason" error, for short failure toasts. */
export function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const colon = message.indexOf(': ');
  return (colon >= 0 ? message.slice(colon + 2) : message).trim();
}
