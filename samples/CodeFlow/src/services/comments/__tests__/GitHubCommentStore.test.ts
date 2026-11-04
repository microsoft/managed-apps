import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../connectors/github', () => ({
  githubClient: { graphql: vi.fn() },
}));

import { githubClient } from '../../../connectors/github';
import { GitHubCommentStore } from '../GitHubCommentStore';
import { loadThreadsWithFallback, setCommentStore } from '../index';
import { resetPullRequestIdCache } from '../github/conversation';

const graphql = vi.mocked(githubClient.graphql);
const PR_KEY = 'octo-org/octo-repo#123';
const sent = (i: number) => String(graphql.mock.calls[i][0]);

function ok(data: unknown) {
  return { success: true, data: { data } };
}

function conversation() {
  return ok({
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              id: 'PRRT_1',
              isResolved: false,
              isOutdated: false,
              path: 'src/a.ts',
              diffSide: 'RIGHT',
              line: 4,
              comments: {
                nodes: [
                  {
                    id: 'PRRC_1',
                    databaseId: 11,
                    body: 'first',
                    url: 'https://github.com/octo-org/octo-repo/pull/123#discussion_r11',
                    createdAt: '2024-01-01T00:00:00Z',
                    author: { login: 'octocat' },
                  },
                ],
              },
            },
          ],
        },
        comments: {
          pageInfo: { hasNextPage: false },
          nodes: [{ id: 'IC_1', databaseId: 21, body: 'top level', createdAt: '2024-01-02T00:00:00Z', author: { login: 'hubot' } }],
        },
      },
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetPullRequestIdCache();
  setCommentStore(null);
});

describe('GitHubCommentStore', () => {
  it('lists review threads and PR-level comments from one GraphQL read', async () => {
    graphql.mockResolvedValueOnce(conversation());
    const threads = await new GitHubCommentStore().listThreads(PR_KEY);

    expect(threads).toHaveLength(2);
    expect(threads[0]).toMatchObject({ id: 'PRRT_1', threadNodeId: 'PRRT_1', filename: 'src/a.ts', line: 4 });
    expect(threads[0].comments[0]).toMatchObject({ id: '11', nodeId: 'PRRC_1', author: { login: 'octocat' } });
    expect(threads[1]).toMatchObject({ id: '21', isIssueComment: true });
  });

  it('edits a review comment with updatePullRequestReviewComment', async () => {
    graphql.mockResolvedValueOnce(conversation()).mockResolvedValueOnce(
      ok({ updatePullRequestReviewComment: { pullRequestReviewComment: { body: 'changed' } } }),
    );
    const store = new GitHubCommentStore();
    const updated = await store.editComment(PR_KEY, 'PRRT_1', '11', 'changed');

    expect(sent(1)).toContain('updatePullRequestReviewComment');
    expect(sent(1)).toContain('"PRRC_1"');
    expect(updated.comments[0].body).toBe('changed');
  });

  it('deletes an issue comment with deleteIssueComment and hides it from the next read', async () => {
    graphql
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(ok({ deleteIssueComment: { clientMutationId: 'IC_1' } }))
      .mockResolvedValueOnce(conversation());
    const store = new GitHubCommentStore();
    await store.deleteComment(PR_KEY, '21', '21');

    expect(sent(1)).toContain('deleteIssueComment(input: { id: "IC_1"');
    const after = await store.listThreads(PR_KEY);
    expect(after.map((t) => t.id)).toEqual(['PRRT_1']);
  });

  it('resolves a thread with resolveReviewThread', async () => {
    graphql
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(ok({ resolveReviewThread: { thread: { id: 'PRRT_1', isResolved: true } } }));
    const thread = await new GitHubCommentStore().setStatus(PR_KEY, 'PRRT_1', 'resolved');

    expect(sent(1)).toContain('resolveReviewThread(input: { threadId: "PRRT_1" })');
    expect(thread.status).toBe('resolved');
  });

  it('replies to a review thread with addPullRequestReviewThreadReply', async () => {
    graphql
      .mockResolvedValueOnce(ok({ addPullRequestReviewThreadReply: { comment: { id: 'PRRC_2', databaseId: 12 } } }))
      .mockResolvedValueOnce(conversation());
    await new GitHubCommentStore().addComment(PR_KEY, 'PRRT_1', 'reply', { login: 'octocat' });
    expect(sent(0)).toContain('pullRequestReviewThreadId: "PRRT_1"');
  });
});

describe('loadThreadsWithFallback', () => {
  it('uses GitHub when GraphQL answers', async () => {
    graphql.mockResolvedValueOnce(conversation());
    const { store, threads } = await loadThreadsWithFallback(PR_KEY);
    expect(store.label).toBe('GitHub (synced)');
    expect(threads).toHaveLength(2);
  });

  it('falls back to comments kept in this browser when GraphQL fails', async () => {
    graphql.mockResolvedValueOnce({ success: true, data: { data: null, errors: [{ message: 'Forbidden' }] } });
    const { store, threads } = await loadThreadsWithFallback(PR_KEY);
    expect(store.label).toBe('Local (this device)');
    expect(threads).toEqual([]);
  });
});
