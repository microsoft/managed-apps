/**
 * Publishing a draft pull request through the GitHub connector.
 *
 * See {@link ./draftQuery} for why this is a GraphQL mutation rather than a
 * REST update.
 *
 * Unlike the checks reader next door, failures here are thrown rather than
 * swallowed. Checks are supplementary — losing them costs a pill. This is a
 * write the reviewer explicitly asked for, and silently doing nothing would be
 * worse than saying why it didn't work.
 */

import type { PrCoordinates } from '../../types';
import { createLogger } from '../../lib/logger';
import { runGraphQl, runGraphQlMutation } from '../graphQl';
import {
  buildNodeIdQuery,
  buildPublishMutation,
  parseNodeIdLookup,
  parsePublishResult,
} from './draftQuery';

export {
  buildNodeIdQuery,
  buildPublishMutation,
  graphQlErrorMessage,
  parseNodeIdLookup,
  parsePublishResult,
} from './draftQuery';

const log = createLogger('draft');

/**
 * Mark a draft pull request as ready for review.
 *
 * `nodeId` is the pull request's GraphQL id, which the loaded summary carries.
 * When it's absent this falls back to one extra round trip to look it up, so
 * the button still works on a summary built before that field existed.
 *
 * Resolves once GitHub confirms the pull request is no longer a draft, and
 * throws with a message worth showing otherwise.
 */
export async function publishDraft(coords: PrCoordinates, nodeId?: string): Promise<void> {
  let id = nodeId;
  if (!id) {
    const looked = parseNodeIdLookup(
      await runGraphQl(buildNodeIdQuery(coords), 'Could not find this pull request'),
    );
    // Already published — by someone else, or in another tab. Nothing to do,
    // and refusing here would be a lie about the end state.
    if (looked.isDraft === false) return;
    if (!looked.nodeId) throw new Error('Could not find this pull request.');
    id = looked.nodeId;
  }

  const published = parsePublishResult(
    await runGraphQlMutation(buildPublishMutation(id), 'Could not publish this pull request'),
  );
  if (published?.isDraft === true) {
    throw new Error('GitHub still reports this pull request as a draft.');
  }
  log.info('published draft');
}
