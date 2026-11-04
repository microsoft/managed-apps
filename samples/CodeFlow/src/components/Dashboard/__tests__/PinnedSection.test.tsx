import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrListItem, PrSummary } from '../../../types';

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ({ state: {}, actions: {} }),
}));
vi.mock('../../../services/githubService', () => ({
  GitHubService: {
    listPullRequests: vi.fn(),
    searchPullRequests: vi.fn(),
    getAuthenticatedUser: vi.fn(async () => undefined),
  },
}));
vi.mock('../../../state/hooks/useReviewStateRevision', () => ({
  useReviewStateRevision: () => '0',
}));

import { GitHubService } from '../../../services/githubService';
import { PinnedSection } from '../Dashboard';

const list = vi.mocked(GitHubService.listPullRequests);
const search = vi.mocked(GitHubService.searchPullRequests);
const openPr: PrSummary = {
  coordinates: { owner: 'octo', name: 'repo', number: 41 },
  title: 'Work in progress',
  state: 'open',
  draft: false,
  merged: false,
  baseRef: 'main',
  baseSha: 'base',
  headRef: 'feature',
  headSha: 'head',
};
const mergedPr: PrListItem = {
  coordinates: { owner: 'octo', name: 'repo', number: 42 },
  title: 'Merged fix',
  state: 'closed',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderPinned() {
  const onOpen = vi.fn();
  const view = render(
    <PinnedSection
      pins={[
        { owner: 'octo', name: 'repo', pinnedAt: '2026-10-01' },
        { owner: 'octo', name: 'other', pinnedAt: '2026-10-01' },
      ]}
      onOpen={onOpen}
      onFlag={vi.fn()}
      flags={[]}
      onChange={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  return { ...view, onOpen };
}

function expandRepo(name = 'repo') {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`octo/${name}$`) }));
}

function chooseMerged() {
  fireEvent.click(screen.getByRole('button', { name: 'Merged PRs' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  list.mockResolvedValue([openPr]);
  search.mockResolvedValue([mergedPr]);
});

describe('pinned repository PR browsing', () => {
  it('keeps open PRs as the default and does not fetch until expanded', async () => {
    renderPinned();
    expect(list).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();

    expandRepo();

    expect(list).toHaveBeenCalledWith({ owner: 'octo', name: 'repo' }, 'open');
    expect(await screen.findByTitle('Work in progress')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open PRs' })).toHaveAttribute('aria-pressed', 'true');
    expect(search).not.toHaveBeenCalled();
  });

  it('finds merged PRs server-side and opens the selected PR for cherry-picking', async () => {
    const { onOpen } = renderPinned();
    expandRepo();
    await screen.findByTitle('Work in progress');
    chooseMerged();

    expect(search).toHaveBeenCalledWith('is:pr is:merged repo:octo/repo', 100, { force: true });
    expect(screen.getByRole('button', { name: 'Merged PRs' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Open a merged PR, then choose Cherry-pick/)).toBeInTheDocument();
    expect(screen.getByText(/up to 100 recently updated results/)).toBeInTheDocument();
    fireEvent.click(await screen.findByTitle('Merged fix'));

    expect(onOpen).toHaveBeenCalledWith(mergedPr.coordinates);
    expect(screen.queryByTitle('Work in progress')).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('switches back to open PRs without showing the merged results', async () => {
    renderPinned();
    expandRepo();
    chooseMerged();
    await screen.findByTitle('Merged fix');
    fireEvent.click(screen.getByRole('button', { name: 'Open PRs' }));

    expect(await screen.findByTitle('Work in progress')).toBeInTheDocument();
    expect(screen.queryByTitle('Merged fix')).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('reports an empty merged view rather than saying there are no open PRs', async () => {
    search.mockResolvedValue([]);
    renderPinned();
    expandRepo();
    chooseMerged();

    expect(await screen.findByText('No merged pull requests.')).toBeInTheDocument();
    expect(screen.queryByText('No open pull requests.')).not.toBeInTheDocument();
  });

  it('surfaces merged search failures and retries the same repository and mode', async () => {
    search.mockRejectedValueOnce(new Error('Search unavailable'));
    renderPinned();
    expandRepo();
    chooseMerged();

    expect(await screen.findByRole('alert')).toHaveTextContent('Search unavailable');
    expect(screen.queryByText('No merged pull requests.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTitle('Merged fix')).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith('is:pr is:merged repo:octo/repo', 100, { force: true });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['success', 'failure'] as const)(
    'ignores a late open request %s after switching to merged',
    async (outcome) => {
      const pending = deferred<PrSummary[]>();
      list.mockReturnValueOnce(pending.promise);
      renderPinned();
      expandRepo();
      chooseMerged();
      await screen.findByTitle('Merged fix');

      await act(async () => {
        if (outcome === 'success') pending.resolve([openPr]);
        else pending.reject(new Error('Old failure'));
      });

      expect(screen.getByTitle('Merged fix')).toBeInTheDocument();
      expect(screen.queryByTitle('Work in progress')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('ignores a late merged request after switching repositories', async () => {
    const pending = deferred<PrListItem[]>();
    search.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    renderPinned();
    expandRepo();
    chooseMerged();
    expandRepo('other');
    await screen.findByText('No merged pull requests.');

    await act(async () => pending.resolve([mergedPr]));

    expect(search).toHaveBeenLastCalledWith('is:pr is:merged repo:octo/other', 100, { force: true });
    expect(screen.queryByTitle('Merged fix')).not.toBeInTheDocument();
    expect(screen.getByText('No merged pull requests.')).toBeInTheDocument();
  });

  it('does not refetch on collapse and ignores a stale result after reopening', async () => {
    const pending = deferred<PrSummary[]>();
    list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    renderPinned();
    expandRepo();
    expandRepo();
    expect(list).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'Pull request status' })).not.toBeInTheDocument();
    expandRepo();
    await screen.findByText('No open pull requests.');

    await act(async () => pending.resolve([openPr]));

    expect(screen.queryByTitle('Work in progress')).not.toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});
