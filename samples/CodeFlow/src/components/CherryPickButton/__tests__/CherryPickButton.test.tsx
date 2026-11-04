import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PrSummary } from '../../../types';

let pr: PrSummary | undefined;

vi.mock('../../../state/useCodeFlow', () => ({ useCodeFlow: () => ({ pr }) }));
vi.mock('../../../services/githubService', () => ({
  GitHubService: { listBranches: vi.fn() },
}));
vi.mock('../../../services/cherryPick', async () => {
  // Only the pure half is real: importing the orchestration would drag the
  // generated connector in with it.
  const plan = await vi.importActual<
    typeof import('../../../services/cherryPick/cherryPickPlan')
  >('../../../services/cherryPick/cherryPickPlan');
  return {
    ...plan,
    previewCherryPick: vi.fn(),
    cherryPickPullRequest: vi.fn(),
  };
});

import { GitHubService } from '../../../services/githubService';
import { cherryPickPullRequest, previewCherryPick } from '../../../services/cherryPick';
import { CherryPickButton } from '../CherryPickButton';

const listBranches = vi.mocked(GitHubService.listBranches);
const preview = vi.mocked(previewCherryPick);
const run = vi.mocked(cherryPickPullRequest);

function makePr(over: Partial<PrSummary> = {}): PrSummary {
  return {
    coordinates: { owner: 'octo', name: 'repo', number: 42 },
    title: 'Fix the crash',
    state: 'closed',
    draft: false,
    merged: true,
    author: { login: 'alice' },
    baseRef: 'main',
    baseSha: 'basesha',
    headRef: 'fix/crash',
    headSha: 'headsha',
    ...over,
  };
}

const OPEN = { name: /^🍒 Cherry-pick$/ };
const CONFIRM = { name: /cherry-pick pull request/i };

beforeEach(() => {
  vi.clearAllMocks();
  pr = makePr();
  listBranches.mockResolvedValue(['main', 'release/1.0', 'fix/crash']);
  preview.mockResolvedValue({
    files: [],
    plan: { writes: ['a.ts', 'b.ts'], deletes: [], skipped: [] },
    overlap: [],
    divergence: { known: true, changed: new Map() },
  });
  run.mockResolvedValue({
    branch: 'cherry-pick/pr-42-to-release/1.0',
    branchUrl: 'https://github.com/octo/repo/tree/cherry-pick/pr-42-to-release/1.0',
    written: ['a.ts', 'b.ts'],
    deleted: [],
    unchanged: [],
    merged: [],
    pullRequestOpened: true,
  });
});

/** Open the panel and choose a target, which is what every case starts from. */
async function openWithTarget(target = 'release/1.0') {
  fireEvent.click(screen.getByRole('button', OPEN));
  fireEvent.change(screen.getByRole('combobox', { name: /target branch/i }), {
    target: { value: target },
  });
  await waitFor(() => expect(preview).toHaveBeenCalled());
}

describe('CherryPickButton', () => {
  it('renders nothing without a pull request', () => {
    pr = undefined;
    const { container } = render(<CherryPickButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the cherry-pick to someone who is not the author', () => {
    pr = makePr({ author: { login: 'bob' } });
    render(<CherryPickButton />);
    expect(screen.getByRole('button', OPEN)).toBeEnabled();
  });

  it('does not act on the first click — it asks first', () => {
    render(<CherryPickButton />);
    fireEvent.click(screen.getByRole('button', OPEN));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /cherry-pick pull request/i })).toBeInTheDocument();
  });

  it('leaves out the branches this pull request already lives on', async () => {
    render(<CherryPickButton />);
    fireEvent.click(screen.getByRole('button', OPEN));
    await waitFor(() => expect(listBranches).toHaveBeenCalled());
    await waitFor(() => {
      const values = [...document.querySelectorAll('#cherry-pick-branches option')].map(
        (o) => (o as HTMLOptionElement).value,
      );
      expect(values).toEqual(['release/1.0']);
    });
  });

  it('suggests a branch name once a target is chosen', async () => {
    render(<CherryPickButton />);
    await openWithTarget();
    expect(screen.getByRole('textbox', { name: /new branch/i })).toHaveValue(
      'cherry-pick/pr-42-to-release/1.0',
    );
  });

  it('stops re-suggesting once the reviewer names the branch themselves', async () => {
    render(<CherryPickButton />);
    await openWithTarget();
    const name = screen.getByRole('textbox', { name: /new branch/i });
    fireEvent.change(name, { target: { value: 'my-backport' } });
    fireEvent.change(screen.getByRole('combobox', { name: /target branch/i }), {
      target: { value: 'main' },
    });
    expect(name).toHaveValue('my-backport');
  });

  it('says how many files would move', async () => {
    render(<CherryPickButton />);
    await openWithTarget();
    await waitFor(() =>
      expect(screen.getByText(/2 files would be cherry-picked/i)).toBeInTheDocument(),
    );
  });

  it('says which files will be merged when the target has moved', async () => {
    preview.mockResolvedValue({
      files: [],
      plan: { writes: ['a.ts'], deletes: [], skipped: [] },
      overlap: ['a.ts'],
      divergence: { known: true, changed: new Map([['a.ts', 'modified']]) },
      warning:
        '1 file has also changed on release/1.0 since this pull request branched (a.ts). They’ll be merged; if any of them conflict, nothing is written.',
    });
    render(<CherryPickButton />);
    await openWithTarget();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/also changed on release\/1\.0/),
    );
    expect(screen.getByRole('status').textContent).toMatch(/merged/);
  });

  it('refuses a branch name git would reject, without calling out', async () => {
    render(<CherryPickButton />);
    await openWithTarget();
    fireEvent.change(screen.getByRole('textbox', { name: /new branch/i }), {
      target: { value: 'bad name' },
    });
    expect(screen.getByRole('alert').textContent).toMatch(/space/i);
    expect(screen.getByRole('button', CONFIRM)).toBeDisabled();
  });

  it('cherry-picks onto the chosen branch', async () => {
    render(<CherryPickButton />);
    await openWithTarget();
    await waitFor(() => expect(screen.getByRole('button', CONFIRM)).toBeEnabled());
    fireEvent.click(screen.getByRole('button', CONFIRM));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          targetBranch: 'release/1.0',
          newBranch: 'cherry-pick/pr-42-to-release/1.0',
          openPullRequest: true,
        }),
      ),
    );
  });

  it('cherry-picks a merged PR even when its source branch is no longer listed', async () => {
    pr = makePr({ state: 'closed', merged: true, headRef: 'deleted/fix' });
    listBranches.mockResolvedValue(['main', 'release/1.0']);
    render(<CherryPickButton />);
    expect(screen.getByRole('button', OPEN)).toBeEnabled();
    await openWithTarget();
    expect(screen.getByText(/even after it is merged or its source branch is deleted/))
      .toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', CONFIRM)).toBeEnabled());
    fireEvent.click(screen.getByRole('button', CONFIRM));

    await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({
      pr,
      targetBranch: 'release/1.0',
      openPullRequest: true,
    })));
    expect(await screen.findByRole('status')).toHaveTextContent('opened a pull request');
  });

  it('can be told not to open a pull request', async () => {
    render(<CherryPickButton />);
    await openWithTarget();
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(screen.getByRole('button', CONFIRM)).toBeEnabled());
    fireEvent.click(screen.getByRole('button', CONFIRM));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ openPullRequest: false })),
    );
  });

  it('closes the panel and links the branch it made', async () => {
    render(<CherryPickButton />);
    await openWithTarget();
    await waitFor(() => expect(screen.getByRole('button', CONFIRM)).toBeEnabled());
    fireEvent.click(screen.getByRole('button', CONFIRM));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /cherry-pick\/pr-42/ })).toHaveAttribute(
        'href',
        expect.stringContaining('/tree/cherry-pick/pr-42-to-release/1.0'),
      ),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reports which files had to be merged', async () => {
    run.mockResolvedValue({
      branch: 'b',
      branchUrl: 'https://github.com/octo/repo/tree/b',
      written: ['a.ts'],
      deleted: [],
      unchanged: [],
      merged: ['a.ts'],
      pullRequestOpened: false,
    });
    render(<CherryPickButton />);
    await openWithTarget();
    await waitFor(() => expect(screen.getByRole('button', CONFIRM)).toBeEnabled());
    fireEvent.click(screen.getByRole('button', CONFIRM));
    await waitFor(() =>
      expect(
        screen.getByText(/1 file was merged with changes already on that branch/i),
      ).toBeInTheDocument(),
    );
  });

  it('shows a conflict refusal in full, so the blocking files can be read', async () => {
    run.mockRejectedValue(
      new Error(
        'This pull request can’t be cherry-picked cleanly, so nothing was changed.\n\n• src/a.ts — it conflicts with release/1.0 in 2 places\n\nCherry-pick this one locally, where you can resolve the conflicts.',
      ),
    );
    render(<CherryPickButton />);
    await openWithTarget();
    await waitFor(() => expect(screen.getByRole('button', CONFIRM)).toBeEnabled());
    fireEvent.click(screen.getByRole('button', CONFIRM));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/nothing was changed/),
    );
    expect(screen.getByRole('alert').textContent).toMatch(/src\/a\.ts — it conflicts/);
  });

  it('surfaces the failure and keeps the panel open so it can be retried', async () => {
    run.mockRejectedValue(new Error('Reference already exists'));
    render(<CherryPickButton />);
    await openWithTarget();
    await waitFor(() => expect(screen.getByRole('button', CONFIRM)).toBeEnabled());
    fireEvent.click(screen.getByRole('button', CONFIRM));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Reference already exists/),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('lets the reviewer back out', async () => {
    render(<CherryPickButton />);
    await openWithTarget();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });
});
