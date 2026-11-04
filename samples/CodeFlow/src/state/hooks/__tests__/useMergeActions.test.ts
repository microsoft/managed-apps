import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';

const mergePullRequest = vi.fn();
vi.mock('../../../services/githubService', () => ({
  GitHubService: { mergePullRequest: (...args: unknown[]) => mergePullRequest(...args) },
}));
vi.mock('../../../lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { useMergeActions } from '../useMergeActions';
import type { CodeFlowState } from '../../codeFlowContext';
import type { PrSummary } from '../../../types';

function makePr(over: Partial<PrSummary> = {}): PrSummary {
  return {
    coordinates: { owner: 'octo-org', name: 'octo-repo', number: 123 },
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

/**
 * Drive the hook against real React state, so the optimistic patch is observed
 * the way the provider observes it rather than through a spy on setState.
 */
function harness(initial: Partial<CodeFlowState>) {
  return renderHook(() => {
    const [state, setState] = useState({ ...initial } as CodeFlowState);
    return { state, ...useMergeActions(state, setState) };
  });
}

beforeEach(() => {
  mergePullRequest.mockReset();
  mergePullRequest.mockResolvedValue({ merged: true, sha: 'merged-sha' });
});

describe('useMergeActions', () => {
  it('refuses when there is no PR loaded, instead of calling GitHub with nothing', async () => {
    const { result } = harness({ pr: undefined });
    await expect(result.current.mergePr('merge')).rejects.toThrow(/No pull request/i);
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it('merges the loaded PR with the chosen strategy', async () => {
    const { result } = harness({ pr: makePr() });

    await act(async () => {
      await result.current.mergePr('rebase');
    });

    expect(mergePullRequest).toHaveBeenCalledWith(
      { owner: 'octo-org', name: 'octo-repo', number: 123 },
      { method: 'rebase', expectedHeadSha: 'deadbeef' },
    );
  });

  it('sends no sha guard when the PR has no head sha to pin', async () => {
    const { result } = harness({ pr: makePr({ headSha: '' }) });

    await act(async () => {
      await result.current.mergePr('merge');
    });

    expect(mergePullRequest.mock.calls[0][1]).toMatchObject({ expectedHeadSha: undefined });
  });

  // The poll only reads the head sha, so without this the topbar would go on
  // offering to merge a PR that has already landed.
  it('marks the PR merged locally, since polling will never notice', async () => {
    const { result } = harness({ pr: makePr() });

    await act(async () => {
      await result.current.mergePr('merge');
    });

    expect(result.current.state.pr).toMatchObject({ merged: true, state: 'closed' });
  });

  it('returns the outcome to the caller', async () => {
    const { result } = harness({ pr: makePr() });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.mergePr('merge');
    });

    expect(outcome).toEqual({ merged: true, sha: 'merged-sha' });
  });

  it('leaves the PR alone when the merge fails', async () => {
    mergePullRequest.mockRejectedValue(new Error('Head branch was modified.'));
    const { result } = harness({ pr: makePr() });

    await act(async () => {
      await expect(result.current.mergePr('merge')).rejects.toThrow(/Head branch was modified/);
    });

    expect(result.current.state.pr).toMatchObject({ merged: false, state: 'open' });
  });

  // A merge that resolves after the user has navigated to a different PR must
  // not stamp "merged" onto whatever happens to be on screen now. Capture the
  // updater and apply it to the state that would exist after navigation.
  it('does not patch a PR the user has since navigated away from', async () => {
    const state = { pr: makePr() } as CodeFlowState;
    const updaters: ((s: CodeFlowState) => CodeFlowState)[] = [];
    const setState = ((u: (s: CodeFlowState) => CodeFlowState) => updaters.push(u)) as React.Dispatch<
      React.SetStateAction<CodeFlowState>
    >;

    const { result } = renderHook(() => useMergeActions(state, setState));
    await act(async () => {
      await result.current.mergePr('merge');
    });

    const navigatedAway = {
      pr: makePr({ coordinates: { owner: 'octo-org', name: 'other', number: 99 } }),
    } as CodeFlowState;
    expect(updaters).toHaveLength(1);
    expect(updaters[0](navigatedAway)).toBe(navigatedAway);
  });
});
