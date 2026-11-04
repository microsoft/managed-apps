import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileChange, PrCoordinates } from '../../types';

vi.mock('../../connectors/github', () => ({
  githubClient: { graphql: vi.fn() },
}));
vi.mock('@microsoft/managed-apps/auth', () => ({
  getUser: vi.fn(),
}));

import { githubClient } from '../../connectors/github';
import { GitHubService, mergePullRequestFiles } from '../githubService';

const graphql = vi.mocked(githubClient.graphql);
const COORDS: PrCoordinates = { owner: 'octo', name: 'repo', number: 7 };

function page(nodes: unknown[], endCursor?: string) {
  return {
    success: true,
    data: {
      data: {
        repository: {
          pullRequest: {
            files: { nodes, pageInfo: { hasNextPage: Boolean(endCursor), endCursor: endCursor ?? null } },
          },
        },
      },
    },
  };
}

function nodes(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({
    path: `${prefix}${i}.ts`,
    additions: i,
    deletions: 1,
    changeType: 'MODIFIED',
  }));
}

beforeEach(() => vi.resetAllMocks());

describe('GitHubService.listPullRequestFiles', () => {
  it('maps GraphQL file nodes to FileChange', async () => {
    graphql.mockResolvedValueOnce(
      page([
        { path: 'a.ts', additions: 3, deletions: 1, changeType: 'ADDED' },
        { path: 'b.ts', additions: 0, deletions: 4, changeType: 'DELETED' },
        { path: 'c.ts', additions: 1, deletions: 1, changeType: 'RENAMED' },
      ]),
    );
    const files = await GitHubService.listPullRequestFiles(COORDS);
    expect(files).toEqual([
      { filename: 'a.ts', status: 'added', additions: 3, deletions: 1, changes: 4 },
      { filename: 'b.ts', status: 'removed', additions: 0, deletions: 4, changes: 4 },
      { filename: 'c.ts', status: 'renamed', additions: 1, deletions: 1, changes: 2 },
    ]);
    expect(graphql.mock.calls[0][0]).toContain('pullRequest(number: 7)');
    expect(graphql.mock.calls[0][0]).toContain('files(first: 100)');
  });

  it('follows the cursor across pages', async () => {
    graphql
      .mockResolvedValueOnce(page(nodes(100, 'p1-'), 'CUR1'))
      .mockResolvedValueOnce(page(nodes(20, 'p2-')));
    const files = await GitHubService.listPullRequestFiles(COORDS);
    expect(files).toHaveLength(120);
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql.mock.calls[1][0]).toContain('after: "CUR1"');
  });

  it('returns undefined when the first page fails', async () => {
    graphql.mockResolvedValueOnce({ success: true, data: { errors: [{ message: 'Not found' }] } });
    expect(await GitHubService.listPullRequestFiles(COORDS)).toBeUndefined();
  });

  it('keeps what it has when a later page fails', async () => {
    graphql.mockResolvedValueOnce(page(nodes(100, 'p1-'), 'CUR1')).mockRejectedValueOnce(new Error('boom'));
    expect(await GitHubService.listPullRequestFiles(COORDS)).toHaveLength(100);
  });
});

describe('mergePullRequestFiles', () => {
  const f = (filename: string, patch?: string): FileChange => ({
    filename, status: 'modified', additions: 1, deletions: 0, changes: 1, ...(patch ? { patch } : {}),
  });

  it('keeps compare files (with patches) and appends files compare left out', () => {
    const merged = mergePullRequestFiles([f('a.ts', '@@')], [f('a.ts'), f('b.ts')]);
    expect(merged.map((x) => x.filename)).toEqual(['a.ts', 'b.ts']);
    expect(merged[0].patch).toBe('@@');
  });

  it('returns compare files unchanged when the PR list is unavailable', () => {
    const files = [f('a.ts')];
    expect(mergePullRequestFiles(files, undefined)).toBe(files);
  });
});
