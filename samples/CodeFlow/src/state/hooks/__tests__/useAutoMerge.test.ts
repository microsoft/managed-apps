import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useState } from 'react';

const fetchAutoMerge = vi.fn();
const enableAutoMergePr = vi.fn();
const disableAutoMergePr = vi.fn();

vi.mock('../../../services/autoMerge', () => ({
  fetchAutoMerge: (...args: unknown[]) => fetchAutoMerge(...args),
  enableAutoMerge: (...args: unknown[]) => enableAutoMergePr(...args),
  disableAutoMerge: (...args: unknown[]) => disableAutoMergePr(...args),
}));

import { useAutoMerge } from '../useAutoMerge';
import type { CodeFlowState } from '../../codeFlowContext';
import type { PrSummary } from '../../../types';

function makePr(over: Partial<PrSummary> = {}): PrSummary {
  return {
    coordinates: { owner: 'octo-org', name: 'octo-repo', number: 123 },
    nodeId: 'PR_abc',
    title: 'Do the thing',
    state: 'open',
    draft: false,
    merged: false,
    author: { login: 'octocat' },
    baseRef: 'main',
    baseSha: 'base',
    headRef: 'feature',
    headSha: 'deadbeef',
    ...over,
  };
}

const AUTHOR = { login: 'octocat' };

/** Drive the hook against real React state, the way the provider does. */
function harness(initial: Partial<CodeFlowState>) {
  return renderHook(() => {
    const [state, setState] = useState({ ...initial } as CodeFlowState);
    return { state, setState, ...useAutoMerge(state, setState) };
  });
}

beforeEach(() => {
  fetchAutoMerge.mockReset();
  fetchAutoMerge.mockResolvedValue({ enabled: false, viewerCanEnable: true });
  enableAutoMergePr.mockReset();
  enableAutoMergePr.mockResolvedValue({ enabled: true, method: 'squash', enabledBy: 'octocat' });
  disableAutoMergePr.mockReset();
  disableAutoMergePr.mockResolvedValue({ enabled: false });
});

describe('useAutoMerge', () => {
  it('reads the state for the author', async () => {
    const { result } = harness({ pr: makePr(), currentUser: AUTHOR });

    await waitFor(() =>
      expect(fetchAutoMerge).toHaveBeenCalledWith({
        owner: 'octo-org',
        name: 'octo-repo',
        number: 123,
      }),
    );
    await waitFor(() => expect(result.current.state.autoMerge).toMatchObject({ enabled: false }));
    expect(result.current.state.autoMergeLoading).toBe(false);
  });

  it('spends no request on a reviewer, who is never offered the control', async () => {
    harness({ pr: makePr(), currentUser: { login: 'someone-else' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchAutoMerge).not.toHaveBeenCalled();
  });

  it('re-reads when the poll ticks, so an auto-merge armed on GitHub shows up', async () => {
    const { result, rerender } = harness({ pr: makePr(), currentUser: AUTHOR, lastRefreshAt: 1 });
    await waitFor(() => expect(fetchAutoMerge).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setState((s) => ({ ...s, lastRefreshAt: 2 }));
    });
    rerender();

    await waitFor(() => expect(fetchAutoMerge).toHaveBeenCalledTimes(2));
  });

  it('arms it by node id, so no lookup is needed', async () => {
    const { result } = harness({ pr: makePr(), currentUser: AUTHOR });

    await act(async () => {
      await result.current.enableAutoMerge('squash');
    });

    expect(enableAutoMergePr).toHaveBeenCalledWith(
      { owner: 'octo-org', name: 'octo-repo', number: 123 },
      'squash',
      'PR_abc',
    );
    expect(result.current.state.autoMerge).toMatchObject({ enabled: true, method: 'squash' });
  });

  it('folds the new state in immediately rather than waiting for the next poll', async () => {
    const { result } = harness({
      pr: makePr(),
      currentUser: AUTHOR,
      autoMerge: { enabled: true, method: 'merge' },
    });

    await act(async () => {
      await result.current.disableAutoMerge();
    });

    expect(result.current.state.autoMerge).toMatchObject({ enabled: false });
  });

  it('is not overwritten by a read that was already in flight', async () => {
    let settle: ((v: unknown) => void) | undefined;
    fetchAutoMerge.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const { result } = harness({ pr: makePr(), currentUser: AUTHOR });
    await waitFor(() => expect(fetchAutoMerge).toHaveBeenCalled());

    await act(async () => {
      await result.current.enableAutoMerge('merge');
    });
    await act(async () => {
      settle?.({ enabled: false, viewerCanEnable: true });
      await Promise.resolve();
    });

    expect(result.current.state.autoMerge).toMatchObject({ enabled: true });
  });

  it('leaves another pull request’s state alone when the answer arrives late', async () => {
    const { result } = harness({ pr: makePr(), currentUser: AUTHOR });

    enableAutoMergePr.mockImplementation(async () => {
      result.current.setState((s) => ({
        ...s,
        pr: makePr({ coordinates: { owner: 'octo-org', name: 'other', number: 9 } }),
      }));
      return { enabled: true, method: 'merge' };
    });

    await act(async () => {
      await result.current.enableAutoMerge('merge');
    });

    expect(result.current.state.autoMerge).not.toMatchObject({ enabled: true });
    expect(result.current.state.pr?.coordinates.name).toBe('other');
  });

  it('refuses to act with no pull request loaded', async () => {
    const { result } = harness({});

    await expect(result.current.enableAutoMerge('merge')).rejects.toThrow(/No pull request/i);
    await expect(result.current.disableAutoMerge()).rejects.toThrow(/No pull request/i);
    expect(enableAutoMergePr).not.toHaveBeenCalled();
  });
});
