import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrCoordinates } from '../../types';

// githubService pulls the generated connector + managed-apps auth at module
// load. Only MergePullRequest is exercised here, so stub the rest out.
vi.mock('../../connectors/github', () => ({
  githubClient: {
    mergePullRequest: vi.fn(),
  },
}));
vi.mock('@microsoft/managed-apps/auth', () => ({
  getUser: vi.fn(),
}));

import { githubClient } from '../../connectors/github';
import { GitHubService } from '../githubService';

const mockMerge = vi.mocked(githubClient.mergePullRequest);

const COORDS: PrCoordinates = { owner: 'octo-org', name: 'octo-repo', number: 123 };

function ok<T>(data: T) {
  return { success: true, data } as never;
}
function fail(error: unknown) {
  return { success: false, data: undefined, error } as never;
}

beforeEach(() => {
  mockMerge.mockReset();
});

describe('GitHubService.mergePullRequest', () => {
  it('addresses the right PR and asks for the chosen strategy', async () => {
    mockMerge.mockResolvedValue(ok({ merged: true, sha: 'abc123' }));

    await GitHubService.mergePullRequest(COORDS, { method: 'squash' });

    const [body, owner, name, number] = mockMerge.mock.calls[0];
    expect(body).toMatchObject({ merge_method: 'squash' });
    expect([owner, name, number]).toEqual(['octo-org', 'octo-repo', 123]);
  });

  // The bug this guards: the connector spells the field `mergeMethod`, GitHub
  // reads `merge_method`, and the body is forwarded verbatim — so sending only
  // the connector's spelling let GitHub default to a merge commit and refuse a
  // squash with "Merge commits are not allowed on this repository".
  it.each(['merge', 'squash', 'rebase'] as const)(
    'sends %s under the name GitHub reads',
    async (method) => {
      mockMerge.mockResolvedValue(ok({ merged: true, sha: 'abc123' }));

      await GitHubService.mergePullRequest(COORDS, { method });

      expect(mockMerge.mock.calls[0][0]).toMatchObject({ merge_method: method });
    },
  );

  // Belt and braces: the connector's own spelling stays on the request so it
  // remains valid if the connector ever validates bodies against its schema.
  it('keeps the connector spelling alongside it, in agreement', async () => {
    mockMerge.mockResolvedValue(ok({ merged: true, sha: 'abc123' }));

    await GitHubService.mergePullRequest(COORDS, { method: 'squash' });

    expect(mockMerge.mock.calls[0][0]).toMatchObject({
      merge_method: 'squash',
      mergeMethod: 'squash',
    });
  });

  it('never lets a chosen strategy read as a merge commit', async () => {
    mockMerge.mockResolvedValue(ok({ merged: true, sha: 'abc123' }));

    await GitHubService.mergePullRequest(COORDS, { method: 'squash' });

    const body = mockMerge.mock.calls[0][0] as Record<string, unknown>;
    for (const value of Object.values(body)) {
      expect(value).not.toBe('merge');
    }
  });

  it('pins the merge to the head the author was looking at', async () => {
    mockMerge.mockResolvedValue(ok({ merged: true, sha: 'abc123' }));

    await GitHubService.mergePullRequest(COORDS, { method: 'merge', expectedHeadSha: 'deadbeef' });

    expect(mockMerge.mock.calls[0][0]).toMatchObject({ sha: 'deadbeef' });
  });

  it('omits the sha guard entirely when there is no head to pin to', async () => {
    mockMerge.mockResolvedValue(ok({ merged: true, sha: 'abc123' }));

    await GitHubService.mergePullRequest(COORDS, { method: 'merge' });

    expect(mockMerge.mock.calls[0][0]).not.toHaveProperty('sha');
  });

  it('passes a commit title and message through under both names', async () => {
    mockMerge.mockResolvedValue(ok({ merged: true, sha: 'abc123' }));

    await GitHubService.mergePullRequest(COORDS, {
      method: 'squash',
      commitTitle: 'Ship it (#123)',
      commitMessage: 'Body text',
    });

    expect(mockMerge.mock.calls[0][0]).toMatchObject({
      commit_title: 'Ship it (#123)',
      commit_message: 'Body text',
      commitTitle: 'Ship it (#123)',
      commitMessage: 'Body text',
    });
  });

  it('leaves the commit fields off when there is nothing to say', async () => {
    mockMerge.mockResolvedValue(ok({ merged: true, sha: 'abc123' }));

    await GitHubService.mergePullRequest(COORDS, { method: 'squash' });

    const body = mockMerge.mock.calls[0][0];
    expect(body).not.toHaveProperty('commit_title');
    expect(body).not.toHaveProperty('commit_message');
  });

  it('returns the merge commit on success', async () => {
    mockMerge.mockResolvedValue(ok({ merged: true, sha: 'abc123', message: 'Pull Request successfully merged' }));

    await expect(GitHubService.mergePullRequest(COORDS, { method: 'merge' })).resolves.toEqual({
      merged: true,
      sha: 'abc123',
      message: 'Pull Request successfully merged',
    });
  });

  // The case that motivates the whole guard: GitHub answers 200 and simply
  // says no. Treating that as success would tell the author their PR landed.
  it('treats a successful response that did not merge as a failure', async () => {
    mockMerge.mockResolvedValue(ok({ merged: false, message: 'Head branch was modified. Review and try the merge again.' }));

    await expect(GitHubService.mergePullRequest(COORDS, { method: 'merge' })).rejects.toThrow(
      /Head branch was modified/,
    );
  });

  it('still fails loudly when the refusal came with no explanation', async () => {
    mockMerge.mockResolvedValue(ok({ merged: false }));

    await expect(GitHubService.mergePullRequest(COORDS, { method: 'merge' })).rejects.toThrow(/declined to merge/i);
  });

  it('surfaces a transport failure', async () => {
    mockMerge.mockResolvedValue(fail(new Error('403 Forbidden')));

    await expect(GitHubService.mergePullRequest(COORDS, { method: 'merge' })).rejects.toThrow(
      /Failed to merge pull request/,
    );
  });
});
