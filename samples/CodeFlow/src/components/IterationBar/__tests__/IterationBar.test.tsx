import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { AuthorApproval, GitUserRef, Iteration, PrSummary, Reviewer } from '../../../types';
import type { ForcePushInfo } from '../../../utils/forcePush';
import type { LastReviewed } from '../../../utils/lastReviewed';

const selectIterations = vi.fn();

let mockState: {
  iterations: Iteration[];
  fromIndex: number;
  toIndex: number;
  comparisonLoading: boolean;
  forcePush?: ForcePushInfo;
  pr?: PrSummary;
  lastReviewed?: LastReviewed;
  currentUser?: GitUserRef;
  reviewers: Reviewer[];
  authorApproval?: AuthorApproval | null;
};

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ({
    ...mockState,
    actions: { selectIterations },
  }),
}));

import { IterationBar } from '../IterationBar';

function makeIterations(): Iteration[] {
  return [
    { index: 0, sha: 'base00', shortSha: 'base00', label: 'Base', message: 'Base (main)', isBase: true },
    {
      index: 1,
      sha: 'aaa111',
      shortSha: 'aaa111',
      label: 'Commit 1',
      message: 'First change',
      date: '2026-01-01T00:00:00Z',
      isBase: false,
    },
    {
      index: 2,
      sha: 'bbb222',
      shortSha: 'bbb222',
      label: 'Commit 2',
      message: 'Second change',
      date: '2026-01-02T00:00:00Z',
      isBase: false,
    },
  ];
}

beforeEach(() => {
  selectIterations.mockClear();
  mockState = {
    iterations: makeIterations(),
    fromIndex: 0,
    toIndex: 2,
    comparisonLoading: false,
    forcePush: undefined,
    pr: undefined,
    lastReviewed: undefined,
    currentUser: { login: 'octocat' },
    reviewers: [],
  };
});

describe('IterationBar', () => {
  it('shows the iteration count excluding base', () => {
    render(<IterationBar />);
    expect(screen.getByText('2 iterations')).toBeInTheDocument();
  });

  it('singularizes the count label for a single iteration', () => {
    mockState.iterations = makeIterations().slice(0, 2);
    mockState.toIndex = 1;
    render(<IterationBar />);
    expect(screen.getByText('1 iteration')).toBeInTheDocument();
  });

  it('renders nothing when there are no iterations', () => {
    mockState.iterations = [];
    const { container } = render(<IterationBar />);
    expect(container.firstChild).toBeNull();
  });

  it('opens a picker and lists each iteration message', () => {
    render(<IterationBar />);
    fireEvent.click(screen.getByLabelText(/From iteration:/));
    const listbox = screen.getByRole('listbox', { name: 'From iteration' });
    expect(within(listbox).getByText('First change')).toBeInTheDocument();
    expect(within(listbox).getByText('Second change')).toBeInTheDocument();
    expect(within(listbox).getByText('Base (main)')).toBeInTheDocument();
  });

  it('selects a new "from" iteration from the picker', () => {
    render(<IterationBar />);
    fireEvent.click(screen.getByLabelText(/From iteration:/));
    const listbox = screen.getByRole('listbox', { name: 'From iteration' });
    fireEvent.click(within(listbox).getByText('First change'));
    expect(selectIterations).toHaveBeenCalledWith(1, 2);
  });

  it('selects a new "to" iteration from the picker', () => {
    render(<IterationBar />);
    fireEvent.click(screen.getByLabelText(/To iteration:/));
    const listbox = screen.getByRole('listbox', { name: 'To iteration' });
    fireEvent.click(within(listbox).getByText('First change'));
    expect(selectIterations).toHaveBeenCalledWith(0, 1);
  });

  it('Full PR resets to base vs latest', () => {
    mockState.fromIndex = 1;
    mockState.toIndex = 2;
    render(<IterationBar />);
    const fullPr = screen.getByRole('button', { name: 'Full PR' });
    expect(fullPr).not.toBeDisabled();
    fireEvent.click(fullPr);
    expect(selectIterations).toHaveBeenCalledWith(0, 2);
  });

  it('disables Full PR when the full range is already selected', () => {
    render(<IterationBar />);
    expect(screen.getByRole('button', { name: 'Full PR' })).toBeDisabled();
  });

  it('shows the compare-to iteration message and index in the detail area', () => {
    render(<IterationBar />);
    // toIndex is 2 -> "Second change".
    expect(screen.getByText('Second change')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });
});

describe('IterationBar approval markers', () => {
  it('marks only the author\'s exact approved commits as app-only in both pickers', () => {
    mockState.authorApproval = {
      user: { login: 'Octocat' }, state: 'APPROVED', source: 'codeflow',
      commitId: 'aaa111', approvedCommitIds: ['aaa111'], submittedAt: '2026-10-02T12:00:00Z',
    };
    render(<IterationBar />);
    for (const label of ['From iteration', 'To iteration']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`${label}:`) }));
      const listbox = screen.getByRole('listbox', { name: label });
      expect(within(listbox).getByRole('img', { name: 'Previously approved by you (app only)' }))
        .toBeInTheDocument();
      expect(within(listbox).getByRole('option', { name: /Second change/ })).not.toHaveTextContent('✓');
      fireEvent.keyDown(document, { key: 'Escape' });
    }
  });

  it('does not show the author\'s app-only markers as another reviewer\'s approvals', () => {
    mockState.authorApproval = {
      user: { login: 'alice' }, state: 'APPROVED', source: 'codeflow',
      commitId: 'aaa111', approvedCommitIds: ['aaa111'], submittedAt: '2026-10-02T12:00:00Z',
    };
    render(<IterationBar />);
    fireEvent.click(screen.getByLabelText(/From iteration:/));
    expect(screen.queryByRole('img', { name: /Previously approved/ })).not.toBeInTheDocument();
  });

  const approvedFirst: Reviewer = {
    user: { login: 'Octocat' },
    state: 'COMMENTED',
    commitId: 'bbb222',
    approvedCommitIds: ['aaa111'],
  };

  it.each(['From iteration', 'To iteration'])('marks your earlier approvals in the %s picker', (label) => {
    mockState.reviewers = [approvedFirst];
    render(<IterationBar />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${label}:`) }));
    const listbox = screen.getByRole('listbox', { name: label });
    const approved = within(listbox).getByRole('option', { name: /First change/ });
    const marker = within(approved).getByRole('img', { name: 'Previously approved by you' });
    expect(marker).toHaveTextContent('✓');
    expect(marker).toHaveAttribute('title', 'Previously approved by you');
    expect(approved).toHaveAttribute('aria-selected', 'false');
    expect(within(listbox).getAllByRole('img')).toHaveLength(1);
    expect(within(listbox).getByRole('option', { name: /Second change/ }))
      .not.toHaveTextContent('✓');
    fireEvent.click(approved);
    expect(selectIterations).toHaveBeenCalledWith(...(label === 'From iteration' ? [1, 2] : [0, 1]));
  });

  it('marks every approved SHA without confusing approval with the selected option', () => {
    mockState.reviewers = [{ ...approvedFirst, approvedCommitIds: ['aaa111', 'bbb222'] }];
    render(<IterationBar />);
    fireEvent.click(screen.getByLabelText(/To iteration:/));
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('img', { name: 'Previously approved by you' })).toHaveLength(2);
    expect(within(listbox).getByRole('option', { name: /Second change/ }))
      .toHaveAttribute('aria-selected', 'true');
  });

  it('does not mark someone else\'s approval or a locally reviewed iteration', () => {
    mockState.reviewers = [{ ...approvedFirst, user: { login: 'ada' } }];
    mockState.lastReviewed = { sha: 'aaa111', index: 1, at: '2026-01-01T12:00:00Z' };
    render(<IterationBar />);
    fireEvent.click(screen.getByLabelText(/From iteration:/));
    expect(screen.queryByRole('img', { name: 'Previously approved by you' })).not.toBeInTheDocument();
  });

  it('does not guess approvals when the signed-in user is unknown', () => {
    mockState.currentUser = undefined;
    mockState.reviewers = [approvedFirst];
    render(<IterationBar />);
    fireEvent.click(screen.getByLabelText(/From iteration:/));
    expect(screen.queryByRole('img', { name: 'Previously approved by you' })).not.toBeInTheDocument();
  });

  it('does not mark base or reuse a force-pushed approval by index or short SHA', () => {
    mockState.reviewers = [{ ...approvedFirst, approvedCommitIds: ['base00', 'aaa111-old'] }];
    render(<IterationBar />);
    fireEvent.click(screen.getByLabelText(/From iteration:/));
    expect(screen.queryByRole('img', { name: 'Previously approved by you' })).not.toBeInTheDocument();
  });

  it('updates an open picker when refreshed approval history changes', () => {
    const { rerender } = render(<IterationBar />);
    fireEvent.click(screen.getByLabelText(/From iteration:/));
    expect(screen.queryByRole('img', { name: 'Previously approved by you' })).not.toBeInTheDocument();
    mockState.reviewers = [approvedFirst];
    rerender(<IterationBar />);
    expect(screen.getByRole('img', { name: 'Previously approved by you' })).toBeInTheDocument();
    mockState.reviewers = [];
    rerender(<IterationBar />);
    expect(screen.queryByRole('img', { name: 'Previously approved by you' })).not.toBeInTheDocument();
  });
});

describe('IterationBar new-since-last-review', () => {
  const reviewedFirst: LastReviewed = {
    sha: 'aaa111',
    index: 1,
    at: '2026-01-01T12:00:00Z',
  };

  it('says nothing when the reviewer has never reviewed this PR', () => {
    render(<IterationBar />);
    expect(screen.queryByText(/since your last review/)).not.toBeInTheDocument();
  });

  it('counts the iterations pushed since the last review', () => {
    mockState.lastReviewed = reviewedFirst;
    render(<IterationBar />);
    expect(screen.getByText('1 new since your last review')).toBeInTheDocument();
  });

  it.each(['GitHub', 'app-only'] as const)(
    'repairs a stale four-new marker using your %s approval of the previous iteration',
    (source) => {
      mockState.iterations.push(
        { index: 3, sha: 'ccc333', shortSha: 'ccc333', label: 'Third', isBase: false },
        { index: 4, sha: 'ddd444', shortSha: 'ddd444', label: 'Fourth', isBase: false },
        { index: 5, sha: 'eee555', shortSha: 'eee555', label: 'Fifth', isBase: false },
      );
      mockState.toIndex = 5;
      mockState.lastReviewed = reviewedFirst;
      const { rerender } = render(<IterationBar />);
      expect(screen.getByText('4 new since your last review')).toBeInTheDocument();
      const approval: AuthorApproval = {
        user: { login: 'Octocat' }, state: 'APPROVED', source: 'codeflow',
        commitId: 'ddd444', approvedCommitIds: ['ddd444'], submittedAt: '2026-01-04T12:00:00Z',
      };
      if (source === 'app-only') mockState.authorApproval = approval;
      else mockState.reviewers = [{ ...approval, source: undefined }];
      rerender(<IterationBar />);
      const badge = screen.getByText('1 new since your last review');
      expect(badge).toHaveAttribute('title', expect.stringContaining('Iteration 4'));
      expect(screen.queryByText('4 new since your last review')).not.toBeInTheDocument();
      fireEvent.click(badge);
      expect(selectIterations).toHaveBeenCalledWith(4, 5);
    },
  );

  it('uses your submitted review on a device with no local marker', () => {
    mockState.reviewers = [{
      user: { login: 'Octocat' }, state: 'APPROVED',
      commitId: 'aaa111', submittedAt: reviewedFirst.at,
    }];
    render(<IterationBar />);
    expect(screen.getByText('1 new since your last review')).toBeInTheDocument();
  });

  it('does not let another reviewer or author change your review baseline', () => {
    mockState.lastReviewed = reviewedFirst;
    mockState.reviewers = [{
      user: { login: 'alice' }, state: 'APPROVED',
      commitId: 'bbb222', submittedAt: '2026-01-02T12:00:00Z',
    }];
    mockState.authorApproval = {
      ...mockState.reviewers[0], state: 'APPROVED', source: 'codeflow',
      commitId: 'bbb222', submittedAt: '2026-01-02T12:00:00Z', approvedCommitIds: ['bbb222'],
    };
    render(<IterationBar />);
    expect(screen.getByText('1 new since your last review')).toBeInTheDocument();
  });

  it('does not infer a remote review baseline without the signed-in identity', () => {
    mockState.currentUser = undefined;
    mockState.reviewers = [{
      user: { login: 'octocat' }, state: 'APPROVED',
      commitId: 'aaa111', submittedAt: reviewedFirst.at,
    }];
    render(<IterationBar />);
    expect(screen.queryByText(/since your last review/)).not.toBeInTheDocument();
  });

  it('says nothing when the last review was on the newest iteration', () => {
    mockState.lastReviewed = { sha: 'bbb222', index: 2, at: '2026-01-02T12:00:00Z' };
    render(<IterationBar />);
    expect(screen.queryByText(/since your last review/)).not.toBeInTheDocument();
  });

  it('says nothing when the remembered commit is gone from the branch', () => {
    // A force-push: any count would be a guess, and the force-push notice
    // already explains what happened.
    mockState.lastReviewed = { sha: 'ccc333', index: 1, at: '2026-01-01T12:00:00Z' };
    render(<IterationBar />);
    expect(screen.queryByText(/since your last review/)).not.toBeInTheDocument();
  });

  it('narrows the comparison to just the new work when clicked', () => {
    mockState.lastReviewed = reviewedFirst;
    render(<IterationBar />);
    fireEvent.click(screen.getByText('1 new since your last review'));
    expect(selectIterations).toHaveBeenCalledWith(1, 2);
  });

  it('names the iteration that was last reviewed', () => {
    mockState.lastReviewed = reviewedFirst;
    render(<IterationBar />);
    const pill = screen.getByText('1 new since your last review');
    expect(pill.getAttribute('title')).toContain('You last reviewed Iteration 1');
  });
});

describe('IterationBar force-push notice', () => {
  it('stays quiet when no force-push was detected', () => {
    render(<IterationBar />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('names how many iterations were lost once a force-push is confirmed', () => {
    mockState.forcePush = { confirmed: true, lostCount: 3, rewriteEvidence: true };
    render(<IterationBar />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('was force-pushed');
    expect(notice).toHaveTextContent('3 earlier commits are no longer on it');
  });

  it('singularizes the confirmed message for a single lost commit', () => {
    mockState.forcePush = { confirmed: true, lostCount: 1, rewriteEvidence: false };
    render(<IterationBar />);
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 earlier commit is no longer on it',
    );
  });

  it('does not warn when only commit metadata hints at a rewrite', () => {
    mockState.forcePush = { confirmed: false, lostCount: 0, rewriteEvidence: true };
    render(<IterationBar />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('links to the PR on GitHub with the extension opt-out param', () => {
    mockState.forcePush = { confirmed: true, lostCount: 2, rewriteEvidence: false };
    mockState.pr = { htmlUrl: 'https://github.com/o/r/pull/1' } as PrSummary;
    render(<IterationBar />);
    const link = screen.getByRole('link', { name: 'View on GitHub' });
    expect(link).toHaveAttribute('href', 'https://github.com/o/r/pull/1');
  });

  it('omits the link when the PR URL is unknown', () => {
    mockState.forcePush = { confirmed: true, lostCount: 2, rewriteEvidence: false };
    render(<IterationBar />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('IterationBar merge notice', () => {
  /** Adds a merge of mainline as iteration 2, then a further commit. */
  function withMerge() {
    const iters = makeIterations();
    iters[2] = { ...iters[2], parents: ['aaa111', 'main999'] };
    iters.push({
      index: 3,
      sha: 'ccc333',
      shortSha: 'ccc333',
      label: 'Commit 3',
      message: 'Third change',
      isBase: false,
    });
    mockState.iterations = iters;
    mockState.pr = { baseSha: 'base00' } as PrSummary;
  }

  it('explains the diff when the range ends on a merge', () => {
    withMerge();
    mockState.fromIndex = 1;
    mockState.toIndex = 2;
    render(<IterationBar />);
    expect(
      screen.getByText(
        "Showing all of the PR's changes as of iteration 2, because iteration 2 merged in another branch.",
      ),
    ).toBeInTheDocument();
  });

  it('names both the selected iteration and the merge when the range spans one', () => {
    withMerge();
    mockState.fromIndex = 1;
    mockState.toIndex = 3;
    render(<IterationBar />);
    expect(
      screen.getByText(
        "Showing all of the PR's changes as of iteration 3, because iteration 2 merged in another branch.",
      ),
    ).toBeInTheDocument();
  });

  it('exposes the notice to assistive technology', () => {
    withMerge();
    mockState.fromIndex = 1;
    mockState.toIndex = 2;
    render(<IterationBar />);
    expect(screen.getByRole('status')).toHaveTextContent('merged in another branch');
  });

  it('stays silent on the full PR range', () => {
    withMerge();
    mockState.fromIndex = 0;
    mockState.toIndex = 3;
    render(<IterationBar />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays silent when no merge is involved', () => {
    mockState.pr = { baseSha: 'base00' } as PrSummary;
    mockState.fromIndex = 1;
    mockState.toIndex = 2;
    render(<IterationBar />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
