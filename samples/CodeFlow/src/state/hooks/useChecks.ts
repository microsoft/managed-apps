import { useCallback, useEffect, useRef } from 'react';
import { fetchChecks } from '../../services/checks';
import type { PrCoordinates } from '../../types';
import type { CodeFlowState } from '../codeFlowContext';

type SetState = React.Dispatch<React.SetStateAction<CodeFlowState>>;

/**
 * Keep the PR's check results in state.
 *
 * Deliberately separate from `usePrLoader`: checks are the slowest-moving and
 * least essential part of the page, and folding them into the load would make
 * the diff wait on a request it doesn't need. Here they arrive on their own and
 * the pill appears when they land.
 *
 * Refreshes are driven off `lastRefreshAt` rather than a timer of their own, so
 * checks re-read exactly when the rest of the PR does — including on a manual
 * refresh — without adding a second cadence to reason about.
 */
export function useChecks(
  coords: PrCoordinates | undefined,
  headSha: string | undefined,
  lastRefreshAt: number | undefined,
  setState: SetState,
) {
  // Guards against a slow response for one PR overwriting a newer one's
  // results, which is easy to hit by navigating between PRs quickly.
  const seq = useRef(0);

  const load = useCallback(
    async (target: PrCoordinates | undefined) => {
      if (!target) return;
      const mine = ++seq.current;
      setState((s) => ({ ...s, checksLoading: true }));
      const summary = await fetchChecks(target);
      if (mine !== seq.current) return;
      setState((s) => {
        // The PR moved on while this was in flight; its answer is now wrong.
        if (
          s.pr?.coordinates.owner !== target.owner ||
          s.pr?.coordinates.name !== target.name ||
          s.pr?.coordinates.number !== target.number
        ) {
          return { ...s, checksLoading: false };
        }
        return { ...s, checks: summary, checksLoading: false };
      });
    },
    [setState],
  );

  // Depends on the coordinates as primitives so a fresh object identity on each
  // render doesn't re-trigger the fetch. `headSha` is a trigger and not an
  // argument: a push replaces every check on the PR, but the request is still
  // addressed by PR number.
  const owner = coords?.owner;
  const name = coords?.name;
  const number = coords?.number;

  useEffect(() => {
    if (owner === undefined || name === undefined || number === undefined) return;
    void load({ owner, name, number });
  }, [owner, name, number, headSha, lastRefreshAt, load]);

  const refreshChecks = useCallback(() => load(coords), [load, coords]);

  return { refreshChecks };
}
