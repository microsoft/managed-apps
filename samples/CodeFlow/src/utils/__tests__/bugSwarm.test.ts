import { describe, it, expect } from 'vitest';
import {
  BUGS_PER_COMMENT,
  BUG_MAX_DELAY_MS,
  BUG_MAX_FLIGHT_MS,
  BUG_MIN_FLIGHT_MS,
  BUG_SWARM_MS,
  MAX_BUGS,
  freshCommentIds,
  planSwarm,
  settledCommentIds,
} from '../bugSwarm';
import { newPendingId } from '../pendingComment';
import type { Comment, CommentThread } from '../../types';

function comment(id: string): Comment {
  return {
    id,
    author: { login: 'octocat' },
    body: 'looks good',
    createdAt: '2024-01-01T00:00:00Z',
  };
}

function thread(id: string, ...commentIds: string[]): CommentThread {
  return {
    id,
    prKey: 'o/r#1',
    filename: 'src/App.tsx',
    line: 1,
    side: 'right',
    status: 'active',
    comments: commentIds.map(comment),
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

/** Deterministic stand-in for Math.random, cycling a fixed set of draws. */
function stubRandom(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('settledCommentIds', () => {
  it('collects comment ids across every thread', () => {
    const ids = settledCommentIds([thread('t1', 'c1', 'c2'), thread('t2', 'c3')]);
    expect([...ids].sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('leaves out optimistic ids, which are replaced moments later', () => {
    const ids = settledCommentIds([thread('t1', 'c1', newPendingId())]);
    expect([...ids]).toEqual(['c1']);
  });

  it('is empty when there is nothing on screen', () => {
    expect(settledCommentIds([]).size).toBe(0);
  });
});

describe('freshCommentIds', () => {
  it('reports only what was not there before', () => {
    const seen = new Set(['c1']);
    expect(freshCommentIds([thread('t1', 'c1', 'c2')], seen)).toEqual(['c2']);
  });

  it('reports nothing when the same comments come back', () => {
    const seen = new Set(['c1', 'c2']);
    expect(freshCommentIds([thread('t1', 'c1', 'c2')], seen)).toEqual([]);
  });

  it('does not treat an optimistic comment as an arrival', () => {
    expect(freshCommentIds([thread('t1', newPendingId())], new Set())).toEqual([]);
  });

  it('reports a deleted-then-restored comment again', () => {
    expect(freshCommentIds([thread('t1', 'c1')], new Set(['c9']))).toEqual(['c1']);
  });
});

describe('planSwarm', () => {
  const random = stubRandom([0.1, 0.4, 0.7, 0.9, 0.25, 0.6]);

  it('scales the swarm with the number of comments that arrived', () => {
    expect(planSwarm(1, random)).toHaveLength(BUGS_PER_COMMENT);
    expect(planSwarm(2, random)).toHaveLength(2 * BUGS_PER_COMMENT);
  });

  it('caps a bulk refresh so it stays a joke rather than an infestation', () => {
    expect(planSwarm(50, random)).toHaveLength(MAX_BUGS);
  });

  it('still sends up a swarm when asked for a fractional or zero count', () => {
    expect(planSwarm(0, random).length).toBeGreaterThan(0);
    expect(planSwarm(0.2, random).length).toBeGreaterThan(0);
  });

  it('launches every bug from inside the viewport', () => {
    for (const bug of planSwarm(3, random)) {
      expect(bug.startX).toBeGreaterThanOrEqual(0);
      expect(bug.startX).toBeLessThanOrEqual(100);
      expect(bug.startY).toBeGreaterThanOrEqual(0);
      expect(bug.startY).toBeLessThanOrEqual(100);
    }
  });

  it('keeps every bug inside the swarm budget', () => {
    for (const bug of planSwarm(3, random)) {
      expect(bug.delayMs).toBeGreaterThanOrEqual(0);
      expect(bug.delayMs).toBeLessThanOrEqual(BUG_MAX_DELAY_MS);
      expect(bug.delayMs + bug.durationMs).toBeLessThanOrEqual(BUG_SWARM_MS);
    }
  });

  it('gives every bug a flight long enough to be watched', () => {
    for (const bug of planSwarm(3, random)) {
      expect(bug.durationMs).toBeGreaterThanOrEqual(BUG_MIN_FLIGHT_MS);
      expect(bug.durationMs).toBeLessThanOrEqual(BUG_MAX_FLIGHT_MS);
    }
  });

  it('gives the bugs their own speeds, so the swarm does not move as a block', () => {
    const durations = new Set(planSwarm(2, random).map((b) => b.durationMs));
    expect(durations.size).toBeGreaterThan(1);
  });

  it('scatters the launch points instead of dealing them all onto one ring', () => {
    const starts = new Set(planSwarm(2, random).map((b) => `${b.startX},${b.startY}`));
    expect(starts.size).toBeGreaterThan(1);
  });

  it('gives every bug a distinct key and something to draw', () => {
    const bugs = planSwarm(2, random);
    expect(new Set(bugs.map((b) => b.id)).size).toBe(bugs.length);
    expect(bugs.every((b) => b.glyph.length > 0)).toBe(true);
  });

  it('sends the bugs off in different directions rather than in a clump', () => {
    const bugs = planSwarm(2, random);
    const headings = bugs.map((b) => Math.round(Math.atan2(b.driftY, b.driftX) * 100));
    expect(new Set(headings).size).toBeGreaterThan(1);
  });

  it('sends each bug far enough to be seen crossing the screen', () => {
    for (const bug of planSwarm(2, random)) {
      expect(Math.hypot(bug.driftX, bug.driftY)).toBeGreaterThanOrEqual(24);
    }
  });

  it('bends each path off the straight line, so the bugs arc rather than dart', () => {
    for (const bug of planSwarm(2, random)) {
      // Non-zero cross product: the halfway point is off the line between the
      // launch point and the end of the flight.
      expect(Math.abs(bug.midX * bug.driftY - bug.midY * bug.driftX)).toBeGreaterThan(0);
    }
  });

  it('bends some paths one way and some the other', () => {
    const sides = new Set(
      planSwarm(2, stubRandom([0.1, 0.4, 0.7, 0.9, 0.25, 0.6, 0.35])).map((b) =>
        Math.sign(b.midX * b.driftY - b.midY * b.driftX),
      ),
    );
    expect(sides.size).toBeGreaterThan(1);
  });

  it('is reproducible for a given source of randomness', () => {
    expect(planSwarm(2, stubRandom([0.3, 0.8, 0.5]))).toEqual(
      planSwarm(2, stubRandom([0.3, 0.8, 0.5])),
    );
  });
});
