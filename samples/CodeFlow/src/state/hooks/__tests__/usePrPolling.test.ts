import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as React from 'react';
import { renderHook, act } from '@testing-library/react';
import type { CodeFlowState } from '../../codeFlowContext';
import type { AuthorApproval, PrCoordinates, Reviewer } from '../../../types';

const getPullRequest = vi.fn();

vi.mock('../../../services/githubService', () => ({
  GitHubService: {
    getPullRequest: (...a: unknown[]) => getPullRequest(...a),
    getCurrentUser: vi.fn(),
    compare: vi.fn(),
    getIterations: vi.fn(),
    listPullRequestFiles: vi.fn(),
  },
  mergePullRequestFiles: vi.fn(),
}));

vi.mock('../../../services/comments', () => ({
  loadThreadsWithFallback: vi.fn(),
}));

const fetchReviewers = vi.fn();
vi.mock('../useReviewActions', () => ({
  fetchReviewers: (...a: unknown[]) => fetchReviewers(...a),
}));

const fetchAuthorApproval = vi.fn();
vi.mock('../../../services/authorApproval', () => ({
  fetchAuthorApproval: (...a: unknown[]) => fetchAuthorApproval(...a),
}));

vi.mock('../useFileSelection', () => ({ computeSeenForRange: () => ({}) }));

import { usePrPolling } from '../usePrLoader';
import {
  resetSettingsStoreForTests,
  updateSettings,
} from '../../../settings/settingsStore';

const COORDS: PrCoordinates = { owner: 'o', name: 'r', number: 1 };

function harness(reviewers: unknown[] = [], opts: { defer?: boolean } = {}) {
  let currentState = {
    status: 'ready',
    pr: { coordinates: COORDS, headSha: 'head' },
    reviewers,
    threads: [],
  } as unknown as CodeFlowState;

  const queued: ((s: CodeFlowState) => CodeFlowState)[] = [];

  const setState = vi.fn((fn) => {
    if (typeof fn !== 'function') {
      currentState = fn;
      return;
    }
    // React only runs an updater at the moment it is queued while nothing else
    // is pending; once the fiber is dirty it is held back until the render
    // phase. `defer` is that second case, which is the normal one during a poll
    // because three concurrent responses all set state.
    if (opts.defer) queued.push(fn);
    else currentState = fn(currentState);
  }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;

  return {
    get state() {
      return currentState;
    },
    setState,
    flush() {
      for (const fn of queued.splice(0)) currentState = fn(currentState);
    },
  };
}

function render(
  h: ReturnType<typeof harness>,
  refreshThreads = vi.fn(async () => {}),
  loadPr: (coords: PrCoordinates) => Promise<void> = vi.fn(async () => {}),
) {
  const view = renderHook(() =>
    usePrPolling('o/r#1', h.state, refreshThreads, loadPr, h.setState),
  );
  return { ...view, refreshThreads, loadPr };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  resetSettingsStoreForTests();
  getPullRequest.mockResolvedValue({ coordinates: COORDS, headSha: 'head' });
  fetchReviewers.mockResolvedValue([]);
  fetchAuthorApproval.mockReset().mockResolvedValue(null);
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

describe('usePrPolling', () => {
  const approval: AuthorApproval = {
    user: { login: 'author' }, source: 'codeflow', state: 'APPROVED',
    commitId: 'head', submittedAt: '2026-10-02T12:00:00Z', approvedCommitIds: ['head'],
  };

  it('refreshes app-only author approval independently from GitHub votes', async () => {
    fetchAuthorApproval.mockResolvedValue(approval);
    fetchReviewers.mockResolvedValue(undefined);
    const h = harness([{ user: { login: 'reviewer' }, state: 'APPROVED' }]);
    const { result } = render(h);
    await act(async () => { await result.current.refreshNow(); });
    expect(h.state.authorApproval).toEqual(approval);
    expect(h.state.reviewers[0]?.user.login).toBe('reviewer');
  });

  it('retains an existing author approval on database read failure', async () => {
    fetchAuthorApproval.mockResolvedValue(undefined);
    const h = harness();
    h.setState((prev) => ({ ...prev, authorApproval: approval }));
    const { result } = render(h);
    await act(async () => { await result.current.refreshNow(); });
    expect(h.state.authorApproval).toEqual(approval);
  });

  it.each(['save', 'navigate'])('does not overwrite state when an old app read finishes after %s', async (change) => {
    let resolve!: (value: AuthorApproval | null) => void;
    fetchAuthorApproval.mockReturnValue(new Promise((r) => { resolve = r; }));
    const h = harness();
    const { result } = render(h);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refreshNow(); });
    if (change === 'save') {
      h.setState((prev) => ({ ...prev, authorApproval: approval }));
    } else {
      h.setState((prev) => ({
        ...prev, pr: prev.pr && { ...prev.pr, coordinates: { ...COORDS, number: 2 } },
      }));
    }
    await act(async () => { resolve(change === 'save' ? null : approval); await pending; });
    expect(h.state.authorApproval).toEqual(change === 'save' ? approval : undefined);
  });

  it('clears removed author approvals after a successful fresh database read', async () => {
    const h = harness();
    h.setState((prev) => ({ ...prev, authorApproval: approval }));
    const { result } = render(h);
    await act(async () => { await result.current.refreshNow(); });
    expect(h.state.authorApproval).toBeNull();
  });

  it('polls on the configured interval and stamps lastRefreshAt', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    const h = harness();
    const { refreshThreads } = render(h);

    expect(refreshThreads).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(refreshThreads).toHaveBeenCalledTimes(1);
    expect(fetchReviewers).toHaveBeenCalledTimes(1);
    expect(typeof h.state.lastRefreshAt).toBe('number');
  });

  it('does not poll when auto-refresh is turned off', async () => {
    updateSettings({ refreshIntervalSeconds: 0 });
    const h = harness();
    const { refreshThreads } = render(h);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(refreshThreads).not.toHaveBeenCalled();
  });

  it('does not poll while the tab is hidden', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    const h = harness();
    const { refreshThreads } = render(h);

    setHidden(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });

    // Ten ticks that nobody was there to see, at three GitHub calls each. Free
    // against an authenticated quota, ruinous against an anonymous one.
    expect(refreshThreads).not.toHaveBeenCalled();
  });

  it('catches up once the tab becomes visible again', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    const h = harness();
    const { refreshThreads } = render(h);

    setHidden(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(refreshThreads).not.toHaveBeenCalled();

    await act(async () => {
      setHidden(false);
      await vi.advanceTimersByTimeAsync(0);
    });

    // One catch-up poll, not one per tick missed — the reviewer wants current
    // data, not a replay.
    expect(refreshThreads).toHaveBeenCalledTimes(1);
  });

  it('does not poll on becoming visible when no tick was missed', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    const h = harness();
    const { refreshThreads } = render(h);

    await act(async () => {
      setHidden(true);
      setHidden(false);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(refreshThreads).not.toHaveBeenCalled();
  });

  it('refreshNow polls immediately and restarts the countdown', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    const h = harness();
    const { result, refreshThreads } = render(h);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(refreshThreads).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refreshNow();
    });
    expect(refreshThreads).toHaveBeenCalledTimes(1);

    // The timer restarted, so the original 30s deadline no longer fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(refreshThreads).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(refreshThreads).toHaveBeenCalledTimes(2);
  });

  it('reloads the PR when a new head commit lands', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    const h = harness();
    const { loadPr } = render(h);
    getPullRequest.mockResolvedValue({ coordinates: COORDS, headSha: 'newhead' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(loadPr).toHaveBeenCalledWith(COORDS);
  });

  it('reloads the PR when a new head lands and the state update is deferred', async () => {
    // The reported bug: a reviewer pushes, and the iteration list keeps showing
    // the old commits through tick after tick and through the manual refresh
    // button too. The reload was being decided inside a state updater and read
    // back immediately afterwards, so it only ever happened on the ticks where
    // React ran that updater on the spot — which is the minority of them, since
    // the two sibling requests in the same poll dirty the fiber first.
    updateSettings({ refreshIntervalSeconds: 30 });
    const h = harness([], { defer: true });
    const { loadPr } = render(h);
    getPullRequest.mockResolvedValue({ coordinates: COORDS, headSha: 'newhead' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(loadPr).toHaveBeenCalledWith(COORDS);

    // The deferred updates are not lost, they were simply never the thing that
    // decided the reload.
    h.flush();
    expect(typeof h.state.lastRefreshAt).toBe('number');
  });

  it('reloads on a manual refresh when the state update is deferred', async () => {
    updateSettings({ refreshIntervalSeconds: 0 });
    const h = harness([], { defer: true });
    const { result, loadPr } = render(h);
    getPullRequest.mockResolvedValue({ coordinates: COORDS, headSha: 'newhead' });

    await act(async () => {
      await result.current.refreshNow();
    });

    expect(loadPr).toHaveBeenCalledWith(COORDS);
  });

  it('does not stack reloads while one is still in flight', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    const h = harness();
    let finish: () => void = () => {};
    const loadPr = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(h, vi.fn(async () => {}), loadPr);
    getPullRequest.mockResolvedValue({ coordinates: COORDS, headSha: 'newhead' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    // Three ticks, one reload: the later ticks see the same moved head, and a
    // reload is several round-trips long.
    expect(loadPr).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(30_000);
    });

    // A finished reload releases the guard, so a head that is still ahead is
    // picked up again rather than being locked out for good.
    expect(loadPr).toHaveBeenCalledTimes(2);
  });

  it('folds a status change onto the PR when the head has not moved', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    const h = harness();
    const { loadPr } = render(h);
    getPullRequest.mockResolvedValue({
      coordinates: COORDS,
      headSha: 'head',
      merged: true,
      state: 'closed',
      draft: false,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(loadPr).not.toHaveBeenCalled();
    expect(h.state.pr).toMatchObject({ merged: true, state: 'closed', headSha: 'head' });
  });

  it('survives a failing poll without breaking the schedule', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    const h = harness();
    const refreshThreads = vi.fn(async () => { throw new Error('offline'); });
    render(h, refreshThreads);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(refreshThreads).toHaveBeenCalledTimes(2);
  });

  it('keeps the reviewer votes on screen when a poll can not read them', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    const votes = [{ user: { login: 'octocat' }, state: 'COMMENTED', approvedCommitIds: ['first'] }];
    const h = harness(votes);
    fetchReviewers.mockResolvedValue(undefined);
    render(h);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(h.state.reviewers).toEqual(votes);
  });

  it('refreshes approval history with reviewer votes', async () => {
    const h = harness();
    const { result } = render(h);
    const votes = [{ user: { login: 'octocat' }, state: 'COMMENTED', approvedCommitIds: ['first', 'head'] }];
    fetchReviewers.mockResolvedValue(votes);
    await act(async () => { await result.current.refreshNow(); });
    expect(h.state.reviewers).toEqual(votes);
  });

  it('does not apply another PR\'s late approval history', async () => {
    let resolveReviews!: (reviewers: Reviewer[]) => void;
    fetchReviewers.mockReturnValueOnce(new Promise<Reviewer[]>((resolve) => { resolveReviews = resolve; }));
    const h = harness();
    const { result, rerender } = render(h);
    let poll!: Promise<void>;
    act(() => { poll = result.current.refreshNow(); });
    act(() => {
      h.setState((prev) => ({
        ...prev,
        pr: prev.pr ? { ...prev.pr, coordinates: { ...COORDS, number: 2 } } : undefined,
        reviewers: [],
      }));
      rerender();
    });
    await act(async () => {
      resolveReviews([{ user: { login: 'octocat' }, state: 'APPROVED', approvedCommitIds: ['head'] }]);
      await poll;
    });
    expect(h.state.reviewers).toEqual([]);
  });

  it('clears the reviewer votes when the PR genuinely has none', async () => {
    updateSettings({ refreshIntervalSeconds: 30 });
    const h = harness([{ user: { login: 'octocat' }, state: 'COMMENTED' }]);
    fetchReviewers.mockResolvedValue([]);
    render(h);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(h.state.reviewers).toEqual([]);
  });
});
