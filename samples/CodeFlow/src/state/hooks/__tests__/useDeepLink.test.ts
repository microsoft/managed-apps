import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDeepLink, useDeepLinkPending, findThreadForDeepLink } from '../useDeepLink';
import type { CodeFlowActions, CodeFlowState, LoadStatus } from '../../codeFlowContext';
import type { CommentThread, PrSummary } from '../../../types';
import { resetOpenPrMemory, resolveOpenTarget } from '../../../utils/openPrMemory';

const readDeepLink = vi.fn();
const updateUrlTarget = vi.fn();
vi.mock('../../../utils/deepLink', () => ({
  readDeepLink: (...a: unknown[]) => readDeepLink(...a),
  updateUrlTarget: (...a: unknown[]) => updateUrlTarget(...a),
}));

const BASE_STATE: CodeFlowState = {
  status: 'idle',
  iterations: [],
  fromIndex: 0,
  toIndex: 0,
  comparisonLoading: false,
  seen: {},
  threads: [],
  threadsLoading: false,
  closed: {},
  closedBy: {},
  viewMode: 'inline',
  reviewers: [],
};

function makeActions(): CodeFlowActions {
  return {
    loadPr: vi.fn().mockResolvedValue(undefined),
    selectFile: vi.fn(),
    focusThread: vi.fn(),
  } as unknown as CodeFlowActions;
}

function thread(over: Partial<CommentThread>): CommentThread {
  return {
    id: 'T1',
    prKey: 'o/r#7',
    filename: 'src/a.ts',
    side: 'right',
    line: 3,
    status: 'active',
    comments: [],
    ...over,
  } as CommentThread;
}

function readyState(over: Partial<CodeFlowState> = {}): CodeFlowState {
  return {
    ...BASE_STATE,
    status: 'ready',
    pr: { coordinates: { owner: 'o', name: 'r', number: 7 } } as PrSummary,
    fullRange: { files: [{ filename: 'src/a.ts' }] } as CodeFlowState['fullRange'],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readDeepLink.mockReturnValue(null);
  resetOpenPrMemory();
});

describe('findThreadForDeepLink', () => {
  const threads = [
    thread({ id: 'T1', threadNodeId: 'PRRT_abc', comments: [{ id: '99' }] as CommentThread['comments'] }),
    thread({ id: 'T2' }),
  ];

  it('matches on thread id, node id, or comment id', () => {
    expect(findThreadForDeepLink(threads, 'T1')?.id).toBe('T1');
    expect(findThreadForDeepLink(threads, 'PRRT_abc')?.id).toBe('T1');
    expect(findThreadForDeepLink(threads, '99')?.id).toBe('T1');
  });

  it('returns undefined when nothing matches', () => {
    expect(findThreadForDeepLink(threads, 'nope')).toBeUndefined();
  });
});

describe('useDeepLink', () => {
  it('does nothing without a deep link', () => {
    const actions = makeActions();
    renderHook(() => useDeepLink(BASE_STATE, actions));
    expect(actions.loadPr).not.toHaveBeenCalled();
  });

  it('loads the PR named by the deep link exactly once', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7 });
    const actions = makeActions();
    const { rerender } = renderHook(({ s }) => useDeepLink(s, actions), {
      initialProps: { s: BASE_STATE },
    });

    expect(actions.loadPr).toHaveBeenCalledWith({ owner: 'o', name: 'r', number: 7 });

    rerender({ s: readyState() });
    expect(actions.loadPr).toHaveBeenCalledTimes(1);
  });

  it('selects the deep-linked file once the comparison has loaded', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7, file: 'src/a.ts' });
    const actions = makeActions();
    const { rerender } = renderHook(({ s }) => useDeepLink(s, actions), {
      initialProps: { s: BASE_STATE },
    });

    expect(actions.selectFile).not.toHaveBeenCalled();

    rerender({ s: readyState() });
    expect(actions.selectFile).toHaveBeenCalledWith('src/a.ts');

    // Applied once, so a later manual file change isn't clobbered.
    rerender({ s: readyState({ selectedFile: 'other.ts' }) });
    expect(actions.selectFile).toHaveBeenCalledTimes(1);
  });

  it('ignores a file that is not part of the diff', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7, file: 'ghost.ts' });
    const actions = makeActions();
    renderHook(() => useDeepLink(readyState(), actions));
    expect(actions.selectFile).not.toHaveBeenCalled();
  });

  it('focuses the deep-linked comment once threads arrive', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7, commentId: '99' });
    const actions = makeActions();
    const { rerender } = renderHook(({ s }) => useDeepLink(s, actions), {
      initialProps: { s: readyState() },
    });

    // Threads load asynchronously after the PR, so nothing to focus yet.
    expect(actions.focusThread).not.toHaveBeenCalled();

    rerender({
      s: readyState({
        threads: [thread({ id: 'T9', comments: [{ id: '99' }] as CommentThread['comments'] })],
      }),
    });
    expect(actions.focusThread).toHaveBeenCalledWith('T9');
  });

  it('ignores the deep link when a different PR is loaded', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7, file: 'src/a.ts' });
    const actions = makeActions();
    const other = readyState({
      pr: { coordinates: { owner: 'o', name: 'r', number: 8 } } as PrSummary,
    });
    renderHook(() => useDeepLink(other, actions));
    expect(actions.selectFile).not.toHaveBeenCalled();
  });

  it('points the URL at the PR the reviewer moved to', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7 });
    const actions = makeActions();
    const { rerender } = renderHook(({ s }) => useDeepLink(s, actions), {
      initialProps: { s: readyState() },
    });
    // Arriving on the linked PR leaves the URL as it was.
    expect(updateUrlTarget).toHaveBeenCalledWith({ owner: 'o', repo: 'r', number: 7 });

    rerender({
      s: readyState({ pr: { coordinates: { owner: 'o', name: 'r', number: 8 } } as PrSummary }),
    });
    expect(updateUrlTarget).toHaveBeenLastCalledWith({ owner: 'o', repo: 'r', number: 8 });
  });

  it('keeps the file target in the URL while still on the linked PR', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7, file: 'src/a.ts' });
    renderHook(() => useDeepLink(readyState(), makeActions()));
    expect(updateUrlTarget).toHaveBeenCalledWith({
      owner: 'o',
      repo: 'r',
      number: 7,
      file: 'src/a.ts',
    });
  });

  it('resolves to the PR last opened after a refresh', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7 });
    const { rerender } = renderHook(({ s }) => useDeepLink(s, makeActions()), {
      initialProps: { s: readyState() },
    });
    rerender({
      s: readyState({ pr: { coordinates: { owner: 'o', name: 'r', number: 8 } } as PrSummary }),
    });

    // The player replays its original URL on refresh, so the record is what
    // carries the reviewer back to the PR they actually had open.
    expect(resolveOpenTarget()).toEqual({ owner: 'o', repo: 'r', number: 8 });
  });

  it('clears the link once the reviewer returns to the dashboard', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7 });
    const { rerender } = renderHook(({ s }) => useDeepLink(s, makeActions()), {
      initialProps: { s: readyState() },
    });

    rerender({ s: BASE_STATE });
    expect(updateUrlTarget).toHaveBeenLastCalledWith(null);
    expect(resolveOpenTarget()).toBeNull();
  });

  it('does not clear the link before the deep-linked PR has loaded', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7 });
    renderHook(() => useDeepLink(BASE_STATE, makeActions()));
    expect(updateUrlTarget).not.toHaveBeenCalled();
    expect(resolveOpenTarget()).toEqual({ owner: 'o', repo: 'r', number: 7 });
  });
});

describe('useDeepLinkPending', () => {
  it('reports no pending link when the URL has none', () => {
    const { result } = renderHook(() => useDeepLinkPending('idle'));
    expect(result.current).toBeNull();
  });

  it('reports the target while the PR is still loading', () => {
    const target = { owner: 'o', repo: 'r', number: 7 };
    readDeepLink.mockReturnValue(target);
    const { result, rerender } = renderHook(({ s }: { s: LoadStatus }) => useDeepLinkPending(s), {
      initialProps: { s: 'idle' as LoadStatus },
    });
    expect(result.current).toEqual(target);

    rerender({ s: 'loading' as LoadStatus });
    expect(result.current).toEqual(target);
  });

  it('clears once the PR is ready', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7 });
    const { result, rerender } = renderHook(({ s }: { s: LoadStatus }) => useDeepLinkPending(s), {
      initialProps: { s: 'idle' as LoadStatus },
    });
    rerender({ s: 'ready' as LoadStatus });
    expect(result.current).toBeNull();
  });

  it('clears on error so the dashboard can surface the failure', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7 });
    const { result, rerender } = renderHook(({ s }: { s: LoadStatus }) => useDeepLinkPending(s), {
      initialProps: { s: 'idle' as LoadStatus },
    });
    rerender({ s: 'error' as LoadStatus });
    expect(result.current).toBeNull();
  });

  it('stays cleared when the reviewer navigates back to the dashboard', () => {
    readDeepLink.mockReturnValue({ owner: 'o', repo: 'r', number: 7 });
    const { result, rerender } = renderHook(({ s }: { s: LoadStatus }) => useDeepLinkPending(s), {
      initialProps: { s: 'idle' as LoadStatus },
    });
    rerender({ s: 'ready' as LoadStatus });
    rerender({ s: 'idle' as LoadStatus });
    expect(result.current).toBeNull();
  });
});
