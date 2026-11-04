import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueThread } from '../IssueThread';
import type { FeedbackComment, IssueViewer } from '../../../types';

const { listComments, createComment, saveComment } = vi.hoisted(() => ({
  listComments: vi.fn(),
  createComment: vi.fn(),
  saveComment: vi.fn(),
}));

vi.mock('../../../services/issues/commentStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/issues/commentStore')>()),
  listComments,
  createComment,
  saveComment,
}));

const ME: IssueViewer = { id: 'gh:1', login: 'ada', name: 'Ada Lovelace' };

const comment = (over: Partial<FeedbackComment> & { id: string }): FeedbackComment => ({
  issueId: 'i1',
  body: 'Looks good',
  kind: 'comment',
  authorId: 'gh:1',
  authorLogin: 'ada',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  listComments.mockResolvedValue([]);
  createComment.mockImplementation(async (_issueId: string, draft: { body: string }) =>
    comment({ id: 'new', body: draft.body }),
  );
  saveComment.mockImplementation(async (existing: FeedbackComment, draft: { body: string }) => ({
    ...existing,
    body: draft.body,
    updatedAt: '2026-02-02T00:00:00Z',
  }));
});

const renderThread = (viewer: IssueViewer | undefined = ME) =>
  render(<IssueThread issueId="i1" viewer={viewer} />);

/** Explicit, because a default parameter would swallow a deliberate `undefined`. */
const renderSignedOut = () => render(<IssueThread issueId="i1" viewer={undefined} />);

describe('IssueThread', () => {
  it('loads the thread for its issue', async () => {
    renderThread();
    await waitFor(() => expect(listComments).toHaveBeenCalledWith('i1'));
  });

  it('says so when there is nothing yet', async () => {
    renderThread();
    expect(await screen.findByText('No comments yet.')).toBeTruthy();
  });

  it('renders each comment with its author', async () => {
    listComments.mockResolvedValue([
      comment({ id: 'c1', body: 'First' }),
      comment({ id: 'c2', body: 'Second', authorId: 'gh:2', authorLogin: 'grace' }),
    ]);
    renderThread();
    expect(await screen.findByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
    expect(screen.getByText('grace')).toBeTruthy();
  });

  it('flags a parked question so it is obvious something needs an answer', async () => {
    listComments.mockResolvedValue([comment({ id: 'q1', kind: 'question', body: 'Which panel?' })]);
    renderThread();
    expect(await screen.findByText('Needs an answer')).toBeTruthy();
  });

  it('marks an automated status note', async () => {
    listComments.mockResolvedValue([comment({ id: 's1', kind: 'status', body: 'Shipped in 1.0' })]);
    renderThread();
    expect(await screen.findByText('Status')).toBeTruthy();
  });

  it('leaves an ordinary reply undecorated', async () => {
    listComments.mockResolvedValue([comment({ id: 'c1' })]);
    renderThread();
    await screen.findByText('Looks good');
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByText('Needs an answer')).toBeNull();
  });

  it('shows an edited marker once the comment has changed', async () => {
    listComments.mockResolvedValue([comment({ id: 'c1', updatedAt: '2026-02-02T00:00:00Z' })]);
    renderThread();
    expect(await screen.findByText(/edited/)).toBeTruthy();
  });

  it('posts a plain comment — the automation kinds are not the human composer’s to set', async () => {
    renderThread();
    await screen.findByText('No comments yet.');
    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'me too' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() =>
      expect(createComment).toHaveBeenCalledWith('i1', { body: 'me too', kind: 'comment' }, ME),
    );
  });

  it('clears the composer and shows the new comment', async () => {
    renderThread();
    await screen.findByText('No comments yet.');
    const box = screen.getByLabelText('Add a comment') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'me too' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(await screen.findByText('me too')).toBeTruthy();
    expect(box.value).toBe('');
  });

  it('will not post an empty comment', async () => {
    renderThread();
    await screen.findByText('No comments yet.');
    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('still lets an unidentified viewer comment, attributed locally', async () => {
    renderSignedOut();
    await screen.findByText('No comments yet.');
    expect(screen.getByLabelText('Add a comment')).toBeTruthy();
  });

  it('offers Edit on every comment, since storage decides who may write', async () => {
    listComments.mockResolvedValue([
      comment({ id: 'c1', body: 'Mine' }),
      comment({ id: 'c2', body: 'Theirs', authorId: 'gh:2', authorLogin: 'grace' }),
    ]);
    renderThread();
    await screen.findByText('Mine');
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
  });

  it('saves an edit and returns to reading the thread', async () => {
    listComments.mockResolvedValue([comment({ id: 'c1', body: 'Mine' })]);
    renderThread();
    await screen.findByText('Mine');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Edit comment'), { target: { value: 'Mine, revised' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Mine, revised')).toBeTruthy();
    expect(screen.queryByLabelText('Edit comment')).toBeNull();
  });

  it('keeps the comment kind when editing, so a question stays a question', async () => {
    listComments.mockResolvedValue([comment({ id: 'q1', kind: 'question', body: 'Which panel?' })]);
    renderThread();
    await screen.findByText('Which panel?');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Edit comment'), { target: { value: 'Which pane?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saveComment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'q1' }),
        { body: 'Which pane?', kind: 'question' },
      ),
    );
  });

  it('abandons an edit on Cancel', async () => {
    listComments.mockResolvedValue([comment({ id: 'c1', body: 'Mine' })]);
    renderThread();
    await screen.findByText('Mine');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Edit comment'), { target: { value: 'oops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Mine')).toBeTruthy();
    expect(saveComment).not.toHaveBeenCalled();
  });

  it('surfaces a load failure instead of pretending the thread is empty', async () => {
    listComments.mockRejectedValue(new Error('gateway is down'));
    renderThread();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'gateway is down');
  });

  it('keeps the draft when posting fails, so nothing is lost', async () => {
    createComment.mockRejectedValue(new Error('gateway is down'));
    renderThread();
    await screen.findByText('No comments yet.');
    const box = screen.getByLabelText('Add a comment') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'me too' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(box.value).toBe('me too');
  });

  /**
   * The PR review thread owns the `thread`/`thread__*` namespace in App.css, and
   * its rules are declared later in the file. Reusing a single one of those class
   * names here silently wraps every issue comment in a second bordered card with
   * an accent rail — the crowding this component has been re-patched for twice.
   */
  it('stays out of the PR review thread CSS namespace', async () => {
    listComments.mockResolvedValue([comment({ id: 'c1', kind: 'question', body: 'Mine' })]);
    const { container } = renderThread();
    await screen.findByText('Mine');

    const leaked = [...container.querySelectorAll<HTMLElement>('*')]
      .flatMap((el) => [...el.classList])
      .filter((name) => name === 'thread' || name.startsWith('thread__') || name.startsWith('thread--'));

    expect(leaked).toEqual([]);
  });
});
