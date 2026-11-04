import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RepoRef } from '../../types';

// githubService pulls the generated connector + managed-apps auth at module
// load. Only ListCollaborators/checkCollaborator are exercised here, so stub
// the rest of the surface out to keep the test isolated to the mention path.
vi.mock('../../connectors/github', () => ({
  githubClient: {
    listCollaborators: vi.fn(),
    checkCollaborator: vi.fn(),
  },
}));
vi.mock('@microsoft/managed-apps/auth', () => ({
  getUser: vi.fn(),
}));

import { githubClient } from '../../connectors/github';
import { GitHubService } from '../githubService';

const mockList = vi.mocked(githubClient.listCollaborators);
const mockCheck = vi.mocked(githubClient.checkCollaborator);

const REPO: RepoRef = { owner: 'octo-org', name: 'octo-repo' };

/** An IOperationResult success wrapper. */
function ok<T>(data: T) {
  return { success: true, data } as never;
}
/** An IOperationResult failure wrapper. */
function fail() {
  return { success: false, data: undefined, error: new Error('boom') } as never;
}

/** A full page of `n` collaborator records. */
function pageOf(n: number, prefix: string) {
  return Array.from({ length: n }, (_, i) => ({
    login: `${prefix}${i}`,
    name: `Name ${prefix}${i}`,
    avatar_url: `https://github.example/avatars/${prefix}${i}`,
    html_url: `https://github.example/${prefix}${i}`,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GitHubService.listCollaborators', () => {
  it('walks pages until a short page and returns the full set', async () => {
    mockList.mockImplementation(((_o: string, _n: string, _pp?: number, page?: number) => {
      if (page === 1) return Promise.resolve(ok(pageOf(100, 'a')));
      if (page === 2) return Promise.resolve(ok(pageOf(100, 'b')));
      if (page === 3) return Promise.resolve(ok(pageOf(15, 'c')));
      return Promise.resolve(ok([]));
    }) as never);

    const users = await GitHubService.listCollaborators(REPO);

    expect(users).toHaveLength(215);
    // Stopped after the short third page — no fourth request.
    expect(mockList).toHaveBeenCalledTimes(3);
    expect(mockList).toHaveBeenNthCalledWith(1, 'octo-org', 'octo-repo', 100, 1);
    expect(mockList).toHaveBeenNthCalledWith(3, 'octo-org', 'octo-repo', 100, 3);
    // A collaborator on a later page (the whole point of paginating) is present.
    expect(users.some((u) => u.login === 'b42')).toBe(true);
  });

  it('stops at the maxPages safety cap when every page is full', async () => {
    mockList.mockImplementation(((_o: string, _n: string, _pp?: number, page?: number) =>
      Promise.resolve(ok(pageOf(100, `p${page}_`)))) as never);

    const users = await GitHubService.listCollaborators(REPO, 3);

    expect(users).toHaveLength(300);
    expect(mockList).toHaveBeenCalledTimes(3);
  });

  it('normalizes fields and drops records without a login', async () => {
    mockList.mockResolvedValueOnce(
      ok([
        { login: 'octocat', name: 'The Octocat', avatar_url: 'a', html_url: 'h' },
        { name: 'No Login' },
        null,
        'nope',
        { login: 'plain' },
      ]) as never,
    );

    const users = await GitHubService.listCollaborators(REPO);

    expect(users).toEqual([
      { login: 'octocat', name: 'The Octocat', avatarUrl: 'a', htmlUrl: 'h' },
      { login: 'plain', name: undefined, avatarUrl: undefined, htmlUrl: undefined },
    ]);
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when the first page fails', async () => {
    mockList.mockResolvedValueOnce(fail());

    const users = await GitHubService.listCollaborators(REPO);

    expect(users).toEqual([]);
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('returns collaborators collected so far when a later page throws', async () => {
    mockList.mockImplementation(((_o: string, _n: string, _pp?: number, page?: number) => {
      if (page === 1) return Promise.resolve(ok(pageOf(100, 'a')));
      return Promise.reject(new Error('network'));
    }) as never);

    const users = await GitHubService.listCollaborators(REPO);

    expect(users).toHaveLength(100);
  });
});

describe('GitHubService.isCollaborator', () => {
  it('resolves true when the check succeeds (204)', async () => {
    mockCheck.mockResolvedValueOnce({ success: true, data: undefined } as never);

    await expect(GitHubService.isCollaborator(REPO, 'octocat')).resolves.toBe(true);
    expect(mockCheck).toHaveBeenCalledWith('octo-org', 'octo-repo', 'octocat');
  });

  it('resolves false when the check fails (404 non-collaborator)', async () => {
    mockCheck.mockResolvedValueOnce({ success: false, data: undefined } as never);

    await expect(GitHubService.isCollaborator(REPO, 'stranger')).resolves.toBe(false);
  });

  it('resolves false when the connector throws', async () => {
    mockCheck.mockRejectedValueOnce(new Error('boom'));

    await expect(GitHubService.isCollaborator(REPO, 'octocat')).resolves.toBe(false);
  });

  it('short-circuits an empty login without calling the connector', async () => {
    await expect(GitHubService.isCollaborator(REPO, '   ')).resolves.toBe(false);
    expect(mockCheck).not.toHaveBeenCalled();
  });
});
