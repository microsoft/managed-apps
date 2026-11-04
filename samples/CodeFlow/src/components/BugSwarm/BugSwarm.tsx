import type { CSSProperties } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { useSettings } from '../../settings/useSettings';
import { useBugSwarm, type Swarm } from './useBugSwarm';

/**
 * The swarm itself.
 *
 * Split from the connected component so it can be rendered — and looked at — on
 * its own, without a whole review's worth of context standing behind it.
 *
 * Geometry travels as custom properties rather than as a per-bug keyframe:
 * there is one `@keyframes` in the stylesheet and every insect reads its own
 * launch point, heading, bend, spin and speed out of its inline style.
 */
export function BugSwarmOverlay({ swarm }: { swarm: Swarm }) {
  if (!swarm.bugs.length) return null;

  return (
    // Decoration, and several seconds of it — so it is hidden from assistive
    // tech and cannot swallow a click meant for the diff underneath.
    <div className="bugswarm" aria-hidden="true" data-testid="bugswarm">
      {swarm.bugs.map((bug) => (
        <span
          key={`${swarm.seq}-${bug.id}`}
          className="bugswarm__bug"
          style={
            {
              left: `${bug.startX}%`,
              top: `${bug.startY}%`,
              animationDelay: `${bug.delayMs}ms`,
              animationDuration: `${bug.durationMs}ms`,
              '--bug-mx': `${bug.midX}vw`,
              '--bug-my': `${bug.midY}vh`,
              '--bug-dx': `${bug.driftX}vw`,
              '--bug-dy': `${bug.driftY}vh`,
              '--bug-spin': `${bug.spin}deg`,
              '--bug-scale': bug.scale,
            } as CSSProperties
          }
        >
          {bug.glyph}
        </span>
      ))}
    </div>
  );
}

/**
 * Watches the loaded PR's comments and sends up a swarm when one arrives —
 * for the reviewers who turned it on in Settings.
 */
export function BugSwarm() {
  const { threads, threadsLoading, prKey } = useCodeFlow();
  const { settings } = useSettings();
  const swarm = useBugSwarm({ threads, threadsLoading, prKey, enabled: settings.bugSwarm });
  return <BugSwarmOverlay swarm={swarm} />;
}
