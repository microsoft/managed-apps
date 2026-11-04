/**
 * Turning a draft pull request into one that is ready for review.
 *
 * This is GraphQL-only, and not by choice. The connector's REST
 * `UpdatePullRequest` accepts title, body, state, base and
 * `maintainer_can_modify` — GitHub's REST API has never exposed the draft flag
 * as a writable field, so there is no request body that flips it. The single
 * supported route in either API is the `markPullRequestReadyForReview`
 * mutation, which addresses the pull request by GraphQL node id.
 *
 * Node ids come free with the REST payload we already load (`node_id`), so the
 * common path is one round trip. {@link buildNodeIdQuery} exists for the case
 * where a summary predates that mapping, or was built from a search result.
 */

import type { PrCoordinates } from '../../types';

// Re-exported rather than defined here: reading a GraphQL envelope is shared
// with auto-merge now, and this stayed the import path everything already used.
export { graphQlErrorMessage } from '../graphQlEnvelope';

/** What the publish mutation reports back about the pull request it changed. */
export interface PublishedPr {
  /** Should be `false` afterwards; anything else means the mutation no-opped. */
  isDraft?: boolean;
}

/**
 * Build the mutation that publishes a draft.
 *
 * The node id is interpolated as a JSON string rather than pasted raw. It
 * arrives from an API response rather than from a person, so this is belt and
 * braces, but a stray quote would rewrite the mutation instead of failing to
 * match it — and unlike a query, a rewritten mutation writes.
 */
export function buildPublishMutation(nodeId: string): string {
  return (
    'mutation { markPullRequestReadyForReview(input: { pullRequestId: ' +
    `${JSON.stringify(nodeId)} }) { pullRequest { id isDraft } } }`
  );
}

/** Build the lookup that recovers a pull request's node id from its number. */
export function buildNodeIdQuery(coords: PrCoordinates): string {
  return (
    `query { repository(owner: ${JSON.stringify(coords.owner)}, ` +
    `name: ${JSON.stringify(coords.name)}) { ` +
    `pullRequest(number: ${coords.number}) { id isDraft } } }`
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Read `{ id, isDraft }` out of a node-id lookup's payload. */
export function parseNodeIdLookup(payload: unknown): { nodeId?: string; isDraft?: boolean } {
  const pr = asRecord(asRecord(asRecord(payload)?.repository)?.pullRequest);
  if (!pr) return {};
  return {
    nodeId: str(pr.id),
    isDraft: typeof pr.isDraft === 'boolean' ? pr.isDraft : undefined,
  };
}

/** Read the mutation's payload, or `undefined` when it didn't return one. */
export function parsePublishResult(payload: unknown): PublishedPr | undefined {
  const pr = asRecord(
    asRecord(asRecord(payload)?.markPullRequestReadyForReview)?.pullRequest,
  );
  if (!pr) return undefined;
  return { isDraft: typeof pr.isDraft === 'boolean' ? pr.isDraft : undefined };
}
