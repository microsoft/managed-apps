import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { BugSwarmOverlay } from '../BugSwarm';
import { useBugSwarm, type BugSwarmInput } from '../useBugSwarm';
import { BUG_SWARM_MS, planSwarm } from '../../../utils/bugSwarm';
import { newPendingId } from '../../../utils/pendingComment';
import type { Comment, CommentThread } from '../../../types';

function comment(id: string): Comment {
  return { id, author: { login: 'octocat' }, body: 'nit', createdAt: '2024-01-01T00:00:00Z' };
}

/** A fresh array each call — the provider replaces `threads` on every poll. */
function threads(...commentIds: string[]): CommentThread[] {
  return [
    {
      id: 't1',
      prKey: 'o/r#1',
      filename: 'src/App.tsx',
      line: 1,
      side: 'right',
      status: 'active',
      comments: commentIds.map(comment),
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ];
}

const settled = (input: Partial<BugSwarmInput> = {}): BugSwarmInput => ({
  threads: threads(),
  threadsLoading: false,
  prKey: 'o/r#1',
  enabled: true,
  ...input,
});

describe('useBugSwarm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no matchMedia; the swarm needs to know motion is welcome.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ matches: false })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'matchMedia');
  });

  it('stays still for the comments that were already there', () => {
    const { result } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1', 'c2', 'c3') }),
    });
    expect(result.current.bugs).toHaveLength(0);
  });

  it('sends up a swarm when a comment arrives', () => {
    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1') }),
    });

    rerender(settled({ threads: threads('c1', 'c2') }));
    expect(result.current.bugs.length).toBeGreaterThan(0);
  });

  it('clears the swarm once the last bug has landed', () => {
    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1') }),
    });
    rerender(settled({ threads: threads('c1', 'c2') }));
    expect(result.current.bugs.length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(BUG_SWARM_MS + 1);
    });
    expect(result.current.bugs).toHaveLength(0);
  });

  it('does not fire twice for one comment the reviewer posted', () => {
    const pending = newPendingId();
    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1') }),
    });

    // Optimistic render: on screen instantly, but not acknowledged yet.
    rerender(settled({ threads: threads('c1', pending) }));
    expect(result.current.bugs).toHaveLength(0);

    // The server's id replaces it — this is the one and only swarm.
    rerender(settled({ threads: threads('c1', 'c2') }));
    const first = result.current.seq;
    expect(result.current.bugs.length).toBeGreaterThan(0);

    // A later poll returns the same comments; nothing new happened.
    rerender(settled({ threads: threads('c1', 'c2') }));
    expect(result.current.seq).toBe(first);
  });

  it('waits for the comments to settle before taking a baseline', () => {
    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: [], threadsLoading: true }),
    });

    // The initial fetch landing is not forty people commenting at once.
    rerender(settled({ threads: threads('c1', 'c2', 'c3'), threadsLoading: false }));
    expect(result.current.bugs).toHaveLength(0);

    rerender(settled({ threads: threads('c1', 'c2', 'c3', 'c4') }));
    expect(result.current.bugs.length).toBeGreaterThan(0);
  });

  it('absorbs the next PR\u2019s existing comments instead of celebrating them', () => {
    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1') }),
    });

    rerender(settled({ prKey: 'o/r#2', threads: threads('z1', 'z2') }));
    expect(result.current.bugs).toHaveLength(0);

    rerender(settled({ prKey: 'o/r#2', threads: threads('z1', 'z2', 'z3') }));
    expect(result.current.bugs.length).toBeGreaterThan(0);
  });

  it('scales the swarm when several comments land together', () => {
    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1') }),
    });

    rerender(settled({ threads: threads('c1', 'c2') }));
    const one = result.current.bugs.length;

    act(() => {
      vi.advanceTimersByTime(BUG_SWARM_MS + 1);
    });
    rerender(settled({ threads: threads('c1', 'c2', 'c3', 'c4', 'c5') }));
    expect(result.current.bugs.length).toBeGreaterThan(one);
  });

  it('restarts the animation when a comment lands mid-flight', () => {
    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1') }),
    });

    rerender(settled({ threads: threads('c1', 'c2') }));
    const first = result.current.seq;

    rerender(settled({ threads: threads('c1', 'c2', 'c3') }));
    expect(result.current.seq).toBeGreaterThan(first);
  });

  it('keeps a swarm in the air while the thread list is refreshed underneath it', () => {
    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1') }),
    });
    rerender(settled({ threads: threads('c1', 'c2') }));

    // A poll returns an identical-but-new array partway through the flight.
    act(() => {
      vi.advanceTimersByTime(BUG_SWARM_MS / 2);
    });
    rerender(settled({ threads: threads('c1', 'c2') }));
    expect(result.current.bugs.length).toBeGreaterThan(0);
  });

  it('stays out of the way when the reviewer has asked for less motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ matches: true })),
    });

    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1') }),
    });
    rerender(settled({ threads: threads('c1', 'c2') }));
    expect(result.current.bugs).toHaveLength(0);
  });

  it('stays down while the reviewer has it switched off', () => {
    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1'), enabled: false }),
    });
    rerender(settled({ threads: threads('c1', 'c2'), enabled: false }));
    expect(result.current.bugs).toHaveLength(0);
  });

  it('does not make up for lost time when it is switched on mid-review', () => {
    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1'), enabled: false }),
    });
    // Three comments land while nobody wanted to see them.
    rerender(settled({ threads: threads('c1', 'c2', 'c3', 'c4'), enabled: false }));
    rerender(settled({ threads: threads('c1', 'c2', 'c3', 'c4'), enabled: true }));
    expect(result.current.bugs).toHaveLength(0);

    // The next one to arrive, though, is fair game.
    rerender(settled({ threads: threads('c1', 'c2', 'c3', 'c4', 'c5'), enabled: true }));
    expect(result.current.bugs.length).toBeGreaterThan(0);
  });

  it('takes a swarm down mid-flight when the reviewer switches it off', () => {
    const { result, rerender } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1') }),
    });
    rerender(settled({ threads: threads('c1', 'c2') }));
    expect(result.current.bugs.length).toBeGreaterThan(0);

    rerender(settled({ threads: threads('c1', 'c2'), enabled: false }));
    expect(result.current.bugs).toHaveLength(0);
  });

  it('does not leave a timer running after the review is closed', () => {    const { rerender, unmount } = renderHook(useBugSwarm, {
      initialProps: settled({ threads: threads('c1') }),
    });
    rerender(settled({ threads: threads('c1', 'c2') }));

    unmount();
    expect(() => vi.advanceTimersByTime(BUG_SWARM_MS + 1)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('BugSwarmOverlay', () => {
  it('draws nothing when no swarm is in the air', () => {
    const { container } = render(<BugSwarmOverlay swarm={{ seq: 0, bugs: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws one insect per bug', () => {
    const bugs = planSwarm(1, () => 0.5);
    render(<BugSwarmOverlay swarm={{ seq: 1, bugs }} />);
    expect(screen.getByTestId('bugswarm').children).toHaveLength(bugs.length);
  });

  it('is decoration, so it is hidden from assistive tech', () => {
    render(<BugSwarmOverlay swarm={{ seq: 1, bugs: planSwarm(1, () => 0.5) }} />);
    expect(screen.getByTestId('bugswarm')).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives each insect its own heading to fly along', () => {
    const bugs = planSwarm(1, () => 0.5);
    render(<BugSwarmOverlay swarm={{ seq: 1, bugs }} />);
    const first = screen.getByTestId('bugswarm').children[0] as HTMLElement;
    expect(first.style.getPropertyValue('--bug-dx')).toBe(`${bugs[0].driftX}vw`);
    expect(first.style.getPropertyValue('--bug-dy')).toBe(`${bugs[0].driftY}vh`);
    expect(first.style.left).toBe(`${bugs[0].startX}%`);
  });

  it('gives each insect the bend in its path and its own speed', () => {
    const bugs = planSwarm(1, () => 0.5);
    render(<BugSwarmOverlay swarm={{ seq: 1, bugs }} />);
    const first = screen.getByTestId('bugswarm').children[0] as HTMLElement;
    expect(first.style.getPropertyValue('--bug-mx')).toBe(`${bugs[0].midX}vw`);
    expect(first.style.getPropertyValue('--bug-my')).toBe(`${bugs[0].midY}vh`);
    expect(first.style.animationDuration).toBe(`${bugs[0].durationMs}ms`);
  });
});
