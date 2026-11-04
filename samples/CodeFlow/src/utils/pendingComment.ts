/**
 * The identity a comment carries between being typed and being acknowledged by
 * the server.
 *
 * Optimistic updates put the comment on screen immediately, before GitHub has
 * given it an id, so one is invented locally. Anything that keys off comment
 * identity has to know that these ids are temporary and will be swapped for the
 * real one moments later — otherwise the same comment looks like two.
 */

export const PENDING_ID_PREFIX = 'pending-';

let counter = 0;

/**
 * Mint an id for a comment that hasn't been acknowledged by the server yet.
 *
 * The counter is what makes it unique: a timestamp alone repeats for anything
 * posted inside the same millisecond, and two comments sharing an id is a
 * duplicate React key and a comment that updates the wrong row.
 */
export function newPendingId(): string {
  counter += 1;
  return `${PENDING_ID_PREFIX}${Date.now()}-${counter}`;
}

/** Is this the placeholder id an optimistic update handed out? */
export function isPendingCommentId(id: string): boolean {
  return id.startsWith(PENDING_ID_PREFIX);
}
