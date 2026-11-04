/**
 * Where each check row points.
 *
 * A check run's `detailsUrl` is whatever the reporting app chose to put there,
 * which is sometimes a placeholder. GitHub's own per-check page is reachable by
 * id instead, and always shows the real output.
 */

import type { PrCheck, PrCoordinates } from '../../types';
import { githubLink, prPageUrl } from '../../utils/githubLink';

/**
 * Where a check row's link should go, or `undefined` when there's nowhere
 * useful to send the reviewer.
 *
 * Check runs go to GitHub's per-check view, which renders the full output the
 * summary was truncated from. Legacy statuses have no such page, so they fall
 * back to the target the reporter set (if it is a safe https link).
 */
export function checkLink(
  check: PrCheck,
  coords: PrCoordinates,
  prHtmlUrl?: string,
): string | undefined {
  if (check.kind === 'status') return githubLink(check.detailsUrl);

  // Rows that lost their database id fall back to the name as an id, which
  // GitHub can't resolve — send those to the checks tab rather than a dead row.
  const byId = /^\d+$/.test(check.id) ? `?check_run_id=${check.id}` : '';
  return `${prPageUrl(coords, prHtmlUrl)}/checks${byId}`;
}
