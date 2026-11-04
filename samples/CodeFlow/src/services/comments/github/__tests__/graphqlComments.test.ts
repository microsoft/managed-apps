import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../connectors/github', () => ({
  githubClient: { graphql: vi.fn() },
}));

import { githubClient } from '../../../../connectors/github';
import { fetchConversation, pullRequestNodeId, resetPullRequestIdCache } from '../conversation';
import { fetchReviews } from '../reviews';
import {
  addPullRequestComment,
  createReviewThread,
  replyToIssueComment,
  replyToThread,
  submitReviewVote,
} from '../reviewWriter';
import { setThreadResolution } from '../threadResolution';
import { decodeIssueReplyParent } from '../issueReplyMarker';
import type { CreateThreadInput } from '../../CommentStore';
import type { CommentThread } from '../../../../types';

const graphql = vi.mocked(githubClient.graphql);
const coords = { owner: 'octo-org', repo: 'octo-repo', pullNumber: 123 };
const author = { login: 'octocat' };

/** A connector result wrapping a GraphQL response. */
function ok(data: unknown) {
  return { success: true, data: { data } };
}
function gqlErrors(message: string, data: unknown = null) {
  return { success: true, data: { data, errors: [{ message }] } };
}
const sent = (i: number) => String(graphql.mock.calls[i][0]);

function pr(fields: Record<string, unknown>) {
  return ok({ repository: { pullRequest: fields } });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetPullRequestIdCache();
});

describe('fetchConversation', () => {
  it('pages review threads and PR comments independently', async () => {
    graphql
      .mockResolvedValueOnce(
        pr({
          reviewThreads: { nodes: [{ id: 'PRRT_1' }], pageInfo: { hasNextPage: true, endCursor: 'T1' } },
          comments: { nodes: [{ id: 'IC_1' }], pageInfo: { hasNextPage: false, endCursor: 'C1' } },
        }),
      )
      .mockResolvedValueOnce(
        pr({ reviewThreads: { nodes: [{ id: 'PRRT_2' }], pageInfo: { hasNextPage: false, endCursor: null } } }),
      );

    const result = await fetchConversation(coords);

    expect(result.reviewThreads.map((t) => t.id)).toEqual(['PRRT_1', 'PRRT_2']);
    expect(result.issueComments.map((c) => c.id)).toEqual(['IC_1']);
    expect(sent(0)).toContain('repository(owner: "octo-org", name: "octo-repo")');
    expect(sent(0)).toContain('pullRequest(number: 123)');
    expect(sent(0)).toContain('reviewThreads(first: 100)');
    expect(sent(1)).toContain('reviewThreads(first: 100, after: "T1")');
    // The finished connection isn't asked for again.
    expect(sent(1)).not.toMatch(/\bcomments\(first: 100\) \{ pageInfo/);
  });

  it('throws on GraphQL errors so the caller can fall back', async () => {
    graphql.mockResolvedValueOnce(gqlErrors('Resource not accessible by integration'));
    await expect(fetchConversation(coords)).rejects.toThrow(/Resource not accessible/);
  });

  it('throws on a transport failure', async () => {
    graphql.mockResolvedValueOnce({ success: false, error: new Error('offline') } as never);
    await expect(fetchConversation(coords)).rejects.toThrow(/offline/);
  });
});

describe('pullRequestNodeId', () => {
  it('uses a known id without asking GitHub', async () => {
    expect(await pullRequestNodeId(coords, 'PR_known')).toBe('PR_known');
    expect(graphql).not.toHaveBeenCalled();
  });

  it('reads the id once and caches it', async () => {
    graphql.mockResolvedValueOnce(pr({ id: 'PR_kwDO1' }));
    expect(await pullRequestNodeId(coords)).toBe('PR_kwDO1');
    expect(await pullRequestNodeId(coords)).toBe('PR_kwDO1');
    expect(graphql).toHaveBeenCalledTimes(1);
  });
});

describe('fetchReviews', () => {
  it('pages through reviews and keeps the commit each one was made on', async () => {
    graphql
      .mockResolvedValueOnce(
        pr({
          reviews: {
            nodes: [{ state: 'APPROVED', submittedAt: '2024-01-01', author: { login: 'a' }, commit: { oid: 'c1' } }],
            pageInfo: { hasNextPage: true, endCursor: 'R1' },
          },
        }),
      )
      .mockResolvedValueOnce(
        pr({
          reviews: {
            nodes: [{ state: 'COMMENTED', submittedAt: '2024-01-02', author: { login: 'b' }, commit: null }],
            pageInfo: { hasNextPage: false },
          },
        }),
      );

    const reviews = await fetchReviews(coords);

    expect(reviews).toEqual([
      { login: 'a', avatarUrl: undefined, state: 'APPROVED', submittedAt: '2024-01-01', commitId: 'c1' },
      { login: 'b', avatarUrl: undefined, state: 'COMMENTED', submittedAt: '2024-01-02', commitId: undefined },
    ]);
    expect(sent(1)).toContain('reviews(first: 100, after: "R1")');
  });

  it('throws on GraphQL errors', async () => {
    graphql.mockResolvedValueOnce(gqlErrors('boom'));
    await expect(fetchReviews(coords)).rejects.toThrow(/boom/);
  });
});

describe('createReviewThread', () => {
  const input: CreateThreadInput = {
    prKey: 'octo-org/octo-repo#123',
    filename: 'src/a.ts',
    side: 'right',
    line: 12,
    startLine: 10,
    body: 'Consider a guard here.',
    author,
    commitSha: 'abc123',
    lineText: 'const x = 1;',
  } as CreateThreadInput;

  const addedReview = ok({ addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } });
  const addedThread = ok({
    addPullRequestReviewThread: {
      thread: {
        id: 'PRRT_new',
        comments: { nodes: [{ id: 'PRRC_new', databaseId: 99, url: 'https://github.com/x#discussion_r99' }] },
      },
    },
  });
  const submitted = ok({ submitPullRequestReview: { pullRequestReview: { id: 'PRR_1', state: 'COMMENTED' } } });

  it('opens a pending review, adds the thread, and submits it as a comment', async () => {
    graphql
      .mockResolvedValueOnce(pr({ id: 'PR_1' }))
      .mockResolvedValueOnce(addedReview)
      .mockResolvedValueOnce(addedThread)
      .mockResolvedValueOnce(submitted);

    const thread = await createReviewThread(input, coords);

    expect(sent(1)).toContain('addPullRequestReview(input: { pullRequestId: "PR_1", commitOID: "abc123" })');
    expect(sent(2)).toContain('addPullRequestReviewThread(input: { pullRequestReviewId: "PRR_1"');
    expect(sent(2)).toContain('line: 12, side: RIGHT, startLine: 10, startSide: RIGHT');
    expect(sent(2)).toContain('subjectType: LINE');
    expect(sent(3)).toContain('submitPullRequestReview(input: { pullRequestReviewId: "PRR_1", event: COMMENT })');
    expect(thread).toMatchObject({ id: 'PRRT_new', threadNodeId: 'PRRT_new', line: 12, startLine: 10 });
    expect(thread.comments[0]).toMatchObject({ id: '99', nodeId: 'PRRC_new', local: false });
  });

  it('falls back to a file-level thread carrying an anchor when the line is outside the diff', async () => {
    graphql
      .mockResolvedValueOnce(addedReview)
      .mockResolvedValueOnce(gqlErrors('Line could not be resolved: pull_request_review_thread.line must be part of the diff'))
      .mockResolvedValueOnce(addedThread)
      .mockResolvedValueOnce(submitted);

    await createReviewThread(input, coords, 'PR_known');

    expect(sent(2)).toContain('subjectType: FILE');
    expect(sent(2)).not.toContain('line: 12,');
    expect(sent(2)).toContain('codeflow:anchor');
  });

  it('falls back the same way when GitHub answers a line outside the diff with a null thread', async () => {
    graphql
      .mockResolvedValueOnce(addedReview)
      .mockResolvedValueOnce(ok({ addPullRequestReviewThread: { thread: null } }))
      .mockResolvedValueOnce(addedThread)
      .mockResolvedValueOnce(submitted);

    const thread = await createReviewThread(input, coords, 'PR_known');

    expect(sent(2)).toContain('subjectType: FILE');
    expect(sent(2)).toContain('codeflow:anchor');
    expect(sent(3)).toContain('submitPullRequestReview');
    expect(thread).toMatchObject({ id: 'PRRT_new', line: 12 });
  });

  it('discards the pending review when adding the thread fails', async () => {
    graphql
      .mockResolvedValueOnce(addedReview)
      .mockResolvedValueOnce(gqlErrors('Something went wrong'))
      .mockResolvedValueOnce(ok({ deletePullRequestReview: { pullRequestReview: { id: 'PRR_1' } } }));

    await expect(createReviewThread(input, coords, 'PR_known')).rejects.toThrow(/Something went wrong/);
    expect(sent(2)).toContain('deletePullRequestReview(input: { pullRequestReviewId: "PRR_1" })');
  });

  it('clears a leftover pending review of its own and retries once', async () => {
    graphql
      .mockResolvedValueOnce(gqlErrors('User can only have one pending review per pull request'))
      .mockResolvedValueOnce(
        pr({ reviews: { nodes: [{ id: 'PRR_other', viewerDidAuthor: false }, { id: 'PRR_old', viewerDidAuthor: true }] } }),
      )
      .mockResolvedValueOnce(ok({ deletePullRequestReview: { pullRequestReview: { id: 'PRR_old' } } }))
      .mockResolvedValueOnce(addedReview)
      .mockResolvedValueOnce(addedThread)
      .mockResolvedValueOnce(submitted);

    await createReviewThread(input, coords, 'PR_known');

    expect(sent(1)).toContain('reviews(first: 20, states: PENDING)');
    expect(sent(2)).toContain('"PRR_old"');
    expect(graphql).toHaveBeenCalledTimes(6);
  });
});

describe('replies and PR-level comments', () => {
  it('replies to a review thread by its node id', async () => {
    graphql.mockResolvedValueOnce(
      ok({ addPullRequestReviewThreadReply: { comment: { id: 'PRRC_r', databaseId: 5 } } }),
    );
    const refreshed = { id: 'PRRT_1', comments: [] } as unknown as CommentThread;
    const list = vi.fn().mockResolvedValue([refreshed]);

    const thread = await replyToThread('PRRT_1', 'Done "quoted"', author, 'o/r#1', list);

    expect(sent(0)).toContain(
      'addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: "PRRT_1", body: "Done \\"quoted\\"" })',
    );
    expect(thread).toBe(refreshed);
  });

  it('fails a reply GitHub reports an error for', async () => {
    graphql.mockResolvedValueOnce(gqlErrors('Could not resolve to a node'));
    await expect(replyToThread('PRRT_1', 'x', author, 'o/r#1', vi.fn())).rejects.toThrow(/Could not resolve/);
  });

  it('adds a PR-level comment with addComment', async () => {
    graphql.mockResolvedValueOnce(ok({ addComment: { commentEdge: { node: { id: 'IC_1' } } } }));
    await addPullRequestComment(coords, 'LGTM', 'PR_1');
    expect(sent(0)).toContain('addComment(input: { subjectId: "PR_1", body: "LGTM" })');
  });

  it('replies to a Description comment with a marker naming its parent', async () => {
    graphql.mockResolvedValueOnce(pr({ id: 'PR_1' })).mockResolvedValueOnce(ok({ addComment: { commentEdge: { node: { id: 'IC_2' } } } }));
    const parent = {
      id: '100',
      isIssueComment: true,
      comments: [{ id: '100', author: { login: 'hubot' }, body: 'q', createdAt: '' }],
    } as unknown as CommentThread;
    await replyToIssueComment(coords, parent, 'answer', author, 'o/r#1', vi.fn().mockResolvedValue([parent]));

    const body = JSON.parse(/body: ("(?:[^"\\]|\\.)*")/.exec(sent(1))?.[1] ?? '""') as string;
    expect(decodeIssueReplyParent(body)).toBe('100');
  });
});

describe('review votes', () => {
  it.each(['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const)('submits %s with addPullRequestReview', async (event) => {
    graphql.mockResolvedValueOnce(ok({ addPullRequestReview: { pullRequestReview: { id: 'PRR_v', state: event } } }));
    await submitReviewVote(coords, event, { pullRequestId: 'PR_1', commitOid: 'head1', body: 'why' });
    expect(sent(0)).toContain(
      `addPullRequestReview(input: { pullRequestId: "PR_1", event: ${event}, commitOID: "head1", body: "why" })`,
    );
  });

  it('fails when GitHub returns errors', async () => {
    graphql.mockResolvedValueOnce(gqlErrors('Can not approve your own pull request'));
    await expect(submitReviewVote(coords, 'APPROVE', { pullRequestId: 'PR_1' })).rejects.toThrow(/own pull request/);
  });
});

describe('setThreadResolution', () => {
  it('resolves with resolveReviewThread', async () => {
    graphql.mockResolvedValueOnce(ok({ resolveReviewThread: { thread: { id: 'PRRT_1', isResolved: true } } }));
    await setThreadResolution('PRRT_1', true);
    expect(sent(0)).toContain('resolveReviewThread(input: { threadId: "PRRT_1" })');
  });

  it('reactivates with unresolveReviewThread', async () => {
    graphql.mockResolvedValueOnce(ok({ unresolveReviewThread: { thread: { id: 'PRRT_1', isResolved: false } } }));
    await setThreadResolution('PRRT_1', false);
    expect(sent(0)).toContain('unresolveReviewThread(input: { threadId: "PRRT_1" })');
  });

  it('fails when GitHub still reports the old state', async () => {
    graphql.mockResolvedValueOnce(ok({ resolveReviewThread: { thread: { id: 'PRRT_1', isResolved: false } } }));
    await expect(setThreadResolution('PRRT_1', true)).rejects.toThrow(/still reports it as active/);
  });

  it('refuses an id that is not a node id without calling GitHub', async () => {
    await expect(setThreadResolution('12345', true)).rejects.toThrow();
    expect(graphql).not.toHaveBeenCalled();
  });

  it('fails on GraphQL errors', async () => {
    graphql.mockResolvedValueOnce(gqlErrors('Resource not accessible by integration'));
    await expect(setThreadResolution('PRRT_1', true)).rejects.toThrow(/not accessible/);
  });
});
