import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { CodeFlowState } from '../../codeFlowContext';
import type { AuthorApproval } from '../../../types';
import { recordAuthorApproval } from '../../../services/authorApproval';
import { addInProgressReview, getInProgressReviews, getLastReviewed } from '../../../utils/storage';
import { countNewIterations } from '../../../utils/lastReviewed';

vi.mock('../../../services/authorApproval', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../services/authorApproval')>(),
  recordAuthorApproval: vi.fn(),
}));

const graphql = vi.fn();
vi.mock('../../../connectors/github', () => ({
  githubClient: { graphql: (...args: unknown[]) => graphql(...args) },
}));

import { fetchReviewers, useReviewActions } from '../useReviewActions';

const COORDS = { owner: 'octo-org', name: 'octo-repo', number: 123 };
const PR_KEY = `${COORDS.owner}/${COORDS.name}#${COORDS.number}`;

interface ReviewRow {
  user: { login: string };
  state: string;
  submitted_at: string;
  commit_id?: string;
}

/** One GraphQL `reviews` page; a full page (100) says there is another. */
function page(rows: ReviewRow[]) {
  return {
    success: true,
    data: {
      data: {
        repository: {
          pullRequest: {
            reviews: {
              pageInfo: { hasNextPage: rows.length >= 100, endCursor: rows.length >= 100 ? 'NEXT' : null },
              nodes: rows.map((r) => ({
                state: r.state,
                submittedAt: r.submitted_at,
                author: { login: r.user.login },
                commit: r.commit_id ? { oid: r.commit_id } : null,
              })),
            },
          },
        },
      },
    },
  };
}

/** GitHub accepted the review. */
const VOTED = { success: true, data: { data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_1', state: 'APPROVED' } } } } };

function refused(message: string) {
  return { success: true, data: { data: null, errors: [{ message }] } };
}

const sent = (i: number) => String(graphql.mock.calls[i][0]);

function review(login: string, state: string, submittedAt: string) {
  return { user: { login }, state, submitted_at: submittedAt, commit_id: 'abc' };
}

/** 100 filler reviews so the first page comes back full and paging must continue. */
function fullPage(login = 'noisy') {
  return Array.from({ length: 100 }, (_, i) =>
    review(login, 'COMMENTED', `2025-08-21T10:${String(i % 60).padStart(2, '0')}:00Z`),
  );
}

describe('fetchReviewers', () => {
  beforeEach(() => graphql.mockReset());

  it('asks for the maximum page size instead of letting GitHub default to 30', async () => {
    graphql.mockResolvedValue(page([]));
    await fetchReviewers(COORDS);
    expect(sent(0)).toContain('reviews(first: 100)');
  });

  describe('useReviewActions approval history', () => {
    beforeEach(() => {
      graphql.mockReset();
      vi.mocked(recordAuthorApproval).mockReset();
    });

    function renderActions(authorLogin?: string) {
      return renderHook(() => {
        const [state, setState] = useState<CodeFlowState>({
          status: 'ready',
          pr: {
            coordinates: COORDS,
            title: 'PR',
            state: 'open',
            draft: false,
            merged: false,
            baseRef: 'main',
            baseSha: 'base',
            headRef: 'feature',
            headSha: 'head',
            nodeId: 'PR_1',
            author: authorLogin ? { login: authorLogin } : undefined,
          },
          currentUser: { login: 'octocat' },
          iterations: [
            { index: 0, sha: 'base', shortSha: 'base', label: 'Base', isBase: true },
            { index: 1, sha: 'first', shortSha: 'first', label: 'First', isBase: false },
            { index: 2, sha: 'head', shortSha: 'head', label: 'Head', isBase: false },
          ],
          fromIndex: 0,
          toIndex: 1,
          comparisonLoading: false,
          seen: {},
          threads: [],
          threadsLoading: false,
          closed: {},
          closedBy: {},
          viewMode: 'inline',
          reviewers: [{ user: { login: 'octocat' }, state: 'APPROVED', approvedCommitIds: ['first'] }],
        });
        const actions = useReviewActions(
          PR_KEY, state, setState, async () => {},
        );
        return { state, setState, ...actions };
      });
    }

    it('refreshes approvals from GitHub after submitting a review', async () => {
      graphql.mockResolvedValueOnce(VOTED).mockResolvedValueOnce(page([
        { ...review('octocat', 'APPROVED', '2026-01-01'), commit_id: 'first' },
        { ...review('octocat', 'APPROVED', '2026-01-02'), commit_id: 'head' },
      ]));
      const { result } = renderActions();
      await act(async () => { await result.current.submitReview('APPROVE'); });
      await waitFor(() => {
        expect(result.current.state.reviewers[0]?.approvedCommitIds).toEqual(['first', 'head']);
      });
      expect(recordAuthorApproval).not.toHaveBeenCalled();
      expect(sent(0)).toContain('addPullRequestReview(input: { pullRequestId: "PR_1", event: APPROVE, commitOID: "head" })');
      expect(result.current.state.lastReviewed).toMatchObject({ sha: 'head', index: 2 });
      expect(getLastReviewed(PR_KEY)).toEqual(result.current.state.lastReviewed);
      expect(result.current.state.toIndex).toBe(1);
      const afterPush = [
        ...result.current.state.iterations,
        { index: 3, sha: 'next', shortSha: 'next', label: 'Next', isBase: false },
      ];
      expect(countNewIterations(afterPush, getLastReviewed(PR_KEY))?.count).toBe(1);
    });

    it('keeps known approvals when the post-submit read fails', async () => {
      graphql.mockResolvedValueOnce(VOTED).mockResolvedValueOnce(refused('boom'));
      const { result } = renderActions();
      await act(async () => { await result.current.submitReview('APPROVE'); });
      await waitFor(() => { expect(graphql).toHaveBeenCalledTimes(2); });
      expect(result.current.state.reviewers[0]?.approvedCommitIds).toEqual(['first']);
      expect(result.current.state.lastReviewed).toMatchObject({ sha: 'head', index: 2 });
    });

    it('does not invent an approval when GitHub refuses the review', async () => {
      graphql.mockResolvedValueOnce(refused('Not allowed'));
      const { result } = renderActions();
      await act(async () => {
        await expect(result.current.submitReview('APPROVE')).rejects.toThrow('Not allowed');
      });
      expect(result.current.state.reviewers[0]?.approvedCommitIds).toEqual(['first']);
      expect(graphql).toHaveBeenCalledTimes(1);
      expect(result.current.state.lastReviewed).toBeUndefined();
      expect(getLastReviewed(PR_KEY)).toBeUndefined();
    });

    it('does not mark a review complete without a response from GitHub', async () => {
      graphql.mockResolvedValueOnce(undefined);
      addInProgressReview({ ...COORDS, title: 'PR' });
      const { result } = renderActions();
      await act(async () => {
        await expect(result.current.submitReview('APPROVE')).rejects.toThrow('Review failed');
      });
      expect(result.current.state.lastReviewed).toBeUndefined();
      expect(getLastReviewed(PR_KEY)).toBeUndefined();
      expect(getInProgressReviews()).toHaveLength(1);
      expect(graphql).toHaveBeenCalledTimes(1);
    });

    it('records only the submitted head if another push arrives while the review is saving', async () => {
      let save!: (value: unknown) => void;
      graphql.mockReturnValueOnce(new Promise((resolve) => { save = resolve; }))
        .mockResolvedValueOnce(page([]));
      const { result } = renderActions();
      let pending!: Promise<void>;
      act(() => { pending = result.current.submitReview('APPROVE'); });
      await waitFor(() => { expect(graphql).toHaveBeenCalledTimes(1); });
      act(() => result.current.setState((prev) => ({
        ...prev,
        pr: prev.pr && { ...prev.pr, headSha: 'next' },
        iterations: [
          ...prev.iterations,
          { index: 3, sha: 'next', shortSha: 'next', label: 'Next', isBase: false },
        ],
        toIndex: 3,
      })));
      await act(async () => { save(VOTED); await pending; });
      expect(result.current.state.lastReviewed).toMatchObject({ sha: 'head', index: 2 });
      expect(countNewIterations(result.current.state.iterations, getLastReviewed(PR_KEY))?.count).toBe(1);
    });

    it('does not mark another PR reviewed when navigation happens during submission', async () => {
      let save!: (value: unknown) => void;
      graphql.mockReturnValueOnce(new Promise((resolve) => { save = resolve; }))
        .mockResolvedValueOnce(page([]));
      const { result } = renderActions();
      let pending!: Promise<void>;
      act(() => { pending = result.current.submitReview('APPROVE'); });
      await waitFor(() => { expect(graphql).toHaveBeenCalledTimes(1); });
      act(() => result.current.setState((prev) => ({
        ...prev,
        pr: prev.pr && { ...prev.pr, coordinates: { ...COORDS, number: 2 } },
      })));
      await act(async () => { save(VOTED); await pending; });
      expect(result.current.state.lastReviewed).toBeUndefined();
      expect(getLastReviewed(PR_KEY)).toBeUndefined();
    });

    it('ignores a post-submit approval response after navigating to another PR', async () => {
      let resolveReviews!: (value: unknown) => void;
      graphql.mockResolvedValueOnce(VOTED).mockReturnValueOnce(
        new Promise((resolve) => { resolveReviews = resolve; }),
      );
      const { result } = renderActions();
      await act(async () => { await result.current.submitReview('APPROVE'); });
      await waitFor(() => { expect(graphql).toHaveBeenCalledTimes(2); });
      act(() => {
        result.current.setState((prev) => ({
          ...prev,
          pr: prev.pr ? { ...prev.pr, coordinates: { ...COORDS, number: 2 } } : undefined,
          reviewers: [],
        }));
      });
      await act(async () => {
        resolveReviews(page([review('octocat', 'APPROVED', '2026-01-02')]));
      });
      expect(result.current.state.reviewers).toEqual([]);
    });

    const approval: AuthorApproval = {
      user: { login: 'octocat' }, state: 'APPROVED', source: 'codeflow',
      commitId: 'head', submittedAt: '2026-10-02T12:00:00Z', approvedCommitIds: ['head'],
    };

    it('records author approval without any GitHub review submission and clears in-progress only after saving', async () => {
      let save!: (value: AuthorApproval) => void;
      vi.mocked(recordAuthorApproval).mockReturnValue(new Promise((resolve) => { save = resolve; }));
      addInProgressReview({ ...COORDS, title: 'PR' });
      const { result } = renderActions('Octocat');
      let pending!: Promise<void>;
      act(() => { pending = result.current.submitReview('APPROVE'); });
      expect(result.current.state.authorApproval).toBeUndefined();
      expect(result.current.state.lastReviewed).toBeUndefined();
      expect(getInProgressReviews()).toHaveLength(1);
      await act(async () => { save(approval); await pending; });
      expect(result.current.state.authorApproval).toEqual(approval);
      expect(result.current.state.reviewers[0]?.approvedCommitIds).toEqual(['first']);
      expect(getInProgressReviews()).toHaveLength(0);
      expect(graphql).not.toHaveBeenCalled();
      expect(result.current.state.lastReviewed).toMatchObject({ sha: 'head', index: 2 });
      expect(getLastReviewed(PR_KEY)).toEqual(result.current.state.lastReviewed);
      expect(result.current.state.toIndex).toBe(1);
    });

    it('keeps progress and approval unchanged when the database write fails', async () => {
      vi.mocked(recordAuthorApproval).mockRejectedValue(new Error('Storage unavailable'));
      addInProgressReview({ ...COORDS, title: 'PR' });
      const { result } = renderActions('octocat');
      await act(async () => {
        await expect(result.current.submitReview('APPROVE')).rejects.toThrow('Storage unavailable');
      });
      expect(result.current.state.authorApproval).toBeUndefined();
      expect(result.current.state.lastReviewed).toBeUndefined();
      expect(getLastReviewed(PR_KEY)).toBeUndefined();
      expect(getInProgressReviews()).toHaveLength(1);
      expect(graphql).not.toHaveBeenCalled();
    });

    it('does not put a saved author approval onto another PR after navigation', async () => {
      let save!: (value: AuthorApproval) => void;
      vi.mocked(recordAuthorApproval).mockReturnValue(new Promise((resolve) => { save = resolve; }));
      const { result } = renderActions('octocat');
      let pending!: Promise<void>;
      act(() => { pending = result.current.submitReview('APPROVE'); });
      act(() => result.current.setState((prev) => ({
        ...prev, pr: prev.pr && { ...prev.pr, coordinates: { ...COORDS, number: 2 } },
      })));
      await act(async () => { save(approval); await pending; });
      expect(result.current.state.authorApproval).toBeUndefined();
      expect(result.current.state.lastReviewed).toBeUndefined();
      expect(getLastReviewed(PR_KEY)).toBeUndefined();
    });

    it('retains previous approved commits when the author approves a new head', async () => {
      vi.mocked(recordAuthorApproval).mockResolvedValue(approval);
      const { result } = renderActions('octocat');
      act(() => result.current.setState((prev) => ({
        ...prev, authorApproval: {
          ...approval, commitId: 'first', submittedAt: '2026-10-01T12:00:00Z', approvedCommitIds: ['first'],
        },
      })));
      await act(async () => { await result.current.submitReview('APPROVE'); });
      expect(result.current.state.authorApproval?.approvedCommitIds).toEqual(['first', 'head']);
    });

    it('does not mark a newly pushed commit reviewed while an author approval is saving', async () => {
      let save!: (value: AuthorApproval) => void;
      vi.mocked(recordAuthorApproval).mockReturnValue(new Promise((resolve) => { save = resolve; }));
      const { result } = renderActions('octocat');
      let pending!: Promise<void>;
      act(() => { pending = result.current.submitReview('APPROVE'); });
      act(() => result.current.setState((prev) => ({
        ...prev,
        pr: prev.pr && { ...prev.pr, headSha: 'next' },
        iterations: [
          ...prev.iterations,
          { index: 3, sha: 'next', shortSha: 'next', label: 'Next', isBase: false },
        ],
        toIndex: 3,
      })));
      await act(async () => { save(approval); await pending; });
      expect(result.current.state.lastReviewed).toMatchObject({ sha: 'head', index: 2 });
      expect(countNewIterations(result.current.state.iterations, getLastReviewed(PR_KEY))?.count).toBe(1);
    });

    it.each(['COMMENT', 'REQUEST_CHANGES'] as const)('keeps author %s on the normal GitHub path', async (event) => {
      graphql.mockResolvedValueOnce(VOTED).mockResolvedValueOnce(page([]));
      const { result } = renderActions('octocat');
      await act(async () => { await result.current.submitReview(event, 'Reason'); });
      expect(sent(0)).toContain(`event: ${event}`);
      expect(sent(0)).toContain('body: "Reason"');
      expect(recordAuthorApproval).not.toHaveBeenCalled();
      expect(result.current.state.lastReviewed).toMatchObject({ sha: 'head', index: 2 });
    });
  });

  it('finds a vote that lands beyond the first page', async () => {
    // Reviews come back oldest-first, so the reviewer's own recent vote is on
    // the last page — exactly the case that used to leave the topbar empty.
    graphql
      .mockResolvedValueOnce(page(fullPage()))
      .mockResolvedValueOnce(page([review('octocat', 'COMMENTED', '2025-08-22T16:10:00Z')]));

    const reviewers = await fetchReviewers(COORDS);

    expect(graphql).toHaveBeenCalledTimes(2);
    expect(reviewers?.map((r) => r.user.login)).toContain('octocat');
  });

  it('keeps only the latest vote per reviewer across page boundaries', async () => {
    graphql
      .mockResolvedValueOnce(
        page([
          ...fullPage(),
          review('octocat', 'CHANGES_REQUESTED', '2025-08-20T09:00:00Z'),
        ].slice(0, 100)),
      )
      .mockResolvedValueOnce(page([review('octocat', 'APPROVED', '2025-08-22T16:10:00Z')]));

    const reviewers = await fetchReviewers(COORDS);
    const octocat = reviewers?.find((r) => r.user.login === 'octocat');
    expect(octocat?.state).toBe('APPROVED');
  });

  it('retains approvals across pages while preserving the latest vote', async () => {
    graphql
      .mockResolvedValueOnce(page([
        { ...review('octocat', 'APPROVED', '2025-08-20T09:00:00Z'), commit_id: 'first' },
        ...fullPage().slice(0, 99),
      ]))
      .mockResolvedValueOnce(page([
        { ...review('octocat', 'APPROVED', '2025-08-21T09:00:00Z'), commit_id: 'second' },
        review('octocat', 'COMMENTED', '2025-08-22T09:00:00Z'),
      ]));

    const reviewers = await fetchReviewers(COORDS);
    expect(reviewers?.find((r) => r.user.login === 'octocat')).toMatchObject({
      state: 'COMMENTED',
      commitId: 'abc',
      approvedCommitIds: ['first', 'second'],
    });
  });

  it('returns undefined when the read fails, so a blip cannot wipe the pills', async () => {
    graphql.mockResolvedValueOnce(refused('boom'));
    expect(await fetchReviewers(COORDS)).toBeUndefined();
  });

  it('returns an empty list when the PR genuinely has no reviews', async () => {
    graphql.mockResolvedValueOnce(page([]));
    expect(await fetchReviewers(COORDS)).toEqual([]);
  });

  it('ignores reviews with an unrecognised state', async () => {
    graphql.mockResolvedValueOnce(page([review('ghost', 'WEIRD', '2025-08-22T00:00:00Z')]));
    expect(await fetchReviewers(COORDS)).toEqual([]);
  });
});
