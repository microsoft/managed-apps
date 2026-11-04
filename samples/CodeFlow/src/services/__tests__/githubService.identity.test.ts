import { describe, it, expect, vi, beforeEach } from 'vitest';

// githubService pulls the generated connector + managed-apps auth at module
// load. Only the identity path is exercised here.
vi.mock('../../connectors/github', () => ({
  githubClient: {
    getUser: vi.fn(),
  },
}));
vi.mock('@microsoft/managed-apps/auth', () => ({
  getUser: vi.fn(),
}));

import { githubClient } from '../../connectors/github';
import { getUser } from '@microsoft/managed-apps/auth';
import { GitHubService, resetAuthenticatedUserCache } from '../githubService';

/** Synthetic tenant used by the host-identity mocks. */
const TENANT = 'contoso-tenant';

const mockGetUser = vi.mocked(githubClient.getUser);
const mockHostUser = vi.mocked(getUser);

function ok<T>(data: T) {
  return { success: true, data } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The connector's GetUser response is cached for the app session, so each
  // test needs a clean slate.
  resetAuthenticatedUserCache();
  // Default: the host cannot identify anyone, which is what a real deployment
  // was observed to do.
  mockHostUser.mockResolvedValue({ fullName: 'Ada Lovelace', objectId: '', tenantId: TENANT });
});

describe('authenticated user caching', () => {
  it('issues a single GetUser request no matter how many callers ask', async () => {
    mockGetUser.mockResolvedValue(ok({ id: 4271, login: 'ada' }));

    const [id, user, again] = await Promise.all([
      GitHubService.getCurrentUserId(),
      GitHubService.getAuthenticatedUser(),
      GitHubService.getAuthenticatedUser(),
    ]);

    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(id).toBe('gh:4271');
    expect(user?.login).toBe('ada');
    expect(again?.login).toBe('ada');
  });

  it('does not cache across an explicit reset', async () => {
    mockGetUser.mockResolvedValue(ok({ id: 1, login: 'ada' }));
    await GitHubService.getAuthenticatedUser();
    resetAuthenticatedUserCache();
    await GitHubService.getAuthenticatedUser();
    expect(mockGetUser).toHaveBeenCalledTimes(2);
  });

  it('survives a rejected GetUser without leaving a poisoned promise', async () => {
    mockGetUser.mockRejectedValue(new Error('rate limited'));
    await expect(GitHubService.getAuthenticatedUser()).resolves.toBeUndefined();
    await expect(GitHubService.getAuthenticatedUser()).resolves.toBeUndefined();
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });
});

describe('getCurrentUserId', () => {
  it("prefers GitHub's immutable numeric id", async () => {
    mockGetUser.mockResolvedValue(ok({ id: 4271, login: 'ada' }));
    await expect(GitHubService.getCurrentUserId()).resolves.toBe('gh:4271');
  });

  it('falls back to the login when the connector omits a numeric id', async () => {
    mockGetUser.mockResolvedValue(ok({ login: 'ada' }));
    await expect(GitHubService.getCurrentUserId()).resolves.toBe('gh:ada');
  });

  it('falls back to the host identity when the connector fails', async () => {
    mockGetUser.mockRejectedValue(new Error('no connection'));
    mockHostUser.mockResolvedValue({ fullName: 'Ada', objectId: 'aad-1', tenantId: TENANT });
    await expect(GitHubService.getCurrentUserId()).resolves.toBe('host:aad-1');
  });

  it('falls back to the host identity when the connector returns nothing usable', async () => {
    mockGetUser.mockResolvedValue(ok({}));
    mockHostUser.mockResolvedValue({ fullName: 'Ada', objectId: 'aad-1', tenantId: TENANT });
    await expect(GitHubService.getCurrentUserId()).resolves.toBe('host:aad-1');
  });

  it('gives up when neither source can identify the user', async () => {
    mockGetUser.mockResolvedValue(ok({}));
    await expect(GitHubService.getCurrentUserId()).resolves.toBeUndefined();
  });

  it('gives up when both sources throw', async () => {
    mockGetUser.mockRejectedValue(new Error('no connection'));
    mockHostUser.mockRejectedValue(new Error('no host'));
    await expect(GitHubService.getCurrentUserId()).resolves.toBeUndefined();
  });

  it('keeps the two id spaces from colliding', async () => {
    mockGetUser.mockResolvedValue(ok({ id: 1 }));
    const gh = await GitHubService.getCurrentUserId();

    // A different identity source means a different session, so clear the
    // per-session GetUser cache before resolving again.
    resetAuthenticatedUserCache();
    mockGetUser.mockResolvedValue(ok({}));
    mockHostUser.mockResolvedValue({ fullName: 'Ada', objectId: '1', tenantId: TENANT });
    const aad = await GitHubService.getCurrentUserId();

    expect(gh).not.toBe(aad);
  });
});
