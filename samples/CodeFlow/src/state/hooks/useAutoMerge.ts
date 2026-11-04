import { useCallback, useEffect, useRef } from 'react';
import {
  disableAutoMerge as disableAutoMergePr,
  enableAutoMerge as enableAutoMergePr,
  fetchAutoMerge,
  type AutoMergeStatus,
} from '../../services/autoMerge';
import { shouldTrackAutoMerge } from '../../components/AutoMergeButton/autoMergeGate';
import type { MergeMethod, PrCoordinates } from '../../types';
import type { CodeFlowState } from '../codeFlowContext';

type SetState = React.Dispatch<React.SetStateAction<CodeFlowState>>;

function samePr(a: PrCoordinates | undefined, b: PrCoordinates): boolean {
  return a?.owner === b.owner && a?.name === b.name && a?.number === b.number;
}

/**
 * Keep the PR's auto-merge state in state, and let the author change it.
 *
 * Reads ride the poll cadence via `lastRefreshAt`, exactly as checks do, so
 * auto-merge re-reads when the rest of the PR does without adding a second
 * timer to reason about. It also means a manual refresh picks up an auto-merge
 * somebody armed from GitHub's own UI.
 *
 * Unlike checks, the read is skipped entirely for anyone who couldn't act on
 * the answer — see {@link shouldTrackAutoMerge}. A reviewer's session is the
 * common case and shouldn't spend a request per poll on a control it will
 * never show.
 */
export function useAutoMerge(state: CodeFlowState, setState: SetState) {
  const pr = state.pr;
  const coords = pr?.coordinates;
  const nodeId = pr?.nodeId;

  // Guards against a slow answer for one PR overwriting a newer one's, which
  // is easy to hit by navigating between PRs quickly.
  const seq = useRef(0);

  const apply = useCallback(
    (target: PrCoordinates, status: AutoMergeStatus | undefined) => {
      setState((s) =>
        samePr(s.pr?.coordinates, target)
          ? { ...s, autoMerge: status, autoMergeLoading: false }
          : { ...s, autoMergeLoading: false },
      );
    },
    [setState],
  );

  const load = useCallback(
    async (target: PrCoordinates) => {
      const mine = ++seq.current;
      setState((s) => ({ ...s, autoMergeLoading: true }));
      const status = await fetchAutoMerge(target);
      if (mine !== seq.current) return;
      apply(target, status);
    },
    [apply, setState],
  );

  // Depends on the coordinates as primitives so a fresh object identity on each
  // render doesn't re-trigger the fetch.
  const owner = coords?.owner;
  const name = coords?.name;
  const number = coords?.number;
  const tracked = shouldTrackAutoMerge(pr, state.currentUser);

  useEffect(() => {
    if (!tracked || owner === undefined || name === undefined || number === undefined) return;
    void load({ owner, name, number });
  }, [tracked, owner, name, number, state.lastRefreshAt, load]);

  const enableAutoMerge = useCallback(
    async (method: MergeMethod): Promise<void> => {
      if (!coords) throw new Error('No pull request is loaded.');
      const status = await enableAutoMergePr(coords, method, nodeId);
      // Bump the sequence so an in-flight read can't land afterwards and
      // report the state as it was before this call.
      seq.current += 1;
      apply(coords, status);
    },
    [apply, coords, nodeId],
  );

  const disableAutoMerge = useCallback(async (): Promise<void> => {
    if (!coords) throw new Error('No pull request is loaded.');
    const status = await disableAutoMergePr(coords, nodeId);
    seq.current += 1;
    apply(coords, status);
  }, [apply, coords, nodeId]);

  return { enableAutoMerge, disableAutoMerge };
}
