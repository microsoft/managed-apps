/**
 * Resolving and unresolving a review thread.
 *
 * Both directions are one GraphQL mutation — `resolveReviewThread` and
 * `unresolveReviewThread` — and the mutation *answers with the state it just
 * wrote*. `thread { isResolved }` is compared with what was asked for, so a
 * write that was accepted and dropped is reported rather than shown as done
 * until the next poll quietly reverts it.
 */
import { asRecord, gqlString, runGraphQlMutation } from '../../graphQl';
import { isNodeId } from './helpers';

/** Whether an id can be the subject of the mutation (a `PRRT_…` node id). */
export function looksLikeThreadNodeId(id: string): boolean {
  return isNodeId(id);
}

/** Build the mutation that sets one thread's resolution state. */
export function buildThreadResolutionMutation(threadNodeId: string, resolved: boolean): string {
  const field = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
  return `mutation { ${field}(input: { threadId: ${gqlString(threadNodeId)} }) { thread { id isResolved } } }`;
}

/**
 * The resolution state GitHub reports after the mutation. `undefined` means the
 * mutation returned no thread at all, which is a failure.
 */
export function parseThreadResolution(payload: unknown, resolved: boolean): boolean | undefined {
  const field = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
  const isResolved = asRecord(asRecord(asRecord(payload)?.[field])?.thread)?.isResolved;
  return typeof isResolved === 'boolean' ? isResolved : undefined;
}

/** Set a review thread's resolution state and confirm GitHub stored it. */
export async function setThreadResolution(threadNodeId: string, resolved: boolean): Promise<void> {
  const what = resolved ? 'Could not resolve this thread' : 'Could not reactivate this thread';
  if (!looksLikeThreadNodeId(threadNodeId)) {
    throw new Error(`${what}: GitHub did not return an id for it.`);
  }
  const payload = await runGraphQlMutation(buildThreadResolutionMutation(threadNodeId, resolved), what);
  const now = parseThreadResolution(payload, resolved);
  if (now === undefined) throw new Error(`${what}: GitHub returned no thread.`);
  if (now !== resolved) {
    throw new Error(`${what}: GitHub still reports it as ${now ? 'resolved' : 'active'}.`);
  }
}
