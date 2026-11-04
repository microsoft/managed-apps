/**
 * The bug swarm: when a comment lands on screen, a handful of insects wander
 * out across the app for a few seconds and are gone.
 *
 * Pure on purpose — deciding *that* a swarm is due and deciding *what it looks
 * like* are both plain functions of the threads and a random source, so the
 * whole easter egg can be exercised without a browser.
 */

import type { CommentThread } from '../types';
import { isPendingCommentId } from './pendingComment';

/**
 * How long one bug is in the air.
 *
 * A range rather than a constant, and a slow one: at the second-or-less it used
 * to be, the swarm read as a flicker at the edge of your vision — over before
 * you could look at it, and identical bug to bug because they all shared the
 * one duration. Insects that take a few seconds to wander through can actually
 * be watched, and giving each its own speed stops the swarm moving as a block.
 */
export const BUG_MIN_FLIGHT_MS = 2600;
export const BUG_MAX_FLIGHT_MS = 4200;

/**
 * The widest stagger between the first bug leaving and the last. Kept as a
 * budget rather than a free-for-all so the swarm always finishes inside
 * {@link BUG_SWARM_MS}, however many bugs are flying.
 */
export const BUG_MAX_DELAY_MS = 1400;

/** Total lifetime of a swarm: the last bug to leave, plus the longest flight. */
export const BUG_SWARM_MS = BUG_MAX_FLIGHT_MS + BUG_MAX_DELAY_MS;

/** Bugs sent up per comment that appeared. */
export const BUGS_PER_COMMENT = 4;

/**
 * Ceiling on a single swarm. A background refresh can bring in a dozen comments
 * at once, and a hundred insects is a jump scare rather than a joke.
 */
export const MAX_BUGS = 12;

/**
 * The band of the app a bug may launch from, in percent.
 *
 * Bugs used to be dealt onto a tight ring around the centre, which made every
 * swarm the same shape: a starburst out of the middle of the screen. Scattering
 * the launch points instead means no two swarms start alike, and the insects
 * turn up where you are actually looking rather than only where you aren't.
 */
const START_MIN = 12;
const START_MAX = 88;

/** How far a bug travels overall, in viewport units. */
const MIN_TRAVEL = 24;
const MAX_TRAVEL = 55;

/**
 * How far the halfway point is pushed sideways off the straight line, in
 * viewport units. This is what makes the path a curve: a bug that drifts out
 * and arcs looks alive, where one that runs down a ruled line looks fired.
 */
const MIN_WANDER = 10;
const MAX_WANDER = 30;

const MIN_SCALE = 0.8;
const MAX_SCALE = 1.5;

/** Wobble applied to each bug's heading so the ring doesn't look surveyed. */
const HEADING_JITTER = 0.9;

/** Total rotation over a flight. Modest, because the flight is a long one. */
const MAX_SPIN_DEG = 240;

const TAU = Math.PI * 2;

const GLYPHS = ['🐝', '🦋', '🐞', '🪰', '🐜', '🦗'] as const;

export interface Bug {
  /** Unique within its swarm. */
  id: string;
  glyph: string;
  /** Launch point, in percent of the app's box. */
  startX: number;
  startY: number;
  /** Halfway point of the flight, in viewport units from the launch point. */
  midX: number;
  midY: number;
  /** Travel from the launch point, in viewport units. */
  driftX: number;
  driftY: number;
  /** Rotation over the flight, in degrees. */
  spin: number;
  delayMs: number;
  /** How long this particular bug is in the air. */
  durationMs: number;
  scale: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Every comment id currently on screen that GitHub has acknowledged.
 *
 * Optimistic ids are left out deliberately. They are replaced by the real id a
 * moment later, and counting both would send up two swarms for the one comment
 * the reviewer actually posted.
 */
export function settledCommentIds(threads: readonly CommentThread[]): Set<string> {
  const ids = new Set<string>();
  for (const thread of threads) {
    for (const comment of thread.comments) {
      if (!isPendingCommentId(comment.id)) ids.add(comment.id);
    }
  }
  return ids;
}

/** Which settled comments weren't on screen last time we looked. */
export function freshCommentIds(
  threads: readonly CommentThread[],
  seen: ReadonlySet<string>,
): string[] {
  const fresh: string[] = [];
  for (const id of settledCommentIds(threads)) {
    if (!seen.has(id)) fresh.push(id);
  }
  return fresh;
}

/**
 * Lay out one swarm.
 *
 * Headings are dealt round a circle before the jitter is applied, so the bugs
 * leave in every direction instead of clumping wherever the random numbers
 * happened to land — with four of them, three going the same way reads as a
 * glitch rather than as a swarm.
 *
 * Everything else about a bug is drawn independently: where it starts, how far
 * and how fast it goes, which way its path bends and when it sets off. That
 * independence is the point. A swarm whose members share a speed and an origin
 * moves like one object, and the eye reads it as a wipe across the screen
 * rather than as a dozen separate insects.
 */
export function planSwarm(newComments: number, random: () => number = Math.random): Bug[] {
  const count = Math.min(MAX_BUGS, Math.max(1, Math.round(newComments)) * BUGS_PER_COMMENT);
  const bugs: Bug[] = [];

  for (let i = 0; i < count; i++) {
    const heading = (i / count) * TAU + (random() - 0.5) * HEADING_JITTER;
    const travel = MIN_TRAVEL + random() * (MAX_TRAVEL - MIN_TRAVEL);
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);

    // Perpendicular to the heading, either side of it, so the arc bends left
    // for some of the swarm and right for the rest.
    const wander = (MIN_WANDER + random() * (MAX_WANDER - MIN_WANDER)) * (random() < 0.5 ? -1 : 1);
    const driftX = cos * travel;
    const driftY = sin * travel;

    bugs.push({
      id: `bug-${i}`,
      glyph: GLYPHS[i % GLYPHS.length],
      startX: round1(START_MIN + random() * (START_MAX - START_MIN)),
      startY: round1(START_MIN + random() * (START_MAX - START_MIN)),
      midX: round1(driftX / 2 - sin * wander),
      midY: round1(driftY / 2 + cos * wander),
      driftX: round1(driftX),
      driftY: round1(driftY),
      spin: Math.round((random() - 0.5) * MAX_SPIN_DEG),
      delayMs: Math.round(random() * BUG_MAX_DELAY_MS),
      durationMs: Math.round(BUG_MIN_FLIGHT_MS + random() * (BUG_MAX_FLIGHT_MS - BUG_MIN_FLIGHT_MS)),
      scale: round1(MIN_SCALE + random() * (MAX_SCALE - MIN_SCALE)),
    });
  }

  return bugs;
}
