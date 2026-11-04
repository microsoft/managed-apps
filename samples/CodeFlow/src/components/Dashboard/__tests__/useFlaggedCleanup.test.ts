import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const getPullRequest = vi.fn();
vi.mock('../../../services/githubService', () => ({
  GitHubService: { getPullRequest: (...a: unknown[]) => getPullRequest(...a) },
}));

import { useFlaggedCleanup } from '../useFlaggedCleanup';
import { getFlaggedPrs, toggleFlaggedPr, type FlaggedPr } from '../../../utils/storage';

function pr(state: 'open' | 'closed', merged = false) {
  return { state, merged };
}

function seedFlags(...numbers: number[]): FlaggedPr[] {
  for (const n of numbers) toggleFlaggedPr({ owner: 'o', name: 'r', number: n });
  return getFlaggedPrs();
}

beforeEach(() => {
  getPullRequest.mockReset();
});

describe('useFlaggedCleanup', () => {
  it('makes no requests until it is explicitly run', () => {
    const flags = seedFlags(1, 2);
    renderHook(() => useFlaggedCleanup(flags, vi.fn()));
    expect(getPullRequest).not.toHaveBeenCalled();
  });

  it('removes flags for merged and closed PRs, keeping open ones', async () => {
    const flags = seedFlags(1, 2, 3); // stored newest-first: [3, 2, 1]
    getPullRequest.mockImplementation(({ number }: { number: number }) =>
      Promise.resolve(
        number === 1 ? pr('open') : number === 2 ? pr('closed', true) : pr('closed'),
      ),
    );
    const onChange = vi.fn();

    const { result } = renderHook(() => useFlaggedCleanup(flags, onChange));
    act(() => result.current.run());

    await waitFor(() => expect(result.current.running).toBe(false));
    expect(getFlaggedPrs().map((f) => f.number)).toEqual([1]);
    expect(result.current.removed).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps a flag when its status request fails (fails open)', async () => {
    const flags = seedFlags(1, 2);
    getPullRequest.mockImplementation(({ number }: { number: number }) =>
      number === 1 ? Promise.reject(new Error('rate limited')) : Promise.resolve(pr('closed')),
    );
    const onChange = vi.fn();

    const { result } = renderHook(() => useFlaggedCleanup(flags, onChange));
    act(() => result.current.run());

    await waitFor(() => expect(result.current.running).toBe(false));
    expect(getFlaggedPrs().map((f) => f.number)).toEqual([1]);
    expect(result.current.removed).toBe(1);
  });

  it('reports zero removals and does not notify when everything is still open', async () => {
    const flags = seedFlags(1, 2);
    getPullRequest.mockResolvedValue(pr('open'));
    const onChange = vi.fn();

    const { result } = renderHook(() => useFlaggedCleanup(flags, onChange));
    act(() => result.current.run());

    await waitFor(() => expect(result.current.removed).toBe(0));
    expect(getFlaggedPrs().map((f) => f.number)).toEqual([2, 1]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('issues exactly one request per flag, sequentially', async () => {
    const flags = seedFlags(1, 2, 3);
    let inFlight = 0;
    let maxInFlight = 0;
    getPullRequest.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return pr('open');
    });

    const { result } = renderHook(() => useFlaggedCleanup(flags, vi.fn()));
    act(() => result.current.run());

    await waitFor(() => expect(result.current.running).toBe(false));
    expect(getPullRequest).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);
  });
});
