import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Only the search path is exercised here; the rest of the connector surface is
// stubbed so the module can load.
vi.mock('../../connectors/github', () => ({
  githubClient: {
    searchIssues: vi.fn(),
    getUser: vi.fn(),
  },
}));
vi.mock('@microsoft/managed-apps/auth', () => ({ getUser: vi.fn() }));

import { githubClient } from '../../connectors/github';
import { GitHubService, resetSearchCache } from '../githubService';

const mockSearch = vi.mocked(githubClient.searchIssues);

const QUERY = 'is:pr is:open review-requested:@me';

function searchResult(numbers: number[]) {
  return {
    success: true,
    data: {
      items: numbers.map((n) => ({
        number: n,
        title: `PR #${n}`,
        html_url: `https://github.example/o/r/pull/${n}`,
        repository_url: 'https://github.example/api/v3/repos/o/r',
        pull_request: {},
      })),
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSearchCache();
  mockSearch.mockResolvedValue(searchResult([1]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('searchPullRequests caching', () => {
  it('issues one request when the same query is asked for twice', async () => {
    await GitHubService.searchPullRequests(QUERY);
    await GitHubService.searchPullRequests(QUERY);

    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('shares a single in-flight request between concurrent callers', async () => {
    const [a, b] = await Promise.all([
      GitHubService.searchPullRequests(QUERY),
      GitHubService.searchPullRequests(QUERY),
    ]);

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('still returns the same data to the second caller', async () => {
    const first = await GitHubService.searchPullRequests(QUERY);
    const second = await GitHubService.searchPullRequests(QUERY);

    expect(second).toEqual(first);
    expect(second.map((i) => i.coordinates.number)).toEqual([1]);
  });

  it('keeps different queries in separate cache slots', async () => {
    await GitHubService.searchPullRequests(QUERY);
    await GitHubService.searchPullRequests('is:pr is:open author:@me');

    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('keeps the same query at different limits in separate slots', async () => {
    await GitHubService.searchPullRequests(QUERY, 25);
    await GitHubService.searchPullRequests(QUERY, 50);

    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('bypasses the cache when forced, so manual refresh really refetches', async () => {
    await GitHubService.searchPullRequests(QUERY);
    await GitHubService.searchPullRequests(QUERY, undefined, { force: true });

    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('re-populates the cache after a forced refresh', async () => {
    await GitHubService.searchPullRequests(QUERY);
    await GitHubService.searchPullRequests(QUERY, undefined, { force: true });
    await GitHubService.searchPullRequests(QUERY);

    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('re-issues the query once the entry has aged past the ttl', async () => {
    vi.useFakeTimers();

    await GitHubService.searchPullRequests(QUERY);
    vi.advanceTimersByTime(31_000);
    await GitHubService.searchPullRequests(QUERY);

    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('collapses a retry storm into one call while the failure is fresh', async () => {
    mockSearch.mockRejectedValue(new Error('boom'));

    await expect(GitHubService.searchPullRequests(QUERY)).rejects.toThrow('boom');
    await expect(GitHubService.searchPullRequests(QUERY)).rejects.toThrow('boom');

    // The platform SDK retries a failed call on its own, so a failure that
    // evicted instantly would double the request count at the worst moment.
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('re-issues the query once the brief failure window has passed', async () => {
    vi.useFakeTimers();
    mockSearch.mockRejectedValueOnce(new Error('boom'));

    await expect(GitHubService.searchPullRequests(QUERY)).rejects.toThrow('boom');

    // Long enough to clear the failure TTL, far short of the success TTL — one
    // blip must not keep the dashboard broken for the full 30 seconds.
    vi.advanceTimersByTime(2_500);
    mockSearch.mockResolvedValue(searchResult([2]));
    const retry = await GitHubService.searchPullRequests(QUERY);

    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(retry.map((i) => i.coordinates.number)).toEqual([2]);
  });

  it('lets a forced refresh retry immediately after a failure', async () => {
    mockSearch.mockRejectedValueOnce(new Error('boom'));

    await expect(GitHubService.searchPullRequests(QUERY)).rejects.toThrow('boom');

    mockSearch.mockResolvedValue(searchResult([3]));
    const retry = await GitHubService.searchPullRequests(QUERY, undefined, { force: true });

    expect(retry.map((i) => i.coordinates.number)).toEqual([3]);
  });

  it('stops calling GitHub once the connection stops authenticating', async () => {
    mockSearch.mockResolvedValue({
      success: false,
      error: { message: 'Must authenticate to access this API.', status: 401 },
    } as never);

    await expect(GitHubService.searchPullRequests(QUERY)).rejects.toThrow(/authenticate/i);
    // A different query, so the failure cache can't be what's suppressing it.
    await expect(
      GitHubService.searchPullRequests('is:pr is:open author:@me'),
    ).rejects.toThrow(/authenticate/i);

    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('treats an IP-keyed rate limit as an authentication failure', async () => {
    mockSearch.mockResolvedValue({
      success: false,
      error: {
        message: 'API rate limit exceeded for 20.83.220.230.',
        status: 403,
      },
    } as never);

    await expect(GitHubService.searchPullRequests(QUERY)).rejects.toThrow(/rate limit/i);
    await expect(
      GitHubService.searchPullRequests('is:pr is:open author:@me'),
    ).rejects.toThrow(/rate limit/i);

    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('keeps calling GitHub when the signed-in user is merely rate limited', async () => {
    mockSearch.mockResolvedValue({
      success: false,
      error: {
        message: 'API rate limit exceeded for user ID 12345.',
        status: 403,
      },
    } as never);

    await expect(GitHubService.searchPullRequests(QUERY)).rejects.toThrow(/rate limit/i);
    await expect(
      GitHubService.searchPullRequests('is:pr is:open author:@me'),
    ).rejects.toThrow(/rate limit/i);

    // The credential is fine and the reset is usually seconds away, so there is
    // nothing to protect by refusing to ask.
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('propagates the failure to every caller sharing the in-flight request', async () => {
    mockSearch.mockRejectedValueOnce(new Error('rate limited'));

    const results = await Promise.allSettled([
      GitHubService.searchPullRequests(QUERY),
      GitHubService.searchPullRequests(QUERY),
    ]);

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('resetSearchCache forces the next call back to the network', async () => {
    await GitHubService.searchPullRequests(QUERY);
    resetSearchCache();
    await GitHubService.searchPullRequests(QUERY);

    expect(mockSearch).toHaveBeenCalledTimes(2);
  });
});
