import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrCoordinates } from '../../../types';

const graphql = vi.fn();
vi.mock('../../../connectors/github', () => ({
  githubClient: { graphql: (...a: unknown[]) => graphql(...a) },
}));

import { fetchReviewers } from '../useReviewActions';

const COORDS: PrCoordinates = { owner: 'o', name: 'r', number: 1 };

interface RestLikeReview {
  user: { login: string };
  state: string;
  submitted_at: string;
  commit_id?: unknown;
}

/** A GraphQL `reviews` page built from REST-like rows, to keep the cases readable. */
function textResult(rows: RestLikeReview[]) {
  return {
    success: true,
    data: {
      data: {
        repository: {
          pullRequest: {
            reviews: {
              pageInfo: { hasNextPage: false },
              nodes: rows.map((r) => ({
                state: r.state,
                submittedAt: r.submitted_at,
                author: { login: r.user.login },
                commit: typeof r.commit_id === 'string' ? { oid: r.commit_id } : r.commit_id == null ? null : { oid: r.commit_id },
              })),
            },
          },
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchReviewers', () => {
  it('returns the latest vote per user', async () => {
    graphql.mockResolvedValue(
      textResult([
        { user: { login: 'octocat' }, state: 'COMMENTED', submitted_at: '2026-01-01T00:00:00Z' },
        { user: { login: 'octocat' }, state: 'APPROVED', submitted_at: '2026-01-02T00:00:00Z' },
        { user: { login: 'ada' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-01-01T00:00:00Z' },
      ]),
    );

    const reviewers = await fetchReviewers(COORDS);

    expect(reviewers).toHaveLength(2);
    expect(reviewers?.find((r) => r.user.login === 'octocat')?.state).toBe('APPROVED');
    expect(reviewers?.find((r) => r.user.login === 'ada')?.state).toBe('CHANGES_REQUESTED');
  });

  it('returns an empty list when the PR really has no reviews', async () => {
    graphql.mockResolvedValue(textResult([]));

    await expect(fetchReviewers(COORDS)).resolves.toEqual([]);
  });

  it('keeps all distinct approvals even when the latest vote is not an approval', async () => {
    graphql.mockResolvedValue(textResult([
      { user: { login: 'octocat' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-01-05', commit_id: 'head' },
      { user: { login: 'Octocat' }, state: 'APPROVED', submitted_at: '2026-01-01', commit_id: 'first' },
      { user: { login: 'octocat' }, state: 'APPROVED', submitted_at: '2026-01-02', commit_id: 'second' },
      { user: { login: 'octocat' }, state: 'APPROVED', submitted_at: '2026-01-03', commit_id: 'first' },
      { user: { login: 'ada' }, state: 'APPROVED', submitted_at: '2026-01-04', commit_id: 'other' },
    ]));

    const reviewers = await fetchReviewers(COORDS);

    expect(reviewers).toHaveLength(2);
    expect(reviewers?.find((r) => r.user.login === 'octocat')).toMatchObject({
      state: 'CHANGES_REQUESTED',
      commitId: 'head',
      submittedAt: '2026-01-05',
      approvedCommitIds: ['first', 'second'],
    });
    expect(reviewers?.find((r) => r.user.login === 'ada')?.approvedCommitIds).toEqual(['other']);
  });

  it('does not infer approvals from other states or missing commit SHAs', async () => {
    graphql.mockResolvedValue(textResult([
      ...['COMMENTED', 'CHANGES_REQUESTED', 'PENDING', 'DISMISSED'].map((state) => ({
        user: { login: 'octocat' }, state, submitted_at: '2026-01-01', commit_id: state,
      })),
      ...[undefined, '', 123].map((commit_id) => ({
        user: { login: 'octocat' }, state: 'APPROVED', submitted_at: '2026-01-02', commit_id,
      })),
    ]));
    const reviewers = await fetchReviewers(COORDS);
    expect(reviewers?.[0]?.approvedCommitIds).toBeUndefined();
  });

  // Everything below must report "unknown" rather than "no votes", so a failed
  // read can't wipe the vote pills a successful read already put on screen.
  it('returns undefined when GraphQL reports errors', async () => {
    graphql.mockResolvedValue({ success: true, data: { data: null, errors: [{ message: 'boom' }] } });

    await expect(fetchReviewers(COORDS)).resolves.toBeUndefined();
  });

  it('returns undefined when the connector call fails', async () => {
    graphql.mockResolvedValue({ success: false, error: new Error('forbidden') });

    await expect(fetchReviewers(COORDS)).resolves.toBeUndefined();
  });

  it('returns undefined when the pull request is missing from the response', async () => {
    graphql.mockResolvedValue({ success: true, data: { data: { repository: { pullRequest: null } } } });

    await expect(fetchReviewers(COORDS)).resolves.toBeUndefined();
  });

  it('returns undefined when the call throws', async () => {
    graphql.mockRejectedValue(new Error('offline'));

    await expect(fetchReviewers(COORDS)).resolves.toBeUndefined();
  });

  it('asks GitHub for the reviews of the right pull request', async () => {
    graphql.mockResolvedValue(textResult([]));
    await fetchReviewers(COORDS);
    expect(String(graphql.mock.calls[0][0])).toContain('repository(owner: "o", name: "r") { pullRequest(number: 1)');
    expect(String(graphql.mock.calls[0][0])).toContain('reviews(first: 100)');
  });
});
