import type { CodeFlowState } from '../codeFlowContext';
import { recordLastReviewed } from '../../utils/storage';

/**
 * Record the selected iteration, or an explicit submitted commit, in state.
 *
 * This is written as a state transform rather than a callback because the
 * actions that trigger it already run inside `setState` updaters, and starting
 * a second state update from inside one is not safe. It also has to survive
 * being run twice for the same event: React StrictMode invokes every updater
 * twice and keeps the *second* result, so a version that only reported the
 * record when it moved would lose it on the replay. Asking storage for the
 * current record either way makes both invocations agree.
 */
export function withReviewedIteration(
  state: CodeFlowState,
  prKey: string,
  reviewedSha?: string,
): CodeFlowState {
  const toIndex = reviewedSha === undefined
    ? state.toIndex
    : state.iterations.findIndex((it) => it.sha === reviewedSha);
  if (toIndex < 0) return state;
  const next = recordLastReviewed(prKey, state.iterations, toIndex);
  if (!next) return state;
  const current = state.lastReviewed;
  if (current && current.sha === next.sha && current.at === next.at) return state;
  return { ...state, lastReviewed: next };
}
