import type { PrCoordinates, PrSummary } from '../../types';

/**
 * The parts of a pull request that can change while the branch stays put.
 *
 * Everything else on a {@link PrSummary} — the base and head shas above all —
 * is load-bearing for the iteration model, so it is deliberately *not* folded
 * in by {@link foldPrStatus}: a moved head has to go through a full reload or
 * the diff on screen stops matching the shas the app reasons about.
 */
export type PrStatusFields = Pick<
  PrSummary,
  'state' | 'merged' | 'draft' | 'mergeable' | 'mergeableState' | 'updatedAt'
>;

/** True when two coordinate triples name the same pull request. */
export function samePr(a: PrCoordinates, b: PrCoordinates): boolean {
  return a.owner === b.owner && a.name === b.name && a.number === b.number;
}

/**
 * Fold a freshly-polled pull request's status back onto the one on screen.
 *
 * Polling used to read the fresh PR purely to compare head shas and then throw
 * it away, so a pull request merged (or closed, or marked ready for review)
 * from anywhere else kept its stale chip until the reviewer navigated away and
 * opened it again — the topbar cheerfully reporting "Open" for something that
 * had already landed, and the merge button still offering to merge it.
 *
 * Two invariants are enforced on the way through, both of which exist because
 * the merge button patches `merged` optimistically the moment GitHub accepts
 * the merge:
 *
 * 1. `merged` only ever goes false → true. Merging is one-way on GitHub, so a
 *    poll that was already in flight when the merge landed is answering about
 *    the past; letting it win would put the badge back to "Open" for a whole
 *    refresh interval, which is precisely the bug this exists to fix.
 * 2. A merged pull request is closed and is not a draft, whatever the response
 *    says, so the three fields can never disagree with each other on screen.
 *
 * Returns `prev` unchanged when nothing moved, so a quiet poll doesn't churn
 * the object identity that memoized children depend on.
 */
export function foldPrStatus(prev: PrSummary, fresh: PrStatusFields): PrSummary {
  const merged = prev.merged || fresh.merged;
  const state = merged ? 'closed' : fresh.state;
  const draft = merged ? false : fresh.draft;
  const updatedAt = fresh.updatedAt ?? prev.updatedAt;

  const unchanged =
    prev.state === state &&
    prev.merged === merged &&
    prev.draft === draft &&
    prev.mergeable === fresh.mergeable &&
    prev.mergeableState === fresh.mergeableState &&
    prev.updatedAt === updatedAt;
  if (unchanged) return prev;

  return {
    ...prev,
    state,
    merged,
    draft,
    mergeable: fresh.mergeable,
    mergeableState: fresh.mergeableState,
    updatedAt,
  };
}
