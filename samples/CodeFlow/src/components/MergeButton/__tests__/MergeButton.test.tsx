import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MergeButton } from '../MergeButton';
import type { ChecksSummary, GitUserRef, PrCheck, PrSummary } from '../../../types';
import { tally } from '../../../services/checks/checksQuery';

const mergePr = vi.fn(async () => ({ merged: true, sha: 'merged-sha' }));

let pr: PrSummary | undefined;
let currentUser: GitUserRef | undefined;
let checks: ChecksSummary | undefined;
let checksLoading = false;

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ({ pr, currentUser, checks, checksLoading, actions: { mergePr } }),
}));

function makePr(over: Partial<PrSummary> = {}): PrSummary {
  return {
    coordinates: { owner: 'octo', name: 'repo', number: 7 },
    title: 'Do the thing',
    state: 'open',
    draft: false,
    merged: false,
    author: { login: 'alice' },
    baseRef: 'main',
    baseSha: 'base',
    headRef: 'feature',
    headSha: 'head',
    ...over,
  };
}

function makeChecks(overrides: Partial<PrCheck> = {}): ChecksSummary {
  const list: PrCheck[] = [{
    id: '1', name: 'Build', outcome: 'success', rawState: 'SUCCESS',
    kind: 'check', isRequired: true, ...overrides,
  }];
  return { checks: list, sha: 'head', ...tally(list) };
}

beforeEach(() => {
  mergePr.mockClear();
  mergePr.mockResolvedValue({ merged: true, sha: 'merged-sha' });
  pr = makePr();
  currentUser = { login: 'alice' };
  checks = makeChecks();
  checksLoading = false;
});

describe('MergeButton', () => {
  it('renders nothing for someone who is not the author', () => {
    currentUser = { login: 'bob' };
    const { container } = render(<MergeButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the author a merge button', () => {
    render(<MergeButton />);
    expect(screen.getByRole('button', { name: /merge/i })).toBeEnabled();
  });

  it('still lets the author merge when a check is failing, and warns instead of blocking', () => {
    checks = makeChecks({ outcome: 'failure' });
    render(<MergeButton />);
    const btn = screen.getByRole('button', { name: /^⛙ Merge$/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(screen.getByRole('status').textContent).toMatch(/1 required check failing/i);
  });

  it('keeps the confirmation clean when every check is green', () => {
    render(<MergeButton />);
    fireEvent.click(screen.getByRole('button', { name: /^⛙ Merge$/ }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says nothing about checks it has not finished reading', () => {
    checks = makeChecks({ outcome: 'failure' });
    checksLoading = true;
    render(<MergeButton />);
    fireEvent.click(screen.getByRole('button', { name: /^⛙ Merge$/ }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('merges despite the red check, once confirmed', async () => {
    checks = makeChecks({ outcome: 'failure' });
    render(<MergeButton />);
    fireEvent.click(screen.getByRole('button', { name: /^⛙ Merge$/ }));
    fireEvent.click(screen.getByRole('button', { name: /merge pull request/i }));
    await waitFor(() => expect(mergePr).toHaveBeenCalledWith('merge'));
  });

  it.each(['failure', 'pending'] as const)('does not flag or block merging for optional %s', async (outcome) => {
    checks = makeChecks({ outcome, isRequired: false });
    render(<MergeButton />);
    const button = screen.getByRole('button', { name: /^⛙ Merge$/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /merge pull request/i }));
    await waitFor(() => expect(mergePr).toHaveBeenCalledWith('merge'));
  });

  it('does not merge on the first click — it asks first', () => {
    render(<MergeButton />);
    fireEvent.click(screen.getByRole('button', { name: /merge/i }));
    expect(mergePr).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /merge pull request/i })).toBeInTheDocument();
  });

  it('names both branches in the confirmation, so the direction is unambiguous', () => {
    render(<MergeButton />);
    fireEvent.click(screen.getByRole('button', { name: /^⛙ Merge$/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('feature');
    expect(dialog.textContent).toContain('main');
  });

  it('merges with a merge commit by default', async () => {
    render(<MergeButton />);
    fireEvent.click(screen.getByRole('button', { name: /^⛙ Merge$/ }));
    fireEvent.click(screen.getByRole('button', { name: /merge pull request/i }));
    await waitFor(() => expect(mergePr).toHaveBeenCalledWith('merge'));
  });

  it('merges with the strategy the author picked', async () => {
    render(<MergeButton />);
    fireEvent.click(screen.getByRole('button', { name: /^⛙ Merge$/ }));
    fireEvent.click(screen.getByRole('radio', { name: /squash/i }));
    fireEvent.click(screen.getByRole('button', { name: /merge pull request/i }));
    await waitFor(() => expect(mergePr).toHaveBeenCalledWith('squash'));
  });

  it('closes the confirmation and reports success', async () => {
    render(<MergeButton />);
    fireEvent.click(screen.getByRole('button', { name: /^⛙ Merge$/ }));
    fireEvent.click(screen.getByRole('button', { name: /merge pull request/i }));
    await waitFor(() => expect(screen.getByText('Merged')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('surfaces GitHub’s own refusal rather than a generic failure', async () => {
    mergePr.mockRejectedValue(new Error('Head branch was modified. Review and try the merge again.'));
    render(<MergeButton />);
    fireEvent.click(screen.getByRole('button', { name: /^⛙ Merge$/ }));
    fireEvent.click(screen.getByRole('button', { name: /merge pull request/i }));
    await waitFor(() => expect(screen.getByText(/Head branch was modified/)).toBeInTheDocument());
  });

  it('lets the author back out', () => {
    render(<MergeButton />);
    fireEvent.click(screen.getByRole('button', { name: /^⛙ Merge$/ }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mergePr).not.toHaveBeenCalled();
  });

  it('disappears once the PR is merged', () => {
    pr = makePr({ merged: true });
    const { container } = render(<MergeButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
