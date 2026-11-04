import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RepoRef } from '../../types';

// Only the branch/ref/PR-creation operations are exercised here, so the rest
// of the generated connector is stubbed out.
vi.mock('../../connectors/github', () => ({
  githubClient: {
    graphql: vi.fn(),
    createReference: vi.fn(),
    createPullRequest: vi.fn(),
  },
}));
vi.mock('@microsoft/managed-apps/auth', () => ({ getUser: vi.fn() }));

import { githubClient } from '../../connectors/github';
import { GitHubService } from '../githubService';

const graphql = vi.mocked(githubClient.graphql);
const createRef = vi.mocked(githubClient.createReference);
const createPr = vi.mocked(githubClient.createPullRequest);

const REPO: RepoRef = { owner: 'octo', name: 'repo' };

function ok<T>(data: T) {
  return { success: true, data } as never;
}
/** A GraphQL `refs` page, wrapped the way the connector returns it. */
function refsPage(names: string[], endCursor?: string) {
  return ok({
    data: {
      repository: {
        refs: {
          nodes: names.map((name) => ({ name })),
          pageInfo: { hasNextPage: Boolean(endCursor), endCursor: endCursor ?? null },
        },
      },
    },
  });
}
function fail(error: unknown) {
  return { success: false, data: undefined, error } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GitHubService.listBranches', () => {
  it('returns the branch names', async () => {
    graphql.mockResolvedValue(refsPage(['main', 'release/1.0']));
    await expect(GitHubService.listBranches(REPO)).resolves.toEqual(['main', 'release/1.0']);
    expect(graphql.mock.calls[0][0]).toContain('refs(refPrefix: "refs/heads/", first: 100)');
  });

  it('follows the cursor until the last page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => `b${i}`);
    graphql.mockResolvedValueOnce(refsPage(full, 'CURSOR1')).mockResolvedValueOnce(refsPage(['last']));

    const names = await GitHubService.listBranches(REPO);

    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql.mock.calls[1][0]).toContain('after: "CURSOR1"');
    expect(names).toHaveLength(101);
  });

  it('escapes owner and repo names safely', async () => {
    graphql.mockResolvedValue(refsPage([]));
    await GitHubService.listBranches({ owner: 'o"x', name: 'r' });
    expect(graphql.mock.calls[0][0]).toContain('owner: "o\\"x"');
  });

  // A short list is a nuisance; a thrown error would take the whole panel down.
  it('returns what it has when the connector gives up', async () => {
    graphql.mockResolvedValue(fail(new Error('500')));
    await expect(GitHubService.listBranches(REPO)).resolves.toEqual([]);
  });
});

describe('GitHubService.getBranchHead', () => {
  function head(oid: unknown) {
    return ok({ data: { repository: { ref: oid === undefined ? null : { target: { oid } } } } });
  }

  it('reads the branch under its refs/heads name through GraphQL', async () => {
    graphql.mockResolvedValue(head('abc'));

    await expect(GitHubService.getBranchHead(REPO, 'release/1.0')).resolves.toBe('abc');
    expect(graphql.mock.calls[0][0]).toContain('ref(qualifiedName: "refs/heads/release/1.0")');
  });

  it('fails by name when the branch is unknown', async () => {
    graphql.mockResolvedValue(head(undefined));
    await expect(GitHubService.getBranchHead(REPO, 'nope')).rejects.toThrow(/nope/);
  });

  it('fails by name when the connector call fails', async () => {
    graphql.mockResolvedValue(fail(new Error('500')));
    await expect(GitHubService.getBranchHead(REPO, 'broken')).rejects.toThrow(/broken/);
  });
});

describe('GitHubService.createBranch', () => {
  it('creates a fully-qualified ref at the given commit', async () => {
    createRef.mockResolvedValue(ok(undefined));

    await GitHubService.createBranch(REPO, 'cherry-pick/pr-42', 'abc');

    expect(createRef.mock.calls[0][0]).toEqual({ ref: 'refs/heads/cherry-pick/pr-42', sha: 'abc' });
  });

  it('surfaces the refusal — a name already taken is the common one', async () => {
    createRef.mockResolvedValue(fail(new Error('Reference already exists')));
    await expect(GitHubService.createBranch(REPO, 'taken', 'abc')).rejects.toThrow(/taken/);
  });
});

describe('GitHubService.createPullRequest', () => {
  it('sends the branches in the direction GitHub expects', async () => {
    createPr.mockResolvedValue(ok(undefined));

    await GitHubService.createPullRequest(REPO, {
      title: 'Cherry-pick: Fix it',
      head: 'cherry-pick/pr-42',
      base: 'release/1.0',
      body: 'Cherry-pick of #42.',
    });

    expect(createPr.mock.calls[0][0]).toMatchObject({
      head: 'cherry-pick/pr-42',
      base: 'release/1.0',
    });
  });

  it('surfaces a refusal rather than reporting a pull request that never opened', async () => {
    createPr.mockResolvedValue(fail(new Error('No commits between branches')));
    await expect(
      GitHubService.createPullRequest(REPO, { title: 't', head: 'h', base: 'b' }),
    ).rejects.toThrow(/Failed to open the pull request/);
  });
});
