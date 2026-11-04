import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedbackDialog } from '../FeedbackDialog';
import type { Issue } from '../../../types';

const { listIssues, createIssue, saveIssue, setIssueStatus } = vi.hoisted(() => ({
  listIssues: vi.fn(),
  createIssue: vi.fn(),
  saveIssue: vi.fn(),
  setIssueStatus: vi.fn(),
}));

const { getCurrentUserId, getAuthenticatedUser, getCurrentUser } = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getCurrentUser: vi.fn(),
}));

// The expanded row renders a comment thread; keep it quiet so its own load
// failure can't masquerade as the dialog's error state.
const { listComments } = vi.hoisted(() => ({ listComments: vi.fn(async () => []) }));

vi.mock('../../../services/issues/commentStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/issues/commentStore')>()),
  listComments,
}));

vi.mock('../../../services/issues/issueStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/issues/issueStore')>()),
  listIssues,
  createIssue,
  saveIssue,
  setIssueStatus,
}));

vi.mock('../../../services/githubService', () => ({
  GitHubService: { getCurrentUserId, getAuthenticatedUser, getCurrentUser },
}));

const issue = (over: Partial<Issue> & { id: string }): Issue => ({
  title: 'Diff scroll jumps',
  body: 'It jumps when I collapse a file.',
  kind: 'bug',
  status: 'open',
  authorId: 'gh:1',
  authorLogin: 'ada',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const MINE = issue({ id: 'mine' });
const THEIRS = issue({
  id: 'theirs',
  title: 'Add dark mode',
  kind: 'idea',
  authorId: 'gh:2',
  authorLogin: 'grace',
  updatedAt: '2026-01-03T00:00:00Z',
});
const CLOSED = issue({
  id: 'done',
  title: 'Old complaint',
  status: 'closed',
  authorId: 'gh:2',
  authorLogin: 'grace',
  updatedAt: '2026-01-02T00:00:00Z',
});
const BLOCKED = issue({
  id: 'stuck',
  title: 'Needs an API we do not have',
  status: 'blocked',
  authorId: 'gh:2',
  authorLogin: 'grace',
  updatedAt: '2026-01-04T00:00:00Z',
});
const PENDING = issue({
  id: 'wip',
  title: 'Being worked right now',
  status: 'pending',
  authorId: 'gh:2',
  authorLogin: 'grace',
  updatedAt: '2026-01-05T00:00:00Z',
});
const WONTFIX = issue({
  id: 'nope',
  title: 'Something we decided against',
  status: 'wontfix',
  authorId: 'gh:2',
  authorLogin: 'grace',
  closedBy: 'grace',
  closedAt: '2026-01-06T00:00:00Z',
  updatedAt: '2026-01-06T00:00:00Z',
});

/** Sign in as a given user (attribution only). */
function signIn(id: string, login: string) {
  getCurrentUserId.mockResolvedValue(id);
  getAuthenticatedUser.mockResolvedValue({ login });
  getCurrentUser.mockResolvedValue({ login });
}

/** Expand an issue row so its detail actions are on screen. */
async function expand(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(title) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  listIssues.mockResolvedValue([THEIRS, CLOSED, MINE]);
  signIn('gh:1', 'ada');
});

describe('FeedbackDialog', () => {
  it('lists open issues by default, newest first', async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Add dark mode');
    expect(screen.queryByText('Old complaint')).toBeNull();
  });

  it('switches to closed and to all issues', async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    await screen.findByText('Add dark mode');

    fireEvent.click(screen.getByRole('button', { name: /^Closed/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Old complaint')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('shows a count per filter', async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    const open = await screen.findByRole('button', { name: /^Open/ });
    expect(within(open).getByText('2')).toBeTruthy();
  });

  it('lets the author edit their own issue', async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    await expand('Diff scroll jumps');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it("lets anyone edit, close or triage any item, since storage decides who may write", async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    await expand('Add dark mode');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByLabelText('Issue status')).toBeTruthy();
  });



  it('closes an issue and moves it out of the open filter', async () => {
    setIssueStatus.mockResolvedValue({ ...MINE, status: 'closed', updatedAt: '2026-02-01T00:00:00Z' });
    render(<FeedbackDialog onClose={vi.fn()} />);
    await expand('Diff scroll jumps');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(setIssueStatus).toHaveBeenCalledWith(MINE, 'closed', expect.anything()));
    await waitFor(() => expect(screen.queryByText('Diff scroll jumps')).toBeNull());
  });

  it('shows pending issues in the open list, and keeps blocked out', async () => {
    listIssues.mockResolvedValue([THEIRS, CLOSED, MINE, BLOCKED, PENDING]);
    render(<FeedbackDialog onClose={vi.fn()} />);
    await screen.findByText('Add dark mode');
    // Work already in flight is on screen, so nobody raises it twice.
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Being worked right now')).toBeTruthy();
    expect(screen.queryByText('Needs an API we do not have')).toBeNull();
    expect(screen.queryByText('Old complaint')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Pending/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Being worked right now')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Blocked/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Needs an API we do not have')).toBeTruthy();
  });

  it('counts pending under open as well as on its own tab', async () => {
    listIssues.mockResolvedValue([THEIRS, CLOSED, MINE, BLOCKED, PENDING]);
    render(<FeedbackDialog onClose={vi.fn()} />);
    const open = await screen.findByRole('button', { name: /^Open/ });
    expect(within(open).getByText('3')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /^Pending/ })).getByText('1')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /^Blocked/ })).getByText('1')).toBeTruthy();
  });

  it('moves an issue to blocked from the triage dropdown', async () => {
    setIssueStatus.mockResolvedValue({ ...MINE, status: 'blocked', updatedAt: '2026-02-01T00:00:00Z' });
    render(<FeedbackDialog onClose={vi.fn()} />);
    await expand('Diff scroll jumps');
    fireEvent.change(screen.getByLabelText('Issue status'), { target: { value: 'blocked' } });

    await waitFor(() => expect(setIssueStatus).toHaveBeenCalledWith(MINE, 'blocked', expect.anything()));
    // Blocked is still active work, so it leaves Open but stays in the tracker.
    await waitFor(() => expect(screen.queryByText('Diff scroll jumps')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /^Blocked/ }));
    expect(screen.getByText('Diff scroll jumps')).toBeTruthy();
  });

  it('offers only the active states in the triage dropdown', async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    await expand('Diff scroll jumps');
    const options = within(screen.getByLabelText('Issue status')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Open', 'Pending', 'Blocked']);
  });

  it('hides the triage dropdown once an issue is closed', async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Closed/ }));
    await expand('Old complaint');
    expect(screen.queryByLabelText('Issue status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });


  it('declines an issue as won’t fix, taking it off the open list', async () => {
    setIssueStatus.mockResolvedValue({
      ...MINE,
      status: 'wontfix',
      updatedAt: '2026-02-01T00:00:00Z',
    });
    render(<FeedbackDialog onClose={vi.fn()} />);
    await expand('Diff scroll jumps');
    fireEvent.click(screen.getByRole('button', { name: 'Won’t fix' }));

    await waitFor(() =>
      expect(setIssueStatus).toHaveBeenCalledWith(MINE, 'wontfix', expect.anything()),
    );
    await waitFor(() => expect(screen.queryByText('Diff scroll jumps')).toBeNull());
  });

  it('files a declined issue under Closed rather than a tab of its own', async () => {
    listIssues.mockResolvedValue([THEIRS, CLOSED, MINE, WONTFIX]);
    render(<FeedbackDialog onClose={vi.fn()} />);
    await screen.findByText('Add dark mode');
    expect(screen.queryByRole('button', { name: /^Won’t fix/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Closed/ }));
    expect(screen.getByText('Something we decided against')).toBeTruthy();
    expect(screen.getByText('Old complaint')).toBeTruthy();
  });

  it('says how a declined issue ended, so it reads differently from done', async () => {
    listIssues.mockResolvedValue([WONTFIX]);
    signIn('gh:9', 'octocat');
    render(<FeedbackDialog onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Closed/ }));
    await expand('Something we decided against');
    expect(screen.getByText(/closed as won’t fix by grace/)).toBeTruthy();
    // Already declined, so the only way out is back to open.
    expect(screen.queryByRole('button', { name: 'Won’t fix' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });

  it('lets a closed issue be redesignated without a reopen round trip', async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Closed/ }));
    await expand('Old complaint');
    expect(screen.getByRole('button', { name: 'Won’t fix' })).toBeTruthy();
  });

  it('saves an edit and leaves the editor', async () => {
    saveIssue.mockResolvedValue({ ...MINE, title: 'Diff scroll jumps on collapse' });
    render(<FeedbackDialog onClose={vi.fn()} />);
    await expand('Diff scroll jumps');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    fireEvent.change(screen.getByLabelText('Issue title'), {
      target: { value: 'Diff scroll jumps on collapse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(saveIssue).toHaveBeenCalledWith(
        MINE,
        expect.objectContaining({ title: 'Diff scroll jumps on collapse' }),
      ),
    );
    await waitFor(() => expect(screen.queryByLabelText('Issue title')).toBeNull());
  });

  it('raises a new issue attributed to the signed-in user', async () => {
    createIssue.mockResolvedValue(issue({ id: 'fresh', title: 'Fresh report' }));
    render(<FeedbackDialog onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /New item/ })).not.toHaveAttribute('disabled'),
    );
    fireEvent.click(screen.getByRole('button', { name: /New item/ }));

    fireEvent.change(screen.getByLabelText('Issue title'), { target: { value: 'Fresh report' } });
    fireEvent.change(screen.getByLabelText('Issue description'), { target: { value: 'Details' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() =>
      expect(createIssue).toHaveBeenCalledWith(
        { title: 'Fresh report', body: 'Details', kind: 'bug' },
        { id: 'ada', login: 'ada', name: undefined },
      ),
    );
    expect(await screen.findByText('Fresh report')).toBeTruthy();
  });

  it('refuses to submit an issue with no title', async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /New item/ })).not.toHaveAttribute('disabled'),
    );
    fireEvent.click(screen.getByRole('button', { name: /New item/ }));
    expect(screen.getByRole('button', { name: 'Save item' })).toHaveAttribute('disabled');
  });

  it('surfaces a failed write without dropping the list', async () => {
    setIssueStatus.mockRejectedValue(new Error('server said no'));
    render(<FeedbackDialog onClose={vi.fn()} />);
    await expand('Diff scroll jumps');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('server said no');
    expect(screen.getByText('Diff scroll jumps')).toBeTruthy();
  });

  it('explains when stored notes cannot be loaded', async () => {
    listIssues.mockRejectedValue(new Error('Browser storage is unavailable.'));
    render(<FeedbackDialog onClose={vi.fn()} />);
    expect(await screen.findByText(/couldn’t be loaded from storage/)).toBeTruthy();
  });

  it('carries the whole title in a tooltip while the row is a clipped one-liner', async () => {
    const long =
      'Cannot see the entire title of feedback entries because the row clips it at one line';
    listIssues.mockResolvedValue([issue({ id: 'long', title: long })]);
    render(<FeedbackDialog onClose={vi.fn()} />);
    expect(await screen.findByTitle(long)).toHaveTextContent(long);
  });

  it('wraps the title in full once the row is expanded, and drops the tooltip', async () => {
    const long =
      'Cannot see the entire title of feedback entries because the row clips it at one line';
    listIssues.mockResolvedValue([issue({ id: 'long', title: long })]);
    render(<FeedbackDialog onClose={vi.fn()} />);
    await expand(long);

    const title = screen.getByText(long);
    expect(title.className).toContain('issue__title--full');
    expect(title.getAttribute('title')).toBeNull();
  });

  it('closes on Escape and on the close button', async () => {
    const onClose = vi.fn();
    render(<FeedbackDialog onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: /Close feedback/ }));
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
