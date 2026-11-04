/**
 * Turning GitHub's auto-merge on and off for a pull request.
 *
 * GraphQL-only, and for the same reason publishing a draft is: GitHub's REST
 * API reports `auto_merge` on a pull request but has never accepted it as a
 * writable field. The only route in either API is the
 * `enablePullRequestAutoMerge` / `disablePullRequestAutoMerge` pair, which
 * address the pull request by GraphQL node id.
 *
 * One field is deliberately absent from the enable mutation:
 * `expectedHeadOid`. The merge button pins the head sha because it lands the
 * commits on screen right now, so a branch that moved underneath it would
 * merge code nobody read. Auto-merge makes no such promise — it merges
 * whatever the head is when the requirements finally go green, which is
 * routinely a commit that doesn't exist yet. A guard here would refuse honest
 * requests without protecting anything.
 */

import type { MergeMethod, PrCoordinates } from '../../types';

/** What GitHub reports about a pull request's auto-merge request. */
export interface AutoMergeStatus {
  /** Whether auto-merge is armed right now. */
  enabled: boolean;
  /** The strategy it will use, when it is armed. */
  method?: MergeMethod;
  /** Who armed it — not always the author; anyone with write access can. */
  enabledBy?: string;
  /**
   * GitHub's own answer to whether the signed-in user could turn it on.
   *
   * `false` covers several unrelated refusals at once — auto-merge switched
   * off for the repository, no write access, or a pull request that is already
   * mergeable and so has nothing to wait for. Undefined means we haven't been
   * told.
   */
  viewerCanEnable?: boolean;
}

/**
 * The GraphQL spelling of a merge strategy.
 *
 * REST takes these lowercase; GraphQL takes an unquoted `PullRequestMergeMethod`
 * enum member, so the value is uppercased and interpolated bare rather than as
 * a JSON string. The mapping is exhaustive over {@link MergeMethod}, which is
 * why it can be a lookup rather than a validated conversion.
 */
const GRAPHQL_METHOD: Record<MergeMethod, string> = {
  merge: 'MERGE',
  squash: 'SQUASH',
  rebase: 'REBASE',
};

/** The `autoMergeRequest` selection, shared by the query and both mutations. */
const AUTO_MERGE_FIELDS = 'autoMergeRequest { mergeMethod enabledBy { login } }';

/** Build the lookup that reads a pull request's current auto-merge state. */
export function buildAutoMergeQuery(coords: PrCoordinates): string {
  // Owner and name are interpolated as JSON strings rather than pasted raw:
  // they originate in a user-typed PR reference, and a stray quote would
  // otherwise rewrite the query instead of failing to match.
  return (
    `query { repository(owner: ${JSON.stringify(coords.owner)}, ` +
    `name: ${JSON.stringify(coords.name)}) { ` +
    `pullRequest(number: ${coords.number}) { ` +
    `id viewerCanEnableAutoMerge ${AUTO_MERGE_FIELDS} } } }`
  );
}

/**
 * Build the mutation that arms auto-merge with a given strategy.
 *
 * The node id is interpolated as a JSON string rather than pasted raw. It
 * arrives from an API response rather than from a person, so this is belt and
 * braces, but a stray quote would rewrite the mutation instead of failing to
 * match it — and unlike a query, a rewritten mutation writes.
 */
export function buildEnableAutoMergeMutation(nodeId: string, method: MergeMethod): string {
  return (
    'mutation { enablePullRequestAutoMerge(input: { pullRequestId: ' +
    `${JSON.stringify(nodeId)}, mergeMethod: ${GRAPHQL_METHOD[method]} }) ` +
    `{ pullRequest { id ${AUTO_MERGE_FIELDS} } } }`
  );
}

/** Build the mutation that disarms auto-merge. */
export function buildDisableAutoMergeMutation(nodeId: string): string {
  return (
    'mutation { disablePullRequestAutoMerge(input: { pullRequestId: ' +
    `${JSON.stringify(nodeId)} }) { pullRequest { id ${AUTO_MERGE_FIELDS} } } }`
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Turn GraphQL's enum member back into the app's own spelling.
 *
 * Anything unrecognised comes back undefined rather than guessed: the strategy
 * is shown to the author as a statement of what will happen, and a wrong one
 * is worse than none.
 */
export function fromGraphQlMethod(value: unknown): MergeMethod | undefined {
  switch (str(value)?.toUpperCase()) {
    case 'MERGE':
      return 'merge';
    case 'SQUASH':
      return 'squash';
    case 'REBASE':
      return 'rebase';
    default:
      return undefined;
  }
}

/**
 * Read an auto-merge state out of a `pullRequest` node.
 *
 * `autoMergeRequest` is null whenever auto-merge is off, which is the common
 * case and not an error.
 */
function parsePullRequestNode(pr: Record<string, unknown>): AutoMergeStatus {
  const request = asRecord(pr.autoMergeRequest);
  return {
    enabled: !!request,
    method: request ? fromGraphQlMethod(request.mergeMethod) : undefined,
    enabledBy: request ? str(asRecord(request.enabledBy)?.login) : undefined,
    viewerCanEnable:
      typeof pr.viewerCanEnableAutoMerge === 'boolean' ? pr.viewerCanEnableAutoMerge : undefined,
  };
}

/**
 * Read the status query's payload.
 *
 * `undefined` means the pull request itself couldn't be read — a missing
 * repository, or a grant that can't see it — as opposed to auto-merge simply
 * being off, which is a populated result with `enabled: false`.
 */
export function parseAutoMergeStatus(payload: unknown): AutoMergeStatus | undefined {
  const pr = asRecord(asRecord(asRecord(payload)?.repository)?.pullRequest);
  return pr ? parsePullRequestNode(pr) : undefined;
}

/** Read either mutation's payload, keyed by the field it was sent under. */
export function parseAutoMergeMutation(
  payload: unknown,
  field: 'enablePullRequestAutoMerge' | 'disablePullRequestAutoMerge',
): AutoMergeStatus | undefined {
  const pr = asRecord(asRecord(asRecord(payload)?.[field])?.pullRequest);
  return pr ? parsePullRequestNode(pr) : undefined;
}

/** The node id of the pull request a status lookup found, if it found one. */
export function parseAutoMergeNodeId(payload: unknown): string | undefined {
  return str(asRecord(asRecord(asRecord(payload)?.repository)?.pullRequest)?.id);
}
