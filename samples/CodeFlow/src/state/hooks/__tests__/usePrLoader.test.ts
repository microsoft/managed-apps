import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as React from 'react';
import { renderHook, act } from '@testing-library/react';
import type { CodeFlowState } from '../../codeFlowContext';
import type { CommentStore } from '../../../services/comments/CommentStore';
import type { AuthorApproval, PrCoordinates, Reviewer } from '../../../types';

// --- Mocks for usePrLoader's collaborators ---------------------------------

const getPullRequest = vi.fn();
const getCurrentUser = vi.fn();
const getAuthenticatedUser = vi.fn();
const compare = vi.fn();
const getIterations = vi.fn();
const listPullRequestFiles = vi.fn();

vi.mock('../../../services/githubService', () => ({
  GitHubService: {
    getPullRequest: (...a: unknown[]) => getPullRequest(...a),
    getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
    getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
    compare: (...a: unknown[]) => compare(...a),
    getIterations: (...a: unknown[]) => getIterations(...a),
    listPullRequestFiles: (...a: unknown[]) => listPullRequestFiles(...a),
  },
  mergePullRequestFiles: (compared: { filename: string }[], pr?: { filename: string }[]) =>
    pr ? [...compared, ...pr.filter((f) => !compared.some((c) => c.filename === f.filename))] : compared,
}));

const loadThreadsWithFallback = vi.fn();
vi.mock('../../../services/comments', () => ({
  loadThreadsWithFallback: (...a: unknown[]) => loadThreadsWithFallback(...a),
}));

const addInProgressReview = vi.fn();
const removeInProgressReview = vi.fn();
const pruneFlaggedPrs = vi.fn();
const addFlaggedPr = vi.fn();

vi.mock('../../../utils/storage', () => ({
  prKey: () => 'o/r#1',
  pushRecentPr: vi.fn(),
  getClosedThreads: () => ({}),
  getClosedAttribution: () => ({}),
  refreshPrState: vi.fn(async () => {}),
  addInProgressReview: (...a: unknown[]) => addInProgressReview(...a),
  removeInProgressReview: (...a: unknown[]) => removeInProgressReview(...a),
  pruneFlaggedPrs: (...a: unknown[]) => pruneFlaggedPrs(...a),
  addFlaggedPr: (...a: unknown[]) => addFlaggedPr(...a),
  getLastReviewed: vi.fn(() => undefined),
  recordIterationShas: vi.fn(() => ({
    knownShas: [],
    lostShas: [],
    updatedAt: '2026-01-01T00:00:00Z',
  })),
}));

vi.mock('../useFileSelection', () => ({
  computeSeenForRange: () => ({}),
}));

const fetchReviewers = vi.fn();
vi.mock('../useReviewActions', () => ({
  fetchReviewers: (...a: unknown[]) => fetchReviewers(...a),
}));

const fetchAuthorApproval = vi.fn();
vi.mock('../../../services/authorApproval', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../services/authorApproval')>(),
  fetchAuthorApproval: (...a: unknown[]) => fetchAuthorApproval(...a),
}));

import { usePrLoader, usePrPolling } from '../usePrLoader';
import {
  resetSettingsStoreForTests,
  updateSettings,
} from '../../../settings/settingsStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function makeStore(overrides: Partial<CommentStore> = {}): CommentStore {
  return {
    backend: 'local',
    label: 'Local',
    listThreads: vi.fn().mockResolvedValue([]),
    createThread: vi.fn(),
    addComment: vi.fn(),
    setStatus: vi.fn(),
    deleteThread: vi.fn(),
    ...overrides,
  } as unknown as CommentStore;
}

const COORDS: PrCoordinates = { owner: 'o', name: 'r', number: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsStoreForTests();
  getPullRequest.mockResolvedValue({
    coordinates: COORDS,
    title: 'Test PR',
    state: 'open',
    merged: false,
    baseSha: 'base',
    headSha: 'head',
  });
  getCurrentUser.mockResolvedValue({ login: 'me' });
  getAuthenticatedUser.mockResolvedValue({ login: 'gh-me' });
  compare.mockResolvedValue({ files: [{ filename: 'a.ts' }] });
  getIterations.mockResolvedValue([{ sha: 'aaaaaaaaaaaa' }, { sha: 'bbbbbbbbbbbb' }]);
  listPullRequestFiles.mockResolvedValue(undefined);
  loadThreadsWithFallback.mockImplementation(async () => ({ store: makeStore(), threads: [] }));
  fetchReviewers.mockReset().mockResolvedValue([]);
  fetchAuthorApproval.mockReset().mockResolvedValue(null);
});

function harness() {
  let currentState = {
    status: 'idle',
    viewMode: 'inline',
    threadsLoading: false,
    threads: [],
    iterations: [],
    fromIndex: 0,
    toIndex: 0,
    comparisonLoading: false,
    seen: {},
    closed: {},
    reviewers: [],
  } as unknown as CodeFlowState;

  const setState = vi.fn((fn) => {
    currentState = typeof fn === 'function' ? fn(currentState) : fn;
  }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
  const patch = vi.fn((p: Partial<CodeFlowState>) => {
    currentState = { ...currentState, ...p };
  });
  const setBackendLabel = vi.fn();

  return {
    get state() {
      return currentState;
    },
    setState,
    patch,
    setBackendLabel,
  };
}

describe('usePrLoader comments', () => {
  it('reads threads from GitHub and makes the GitHub store the active one', async () => {
    const h = harness();
    const storeRef = { current: makeStore() };
    const ghThreads = [{ id: 't1' }];
    const ghStore = makeStore({ backend: 'github', label: 'GitHub (synced)' } as Partial<CommentStore>);
    loadThreadsWithFallback.mockResolvedValue({ store: ghStore, threads: ghThreads });

    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, storeRef, h.setBackendLabel),
    );
    await act(async () => {
      await result.current.loadPr(COORDS);
    });

    expect(loadThreadsWithFallback).toHaveBeenCalledWith('o/r#1');
    expect(h.state.status).toBe('ready');
    expect(h.state.threadsLoading).toBe(false);
    expect(h.state.threads).toEqual(ghThreads);
    expect(storeRef.current).toBe(ghStore);
    expect(h.setBackendLabel).toHaveBeenCalledWith('GitHub (synced)');
  });

  it('uses the browser-local store when GitHub could not be read', async () => {
    const h = harness();
    const storeRef = { current: makeStore() };
    const local = makeStore({ label: 'Local (this device)' } as Partial<CommentStore>);
    loadThreadsWithFallback.mockResolvedValue({ store: local, threads: [] });

    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, storeRef, h.setBackendLabel),
    );
    await act(async () => {
      await result.current.loadPr(COORDS);
    });

    expect(h.state.status).toBe('ready');
    expect(storeRef.current).toBe(local);
    expect(h.setBackendLabel).toHaveBeenCalledWith('Local (this device)');
  });

  it('adds files the comparison left out, from the pull request file list', async () => {
    const h = harness();
    listPullRequestFiles.mockResolvedValue([
      { filename: 'extra.ts', status: 'added', additions: 1, deletions: 0, changes: 1 },
    ]);
    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, { current: makeStore() }, h.setBackendLabel),
    );
    await act(async () => {
      await result.current.loadPr(COORDS);
    });
    expect(h.state.fullRange?.files.map((f) => f.filename)).toEqual(['a.ts', 'extra.ts']);
  });
});

describe('usePrLoader author approval', () => {
  const approval: AuthorApproval = {
    user: { login: 'author' }, source: 'codeflow', state: 'APPROVED',
    commitId: 'head', submittedAt: '2026-10-02T12:00:00Z', approvedCommitIds: ['head'],
  };

  it('merges history arriving after the author saves an approval during initial load', async () => {
    const pending = deferred<AuthorApproval>();
    fetchAuthorApproval.mockReturnValue(pending.promise);
    const h = harness();
    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, { current: makeStore() }, h.setBackendLabel),
    );
    await act(async () => { await result.current.loadPr(COORDS); });
    h.setState((prev) => ({ ...prev, authorApproval: approval }));
    await act(async () => {
      pending.resolve({
        ...approval, commitId: 'first', approvedCommitIds: ['first'], submittedAt: '2026-10-01T12:00:00Z',
      });
      await flushMicrotasks();
    });
    expect(h.state.authorApproval).toMatchObject({ commitId: 'head', approvedCommitIds: ['head', 'first'] });
  });

  it('loads shared author approval for a different viewer without replacing GitHub votes', async () => {
    fetchAuthorApproval.mockResolvedValue(approval);
    fetchReviewers.mockResolvedValue([{ user: { login: 'reviewer' }, state: 'APPROVED' }]);
    const h = harness();
    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, { current: makeStore() }, h.setBackendLabel),
    );
    await act(async () => { await result.current.loadPr(COORDS); });
    expect(h.state.currentUser?.login).toBe('gh-me');
    expect(h.state.authorApproval).toEqual(approval);
    expect(h.state.reviewers[0]?.user.login).toBe('reviewer');
  });

  it('does not fail the PR load or GitHub reviews when app approval is unavailable', async () => {
    fetchAuthorApproval.mockResolvedValue(undefined);
    const h = harness();
    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, { current: makeStore() }, h.setBackendLabel),
    );
    await act(async () => { await result.current.loadPr(COORDS); });
    expect(h.state.status).toBe('ready');
    expect(h.state.authorApproval).toBeUndefined();
    expect(h.state.reviewers).toEqual([]);
  });

  it('ignores late approvals after switching PRs, including returning to the same coordinates', async () => {
    const pending = deferred<AuthorApproval>();
    fetchAuthorApproval.mockReturnValueOnce(pending.promise).mockResolvedValue(null);
    const h = harness();
    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, { current: makeStore() }, h.setBackendLabel),
    );
    await act(async () => { await result.current.loadPr(COORDS); });
    act(() => result.current.reset());
    await act(async () => { await result.current.loadPr(COORDS); });
    await act(async () => { pending.resolve(approval); await flushMicrotasks(); });
    expect(h.state.authorApproval).toBeNull();
  });
});

describe('usePrLoader signed-in user', () => {
  it('prefers the GitHub connector identity so it matches review votes', async () => {
    const h = harness();
    const storeRef = { current: makeStore() };

    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, storeRef, h.setBackendLabel),
    );

    await act(async () => {
      await result.current.loadPr(COORDS);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(h.state.currentUser).toEqual({ login: 'gh-me' });
  });

  it('falls back to the managed-apps host identity when the connector can not say who we are', async () => {
    getAuthenticatedUser.mockResolvedValue(undefined);
    const h = harness();
    const storeRef = { current: makeStore() };

    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, storeRef, h.setBackendLabel),
    );

    await act(async () => {
      await result.current.loadPr(COORDS);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(h.state.currentUser).toEqual({ login: 'me' });
  });
});

describe('usePrLoader approval history', () => {
  const reviewers: Reviewer[] = [{
    user: { login: 'gh-me' }, state: 'COMMENTED', approvedCommitIds: ['aaaaaaaaaaaa'],
  }];

  it('loads approval history alongside the GitHub identity', async () => {
    fetchReviewers.mockResolvedValue(reviewers);
    const h = harness();
    const storeRef = { current: makeStore() };
    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, storeRef, h.setBackendLabel),
    );

    await act(async () => { await result.current.loadPr(COORDS); });
    expect(h.state.currentUser?.login).toBe('gh-me');
    expect(h.state.reviewers).toEqual(reviewers);
  });

  it.each(['another PR', 'reload', 'reset'])('ignores a late approval response after %s', async (next) => {
    const oldRead = deferred<Reviewer[]>();
    fetchReviewers.mockReturnValueOnce(oldRead.promise);
    const h = harness();
    const storeRef = { current: makeStore() };
    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, storeRef, h.setBackendLabel),
    );
    await act(async () => { await result.current.loadPr(COORDS); });

    await act(async () => {
      if (next === 'reset') {
        result.current.reset();
      } else {
        const coords = next === 'reload' ? COORDS : { ...COORDS, number: 2 };
        getPullRequest.mockResolvedValue({ ...h.state.pr, coordinates: coords });
        await result.current.loadPr(coords);
      }
      oldRead.resolve(reviewers);
      await flushMicrotasks();
    });

    expect(h.state.reviewers).toEqual([]);
  });
});

describe('usePrLoader file source', () => {
  it('keeps compare files (with patches) and appends files only the PR list has', async () => {
    const h = harness();
    const storeRef = { current: makeStore() };

    // GraphQL's PR file list is complete but carries no patches, so compare's
    // entries win and anything compare left out is appended.
    const prFiles = [
      { filename: 'a.ts', additions: 1, deletions: 0, changes: 1 },
      { filename: 'z.ts', additions: 2, deletions: 0, changes: 2 },
    ];
    listPullRequestFiles.mockResolvedValue(prFiles);

    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, storeRef, h.setBackendLabel),
    );

    await act(async () => {
      await result.current.loadPr(COORDS);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(listPullRequestFiles).toHaveBeenCalledWith(COORDS);
    expect(h.state.comparison?.files).toEqual([{ filename: 'a.ts' }, prFiles[1]]);
    expect(h.state.fullRange?.files).toEqual([{ filename: 'a.ts' }, prFiles[1]]);
    expect(h.state.selectedFile).toBe('a.ts');
  });

  it('falls back to compare files when the PR-files endpoint is unavailable', async () => {
    const h = harness();
    const storeRef = { current: makeStore() };
    listPullRequestFiles.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, storeRef, h.setBackendLabel),
    );

    await act(async () => {
      await result.current.loadPr(COORDS);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(h.state.comparison?.files).toEqual([{ filename: 'a.ts' }]);
    expect(h.state.selectedFile).toBe('a.ts');
  });

  it('ignores an empty PR-files list and keeps compare files', async () => {
    const h = harness();
    const storeRef = { current: makeStore() };
    listPullRequestFiles.mockResolvedValue([]);

    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, storeRef, h.setBackendLabel),
    );

    await act(async () => {
      await result.current.loadPr(COORDS);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(h.state.comparison?.files).toEqual([{ filename: 'a.ts' }]);
  });
});

describe('usePrLoader dashboard tracking', () => {
  async function load() {
    const h = harness();
    const storeRef = { current: makeStore() };
    const { result } = renderHook(() =>
      usePrLoader(h.setState, h.patch, storeRef, h.setBackendLabel),
    );
    await act(async () => {
      await result.current.loadPr(COORDS);
    });
    await act(async () => {
      await flushMicrotasks();
    });
    return h;
  }

  it('tracks an open PR as an in-progress review', async () => {
    getPullRequest.mockResolvedValue({
      coordinates: COORDS,
      title: 'Test PR',
      state: 'open',
      merged: false,
      baseSha: 'base',
      headSha: 'head',
    });

    await load();

    expect(addInProgressReview).toHaveBeenCalledWith({
      owner: 'o',
      name: 'r',
      number: 1,
      title: 'Test PR',
    });
    expect(removeInProgressReview).not.toHaveBeenCalled();
    expect(pruneFlaggedPrs).not.toHaveBeenCalled();
  });

  it('auto-flags an open PR by default', async () => {
    await load();

    expect(addFlaggedPr).toHaveBeenCalledWith({
      owner: 'o',
      name: 'r',
      number: 1,
      title: 'Test PR',
    });
  });

  it('does not auto-flag when the setting is off', async () => {
    updateSettings({ autoFlagOpenedPrs: false });

    await load();

    expect(addFlaggedPr).not.toHaveBeenCalled();
    // Tracking the review is a separate concern and must still happen.
    expect(addInProgressReview).toHaveBeenCalledTimes(1);
  });

  it('never auto-flags a PR that is already finished', async () => {
    getPullRequest.mockResolvedValue({
      coordinates: COORDS,
      title: 'Test PR',
      state: 'closed',
      merged: true,
      baseSha: 'base',
      headSha: 'head',
    });

    await load();

    expect(addFlaggedPr).not.toHaveBeenCalled();
  });

  // The dashboard no longer polls each tracked PR's state, so opening a
  // finished PR is what clears it out of the tracked lists.
  it.each([
    ['merged', { state: 'closed', merged: true }],
    ['closed without merging', { state: 'closed', merged: false }],
  ])('untracks a PR that is %s', async (_label, prState) => {
    getPullRequest.mockResolvedValue({
      coordinates: COORDS,
      title: 'Test PR',
      baseSha: 'base',
      headSha: 'head',
      ...prState,
    });

    await load();

    expect(addInProgressReview).not.toHaveBeenCalled();
    expect(removeInProgressReview).toHaveBeenCalledWith('o', 'r', 1);
    expect(pruneFlaggedPrs).toHaveBeenCalledTimes(1);

    // The predicate must match only this PR, never a different one.
    const predicate = pruneFlaggedPrs.mock.calls[0][0] as (f: {
      owner: string;
      name: string;
      number: number;
    }) => boolean;
    expect(predicate({ owner: 'o', name: 'r', number: 1 })).toBe(true);
    expect(predicate({ owner: 'o', name: 'r', number: 2 })).toBe(false);
    expect(predicate({ owner: 'other', name: 'r', number: 1 })).toBe(false);
  });
});

describe('usePrPolling status refresh', () => {
  /**
   * Drive `usePrPolling` with a PR already on screen. `refreshIntervalSeconds`
   * is zeroed so no background timer is installed — every poll in these tests
   * is the one `refreshNow()` triggers, which keeps them deterministic.
   */
  function pollingHarness(prOverrides: Record<string, unknown> = {}) {
    updateSettings({ refreshIntervalSeconds: 0 });

    let currentState = {
      status: 'ready',
      pr: {
        coordinates: COORDS,
        title: 'Test PR',
        state: 'open',
        draft: false,
        merged: false,
        baseSha: 'base',
        headSha: 'head',
        ...prOverrides,
      },
    } as unknown as CodeFlowState;

    const setState = vi.fn((fn) => {
      currentState = typeof fn === 'function' ? fn(currentState) : fn;
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;

    const refreshThreads = vi.fn().mockResolvedValue(undefined);
    const loadPr = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      usePrPolling('o/r#1', currentState, refreshThreads, loadPr, setState),
    );

    return {
      get pr() {
        return currentState.pr;
      },
      setPr(next: unknown) {
        currentState = { ...currentState, pr: next } as unknown as CodeFlowState;
      },
      refreshThreads,
      loadPr,
      async poll() {
        await act(async () => {
          await result.current.refreshNow();
        });
      },
    };
  }

  // The bug this guards: polling used to read the fresh PR only to compare head
  // shas, so a pull request merged from anywhere else kept saying "Open" until
  // the reviewer navigated away and opened it again.
  it('notices a merge that happened on GitHub while the PR was open', async () => {
    const h = pollingHarness();
    getPullRequest.mockResolvedValue({
      coordinates: COORDS,
      title: 'Test PR',
      state: 'closed',
      draft: false,
      merged: true,
      baseSha: 'base',
      headSha: 'head',
    });

    await h.poll();

    expect(h.pr).toMatchObject({ merged: true, state: 'closed' });
    // The branch never moved, so there is nothing to reload.
    expect(h.loadPr).not.toHaveBeenCalled();
  });

  it('notices a close that happened on GitHub', async () => {
    const h = pollingHarness();
    getPullRequest.mockResolvedValue({
      coordinates: COORDS,
      state: 'closed',
      draft: false,
      merged: false,
      baseSha: 'base',
      headSha: 'head',
    });

    await h.poll();

    expect(h.pr).toMatchObject({ merged: false, state: 'closed' });
  });

  it('keeps an optimistically merged PR merged when a stale response disagrees', async () => {
    const h = pollingHarness({ merged: true, state: 'closed' });
    getPullRequest.mockResolvedValue({
      coordinates: COORDS,
      state: 'open',
      draft: false,
      merged: false,
      baseSha: 'base',
      headSha: 'head',
    });

    await h.poll();

    expect(h.pr).toMatchObject({ merged: true, state: 'closed' });
  });

  it('reloads instead of folding when the branch moved', async () => {
    const h = pollingHarness();
    getPullRequest.mockResolvedValue({
      coordinates: COORDS,
      state: 'open',
      draft: false,
      merged: false,
      baseSha: 'base',
      headSha: 'moved',
    });

    await h.poll();

    expect(h.loadPr).toHaveBeenCalledWith(COORDS);
    // Folding a new head sha onto the old iterations would leave the app
    // reasoning about a diff nobody has seen, so the reload owns that.
    expect(h.pr).toMatchObject({ headSha: 'head' });
  });

  it('reloads once, not once per invocation of the state updater', async () => {
    const h = pollingHarness();
    getPullRequest.mockResolvedValue({
      coordinates: COORDS,
      state: 'open',
      draft: false,
      merged: false,
      baseSha: 'base',
      headSha: 'moved',
    });

    await h.poll();

    expect(h.loadPr).toHaveBeenCalledTimes(1);
  });

  it('ignores a response that lands after the reviewer moved to another PR', async () => {
    const h = pollingHarness();
    const pending = deferred<unknown>();
    getPullRequest.mockReturnValue(pending.promise);

    const polling = h.poll();
    // The reviewer opens a different pull request before the answer arrives.
    const other = {
      coordinates: { owner: 'o', name: 'r', number: 2 },
      state: 'open',
      draft: false,
      merged: false,
      baseSha: 'base',
      headSha: 'head',
    };
    h.setPr(other);
    pending.resolve({
      coordinates: COORDS,
      state: 'closed',
      draft: false,
      merged: true,
      baseSha: 'base',
      headSha: 'head',
    });
    await polling;

    expect(h.pr).toMatchObject({ coordinates: { number: 2 }, merged: false, state: 'open' });
    expect(h.loadPr).not.toHaveBeenCalled();
  });

  it('survives a failed status fetch without disturbing the PR on screen', async () => {
    const h = pollingHarness();
    getPullRequest.mockRejectedValue(new Error('offline'));

    await h.poll();

    expect(h.pr).toMatchObject({ merged: false, state: 'open' });
  });
});
