import type { DeepLinkTarget } from '../../utils/deepLink';
import type { LoadStatus } from '../../state/codeFlowContext';
import type { PrCoordinates } from '../../types';

/**
 * The splash target for a load the reviewer started inside the app (a dashboard
 * row, the jump box), or null when the splash shouldn't show.
 *
 * `hasPr` is what keeps a background refresh — polling reloads the PR whenever a
 * new commit lands — from yanking a reviewer out of the diff and onto a splash:
 * those reloads happen with a PR already on screen, so they stay silent.
 */
export function openingSplashTarget(
  status: LoadStatus,
  pendingPr: PrCoordinates | undefined,
  hasPr: boolean,
): DeepLinkTarget | null {
  if (status !== 'loading' || !pendingPr || hasPr) return null;
  return { owner: pendingPr.owner, repo: pendingPr.name, number: pendingPr.number };
}
