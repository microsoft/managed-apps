/**
 * Fetching a pull request's checks through the GitHub connector.
 *
 * See {@link ./checksQuery} for why this uses the GraphQL rollup rather than
 * the REST checks endpoints, and {@link ./checkLinks} for why the links are
 * constructed rather than taken from the response.
 */

import type { IOperationResult } from '@microsoft/managed-apps/data';
import { githubClient } from '../../connectors/github';
import type { ChecksSummary, PrCoordinates } from '../../types';
import { createLogger } from '../../lib/logger';
import { buildChecksQuery, parseChecks } from './checksQuery';

export { buildChecksQuery, parseChecks, tally } from './checksQuery';
export { checkLink } from './checkLinks';

const log = createLogger('checks');

/**
 * Read the checks reported against a pull request's head commit.
 *
 * Resolves to `undefined` rather than throwing when the checks can't be read.
 * They're supplementary to the review — a reviewer who can see the diff but
 * not the checks should lose the pill, not the page.
 */
export async function fetchChecks(coords: PrCoordinates): Promise<ChecksSummary | undefined> {
  try {
    const result = await githubClient.graphql(buildChecksQuery(coords));
    if (!result || !result.success) {
      log.warn('query failed', result?.error);
      return undefined;
    }

    // The connector hands back the raw GraphQL envelope, so the payload sits
    // one level down under its own `data` key.
    const envelope = (result as unknown as IOperationResult<unknown>).data;
    if (!envelope || typeof envelope !== 'object') {
      log.warn('query returned no envelope');
      return undefined;
    }

    const response = envelope as Record<string, unknown>;
    if (Array.isArray(response.errors) && response.errors.length > 0) {
      // A failed non-null isRequired field can erase a whole context. Do not
      // present the remaining rows as a complete, passing set of requirements.
      log.warn('query returned GraphQL errors');
      return undefined;
    }
    const summary = parseChecks(response.data);
    if (!summary || summary.checks.some((check) => check.isRequired === undefined)) {
      log.warn('query returned incomplete check requirements');
    }
    return summary;
  } catch (error) {
    log.warn('query threw', error);
    return undefined;
  }
}
