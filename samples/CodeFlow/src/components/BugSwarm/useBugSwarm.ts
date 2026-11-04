import { useEffect, useRef, useState } from 'react';
import type { CommentThread } from '../../types';
import {
  BUG_SWARM_MS,
  freshCommentIds,
  planSwarm,
  settledCommentIds,
  type Bug,
} from '../../utils/bugSwarm';
import { prefersReducedMotion } from '../../utils/motion';

export interface Swarm {
  /**
   * Bumped for every swarm. Used as part of the React key so a second swarm
   * starting while the first is still in the air gets fresh DOM, and therefore
   * restarts the animation instead of inheriting a half-finished one.
   */
  seq: number;
  bugs: Bug[];
}

const NO_SWARM: Swarm = { seq: 0, bugs: [] };

export interface BugSwarmInput {
  threads: CommentThread[];
  /** True while the first full set of comments is still being fetched. */
  threadsLoading: boolean;
  /** Which PR these threads belong to; a change starts the tally over. */
  prKey?: string;
  /** The reviewer's opt-in. Off unless they went looking for it. */
  enabled: boolean;
}

/**
 * Send up a swarm whenever a comment appears on screen.
 *
 * Two things stop this from firing on comments that were already there:
 *
 * - The first settled snapshot only establishes the baseline. Opening a PR with
 *   forty comments is not forty events, and the whole point is to react to a
 *   comment *arriving*.
 * - The baseline is thrown away when the reviewer moves to another PR, so the
 *   next PR's existing comments are likewise absorbed rather than celebrated.
 *
 * Switched off, the tally is still kept — only the swarm is suppressed — so
 * turning it on mid-review reacts to the next comment rather than to every one
 * that arrived while it was off.
 *
 * A reviewer who has asked for reduced motion gets no swarm at all — this is
 * decoration, and it is the first thing that should go quiet.
 */
export function useBugSwarm({ threads, threadsLoading, prKey, enabled }: BugSwarmInput): Swarm {
  const seen = useRef<Set<string> | null>(null);
  const loadedKey = useRef<string | undefined>(undefined);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [swarm, setSwarm] = useState<Swarm>(NO_SWARM);

  // Cleared on unmount only. Deliberately *not* tied to the effect below, which
  // re-runs on every poll: a swarm cancelled each time the thread list is
  // replaced would flicker out well short of its full flight.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (prKey !== loadedKey.current) {
      loadedKey.current = prKey;
      seen.current = null;
    }

    // Wait for the comments to settle before taking the baseline, or the
    // initial fetch reads as everyone commenting at once.
    if (threadsLoading) return;

    if (seen.current === null) {
      seen.current = settledCommentIds(threads);
      return;
    }

    const fresh = freshCommentIds(threads, seen.current);
    seen.current = settledCommentIds(threads);
    if (!fresh.length || !enabled || prefersReducedMotion()) return;

    seq.current += 1;
    setSwarm({ seq: seq.current, bugs: planSwarm(fresh.length) });

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setSwarm(NO_SWARM);
    }, BUG_SWARM_MS);
  }, [threads, threadsLoading, prKey, enabled]);

  // Switched off, nothing shows — including a swarm that was already in flight
  // when the reviewer said stop. The state is left alone rather than reset,
  // because its own timer clears it a moment later either way, and resetting it
  // here would be a synchronous render-triggering write inside an effect.
  return enabled ? swarm : NO_SWARM;
}
