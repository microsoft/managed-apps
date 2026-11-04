/**
 * Auto-merge, through the GitHub connector.
 *
 * See {@link ./autoMergeQuery} for why this is GraphQL rather than REST.
 *
 * Reading and writing pull different ways on failure, deliberately. Reading is
 * like the checks pill next door: nobody asked for it, so it resolves to
 * `undefined` and the control quietly stays disabled rather than putting an
 * error on a page the reviewer came to read a diff on. Writing is something
 * the author pressed a button to do, so it throws and the reason goes in front
 * of them.
 */

import type { MergeMethod, PrCoordinates } from '../../types';
import { createLogger } from '../../lib/logger';
import { runGraphQl, runGraphQlMutation } from '../graphQl';
import {
  buildAutoMergeQuery,
  buildDisableAutoMergeMutation,
  buildEnableAutoMergeMutation,
  parseAutoMergeMutation,
  parseAutoMergeNodeId,
  parseAutoMergeStatus,
  type AutoMergeStatus,
} from './autoMergeQuery';

export type { AutoMergeStatus } from './autoMergeQuery';
export {
  buildAutoMergeQuery,
  buildDisableAutoMergeMutation,
  buildEnableAutoMergeMutation,
  fromGraphQlMethod,
  parseAutoMergeMutation,
  parseAutoMergeNodeId,
  parseAutoMergeStatus,
} from './autoMergeQuery';

const log = createLogger('automerge');

/**
 * Read a pull request's auto-merge state.
 *
 * Resolves to `undefined` when it can't be read at all, which the caller
 * should treat as "don't know" rather than "off": the control stays disabled
 * instead of offering to change something we can't see.
 */
export async function fetchAutoMerge(
  coords: PrCoordinates,
): Promise<AutoMergeStatus | undefined> {
  try {
    return parseAutoMergeStatus(
      await runGraphQl(buildAutoMergeQuery(coords), 'Could not read auto-merge'),
    );
  } catch (error) {
    log.warn('auto-merge query failed', error);
    return undefined;
  }
}

/**
 * Resolve the pull request's GraphQL node id, looking it up only when the
 * loaded summary didn't carry one.
 *
 * Mirrors the draft publisher: the REST payload normally supplies `node_id`
 * for free, so the common path is a single round trip, and the extra lookup
 * exists for summaries built from a search result.
 */
async function resolveNodeId(
  coords: PrCoordinates,
  nodeId: string | undefined,
  what: string,
): Promise<string> {
  if (nodeId) return nodeId;
  const id = parseAutoMergeNodeId(await runGraphQl(buildAutoMergeQuery(coords), what));
  if (!id) throw new Error('Could not find this pull request.');
  return id;
}

/**
 * Arm auto-merge, so GitHub merges the pull request the moment its
 * requirements are satisfied.
 *
 * Throws with GitHub's own wording when it refuses — "Pull request is in clean
 * status" for one that could simply be merged now, or a repository that has
 * the feature switched off — because those are the two refusals worth reading
 * and neither is something the app can work around.
 */
export async function enableAutoMerge(
  coords: PrCoordinates,
  method: MergeMethod,
  nodeId?: string,
): Promise<AutoMergeStatus> {
  const id = await resolveNodeId(coords, nodeId, 'Could not enable auto-merge');
  const status = parseAutoMergeMutation(
    await runGraphQlMutation(buildEnableAutoMergeMutation(id, method), 'Could not enable auto-merge'),
    'enablePullRequestAutoMerge',
  );
  if (status && !status.enabled) {
    throw new Error('GitHub did not turn auto-merge on for this pull request.');
  }
  log.info('enabled auto-merge');
  // A mutation that answered without a payload still succeeded; report the
  // state we asked for rather than pretending we learned nothing.
  return status ?? { enabled: true, method };
}

/**
 * Disarm auto-merge.
 *
 * Succeeding when it was already off is the honest answer — the end state is
 * what was asked for — so a null `autoMergeRequest` here is not an error.
 */
export async function disableAutoMerge(
  coords: PrCoordinates,
  nodeId?: string,
): Promise<AutoMergeStatus> {
  const id = await resolveNodeId(coords, nodeId, 'Could not turn auto-merge off');
  const status = parseAutoMergeMutation(
    await runGraphQlMutation(buildDisableAutoMergeMutation(id), 'Could not turn auto-merge off'),
    'disablePullRequestAutoMerge',
  );
  if (status?.enabled) {
    throw new Error('GitHub still reports auto-merge as on for this pull request.');
  }
  log.info('disabled auto-merge');
  // The mutation doesn't re-report `viewerCanEnableAutoMerge`, so leaving it
  // undefined says "ask again" rather than inventing an answer.
  return status ?? { enabled: false };
}
