import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CodeFlowContextValue } from '../../../state/codeFlowContext';
import { ReviewLayout } from '../Layout';

let context: CodeFlowContextValue;
vi.mock('../../../state/useCodeFlow', () => ({ useCodeFlow: () => context }));
vi.mock('@microsoft/managed-apps/data', () => ({ getClient: () => ({}) }));
vi.mock('@microsoft/managed-apps/auth', () => ({ getUser: vi.fn() }));
vi.mock('../../BugSwarm/BugSwarm', () => ({ BugSwarm: () => null }));
vi.mock('../../IterationBar/IterationBar', () => ({ IterationBar: () => null }));
vi.mock('../../FileList/FileList', () => ({ FileList: () => null }));
vi.mock('../../DiffViewer/DiffViewer', () => ({ DiffViewer: () => null }));
vi.mock('../../CommentSummary/CommentSummary', () => ({ CommentSummary: () => null }));
vi.mock('../../CopyLinkButton/CopyLinkButton', () => ({ CopyLinkButton: () => null }));
vi.mock('../../ChecksPill/ChecksPill', () => ({ ChecksPill: () => null }));
vi.mock('../../MergeButton/MergeButton', () => ({ MergeButton: () => null }));
vi.mock('../../AutoMergeButton/AutoMergeButton', () => ({ AutoMergeButton: () => null }));
vi.mock('../../CherryPickButton/CherryPickButton', () => ({ CherryPickButton: () => null }));
vi.mock('../../PublishDraftButton/PublishDraftButton', () => ({ PublishDraftButton: () => null }));
vi.mock('../RefreshTimer', () => ({ RefreshTimer: () => null }));

beforeEach(() => {
  const noop = vi.fn();
  context = {
    status: 'ready', prKey: 'o/r#1', rangeId: 'base..head', commentBackendLabel: 'GitHub',
    pr: {
      coordinates: { owner: 'o', name: 'r', number: 1 }, title: 'PR',
      author: { login: 'Alice' }, state: 'open', draft: false, merged: false,
      baseRef: 'main', headRef: 'feature', baseSha: 'base', headSha: 'head',
    },
    currentUser: { login: 'alice' }, reviewers: [], iterations: [], fromIndex: 0, toIndex: 0,
    comparisonLoading: false, seen: {}, threads: [], threadsLoading: false, closed: {},
    closedBy: {}, viewMode: 'inline',
    actions: {
      loadPr: noop, reset: noop, selectIterations: noop, selectFile: noop, selectFolder: noop,
      focusThread: noop, focusLine: noop, consumeLineFocus: noop, toggleSeen: noop, markAllSeen: noop,
      setViewMode: noop, createThread: noop, addComment: noop, editComment: noop, deleteComment: noop, addIssueComment: noop,
      setThreadStatus: noop, setThreadClosed: noop, deleteThread: noop, submitReview: vi.fn().mockResolvedValue(undefined),
      publishDraft: noop, refreshNow: noop, refreshChecks: noop, mergePr: noop,
      enableAutoMerge: noop, disableAutoMerge: noop,
    },
  };
});

describe('author approval controls', () => {
  it('explains app-only scope before approving and confirms shared persistence afterward', async () => {
    render(<ReviewLayout />);
    const button = screen.getByRole('button', { name: /Approve \(app only\)/ });
    expect(button).toHaveAttribute('title', expect.stringContaining('Does not count toward GitHub'));
    fireEvent.click(button);
    expect(await screen.findByText('Author approval saved in CodeFlow only; GitHub is unchanged.')).toBeInTheDocument();
    expect(context.actions.submitReview).toHaveBeenCalledWith('APPROVE', undefined);
  });

  it('shows the write failure without a success message', async () => {
    vi.mocked(context.actions.submitReview).mockRejectedValue(new Error('Storage unavailable'));
    render(<ReviewLayout />);
    fireEvent.click(screen.getByRole('button', { name: /Approve \(app only\)/ }));
    expect(await screen.findByText('Storage unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/Author approval saved/)).not.toBeInTheDocument();
  });

  it('shows the author badge to teammates while keeping ordinary author comments hidden', () => {
    context.currentUser = { login: 'bob' };
    context.reviewers = [{ user: { login: 'Alice' }, state: 'COMMENTED' }];
    context.authorApproval = {
      user: { login: 'Alice' }, source: 'codeflow', state: 'APPROVED',
      commitId: 'head', submittedAt: '2026-10-02T12:00:00Z', approvedCommitIds: ['head'],
    };
    render(<ReviewLayout />);
    expect(screen.getByText('Author approved (app only)')).toBeInTheDocument();
    expect(screen.queryByTitle('Alice: commented')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toHaveAttribute('title', 'Approve this pull request');
  });

  it('disables self-approval for a closed PR', () => {
    if (context.pr) context.pr.state = 'closed';
    render(<ReviewLayout />);
    expect(screen.getByRole('button', { name: /Approve \(app only\)/ })).toBeDisabled();
  });
});
