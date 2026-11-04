import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CommentThreadView, NewCommentComposer } from '../CommentThread';
import { absoluteTime } from '../../../utils/format';
import type { CommentThread } from '../../../types';

const addComment = vi.fn(async () => {});
const setThreadStatus = vi.fn(async () => {});
const editComment = vi.fn(async () => {});
const deleteComment = vi.fn(async () => {});

const mockCtx: {
  pr: null;
  commentBackendLabel: string;
  currentUser?: { login: string };
  actions: Record<string, unknown>;
} = {
  pr: null,
  commentBackendLabel: 'GitHub',
  currentUser: { login: 'alice' },
  actions: {
    addComment,
    setThreadStatus,
    editComment,
    deleteComment,
    setThreadClosed: vi.fn(),
    deleteThread: vi.fn(),
  },
};

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => mockCtx,
}));

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  const now = '2024-01-01T00:00:00Z';
  return {
    id: 't1',
    prKey: 'o/r#1',
    filename: 'src/app.ts',
    side: 'right',
    line: 12,
    status: 'active',
    comments: [
      { id: 'c1', author: { login: 'alice' }, body: 'please fix', createdAt: now, nodeId: 'PRRC_1' },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function typeReply(text: string) {
  const box = screen.getByPlaceholderText('Reply…') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text, selectionStart: text.length } });
  return box;
}

describe('CommentThreadView reply actions', () => {
  beforeEach(() => {
    addComment.mockClear();
    setThreadStatus.mockClear();
  });

  it('replies without resolving', async () => {
    render(<CommentThreadView thread={thread()} />);
    typeReply('done');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));

    await waitFor(() => expect(addComment).toHaveBeenCalledWith('t1', 'done'));
    expect(setThreadStatus).not.toHaveBeenCalled();
  });

  it('replies and resolves the thread', async () => {
    render(<CommentThreadView thread={thread()} />);
    typeReply('fixed it');
    fireEvent.click(screen.getByRole('button', { name: /Reply & Resolve/ }));

    await waitFor(() => expect(addComment).toHaveBeenCalledWith('t1', 'fixed it'));
    await waitFor(() => expect(setThreadStatus).toHaveBeenCalledWith('t1', 'resolved'));
  });

  it('does not resolve when the reply fails', async () => {
    addComment.mockRejectedValueOnce(new Error('nope'));
    render(<CommentThreadView thread={thread()} />);
    typeReply('fixed it');
    fireEvent.click(screen.getByRole('button', { name: /Reply & Resolve/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('nope');
    expect(setThreadStatus).not.toHaveBeenCalled();
  });

  it('hides Reply & Resolve on an already resolved thread', () => {
    render(<CommentThreadView thread={thread({ status: 'resolved' })} />);
    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reply & Resolve/ })).toBeNull();
  });

  it('resolves on Ctrl+Shift+Enter and only replies on Ctrl+Enter', async () => {
    render(<CommentThreadView thread={thread()} />);
    const box = typeReply('shortcut');

    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
    expect(setThreadStatus).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: 'shortcut 2', selectionStart: 10 } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(setThreadStatus).toHaveBeenCalledWith('t1', 'resolved'));
  });
});

describe('CommentThreadView status picker', () => {
  beforeEach(() => {
    setThreadStatus.mockClear();
    setThreadStatus.mockResolvedValue(undefined);
  });

  it('asks for the status the reviewer picked', async () => {
    render(<CommentThreadView thread={thread({ status: 'resolved' })} />);
    fireEvent.change(screen.getByLabelText('Thread status'), { target: { value: 'active' } });
    await waitFor(() => expect(setThreadStatus).toHaveBeenCalledWith('t1', 'active'));
  });

  /**
   * A revert with nothing said is indistinguishable from the app undoing the
   * change by itself, which is how the re-resolving thread was first reported.
   */
  it('says why the status snapped back when the change is refused', async () => {
    setThreadStatus.mockRejectedValueOnce(new Error('Failed to unresolve_review_thread'));
    render(<CommentThreadView thread={thread({ status: 'resolved' })} />);
    fireEvent.change(screen.getByLabelText('Thread status'), { target: { value: 'active' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to unresolve_review_thread',
    );
  });
});

describe('CommentThreadView reply draft', () => {
  beforeEach(() => {
    addComment.mockClear();
    addComment.mockResolvedValue(undefined);
  });

  const replyBox = () => screen.getByPlaceholderText('Reply…') as HTMLTextAreaElement;

  it('empties the box the moment the reply is sent, not when it lands', async () => {
    // The thread shows an optimistic copy of the reply straight away, so a
    // draft still holding the same text renders it twice until GitHub answers.
    let land!: () => void;
    addComment.mockImplementationOnce(
      () => new Promise<void>((resolve) => { land = () => resolve(); }),
    );
    render(<CommentThreadView thread={thread()} />);
    typeReply('done');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));

    await waitFor(() => expect(addComment).toHaveBeenCalledWith('t1', 'done'));
    expect(replyBox().value).toBe('');

    await act(async () => { land(); });
    expect(replyBox().value).toBe('');
  });

  it('puts the text back when the reply is refused', async () => {
    addComment.mockRejectedValueOnce(new Error('nope'));
    render(<CommentThreadView thread={thread()} />);
    typeReply('done');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('nope');
    expect(replyBox().value).toBe('done');
  });

  it('keeps a newly typed draft rather than restoring the failed one', async () => {
    let fail!: () => void;
    addComment.mockImplementationOnce(
      () => new Promise<void>((_, reject) => { fail = () => reject(new Error('nope')); }),
    );
    render(<CommentThreadView thread={thread()} />);
    typeReply('first');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(addComment).toHaveBeenCalled());

    typeReply('second thoughts');
    await act(async () => { fail(); });

    expect(replyBox().value).toBe('second thoughts');
  });
});

describe('CommentThreadView collapse affordance', () => {
  it('calls onCollapse when the header is clicked', () => {
    const onCollapse = vi.fn();
    const { container } = render(
      <CommentThreadView thread={thread({ isIssueComment: true })} onCollapse={onCollapse} />,
    );
    fireEvent.click(container.querySelector('.thread__head')!);
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('collapses on Enter and Space from the keyboard', () => {
    const onCollapse = vi.fn();
    const { container } = render(<CommentThreadView thread={thread()} onCollapse={onCollapse} />);
    const head = container.querySelector('.thread__head')!;
    fireEvent.keyDown(head, { key: 'Enter' });
    fireEvent.keyDown(head, { key: ' ' });
    expect(onCollapse).toHaveBeenCalledTimes(2);
  });

  it('shows the chevron only when the thread can actually be collapsed', () => {
    const withHandler = render(<CommentThreadView thread={thread()} onCollapse={() => {}} />);
    expect(withHandler.container.querySelector('.thread__chevron')).not.toBeNull();
    expect(withHandler.container.querySelector('.thread__head')!.getAttribute('role')).toBe('button');
    withHandler.unmount();

    const withoutHandler = render(<CommentThreadView thread={thread()} />);
    expect(withoutHandler.container.querySelector('.thread__chevron')).toBeNull();
    expect(withoutHandler.container.querySelector('.thread__head')!.getAttribute('role')).toBeNull();
  });
});

describe('CommentThreadView status dropdown', () => {
  it('shows Active in the dropdown on an open active thread', () => {
    render(<CommentThreadView thread={thread()} />);
    const select = screen.getByRole('combobox', { name: 'Thread status' }) as HTMLSelectElement;
    expect(select.value).toBe('active');
    expect(select).not.toBeDisabled();
  });

  it('shows Closed in the status dropdown when the thread is closed', () => {
    render(<CommentThreadView thread={thread({ closed: true })} />);
    const select = screen.getByRole('combobox', { name: 'Thread status' }) as HTMLSelectElement;
    expect(select.value).toBe('closed');
    expect(select).toBeDisabled();
  });

  it('shows Closed even when the underlying GitHub status is resolved', () => {
    render(<CommentThreadView thread={thread({ status: 'resolved', closed: true })} />);
    const select = screen.getByRole('combobox', { name: 'Thread status' }) as HTMLSelectElement;
    expect(select.value).toBe('closed');
    expect(select).toBeDisabled();
  });
});

describe('CommentThreadView status badge', () => {
  it('shows the GitHub status on an open thread', () => {
    const { container } = render(<CommentThreadView thread={thread()} />);
    const badges = container.querySelectorAll('.thread__status');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('Active');
  });

  it('shows only Closed — never "Active Closed" — on a closed thread', () => {
    const { container } = render(<CommentThreadView thread={thread({ closed: true })} />);
    const badges = container.querySelectorAll('.thread__status');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('Closed');
    expect(container.querySelector('.thread__head')!.textContent).not.toContain('Active Closed');
  });

  it('shows only Closed on a closed description (issue) comment thread', () => {
    const { container } = render(
      <CommentThreadView thread={thread({ isIssueComment: true, closed: true })} />,
    );
    const badges = container.querySelectorAll('.thread__status');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('Closed');
    expect(badges[0].getAttribute('title')).toContain('GitHub status: Active');
  });

  it('collapses a resolved + closed thread to a single Closed badge', () => {
    const { container } = render(
      <CommentThreadView thread={thread({ status: 'resolved', closed: true })} />,
    );
    const badges = container.querySelectorAll('.thread__status');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('Closed');
  });
});

describe('CommentThreadView editing your own comment', () => {
  beforeEach(() => {
    editComment.mockClear();
    editComment.mockResolvedValue(undefined);
    mockCtx.currentUser = { login: 'alice' };
  });

  it('offers Edit on your own comment', () => {
    render(<CommentThreadView thread={thread()} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('does not offer Edit on somebody else’s comment', () => {
    // GitHub refuses an edit by anyone but the author, so the button would only
    // ever produce a permission error.
    mockCtx.currentUser = { login: 'bob' };
    render(<CommentThreadView thread={thread()} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('does not offer Edit when nobody is signed in', () => {
    mockCtx.currentUser = undefined;
    render(<CommentThreadView thread={thread()} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('saves the edited text and closes the editor', async () => {
    render(<CommentThreadView thread={thread()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const box = screen.getByPlaceholderText('Edit your comment…') as HTMLTextAreaElement;
    // The draft starts populated, which is the point — an edit is a revision.
    expect(box.value).toBe('please fix');
    fireEvent.change(box, { target: { value: 'fixed, thanks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(editComment).toHaveBeenCalledWith('t1', 'c1', 'fixed, thanks'));
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Edit your comment…')).toBeNull(),
    );
  });

  it('keeps the editor open with the draft when the save is refused', async () => {
    // Losing what the author just typed is worse than the failed save.
    editComment.mockRejectedValueOnce(new Error('not the author'));
    render(<CommentThreadView thread={thread()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const box = screen.getByPlaceholderText('Edit your comment…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'fixed, thanks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('not the author');
    expect(
      (screen.getByPlaceholderText('Edit your comment…') as HTMLTextAreaElement).value,
    ).toBe('fixed, thanks');
  });

  it('discards the draft on Cancel', () => {
    render(<CommentThreadView thread={thread()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByPlaceholderText('Edit your comment…'), {
      target: { value: 'never mind' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByPlaceholderText('Edit your comment…')).toBeNull();
    expect(editComment).not.toHaveBeenCalled();
  });

  it('does not spend a round trip when nothing changed', async () => {
    // An unchanged save would still burn a version in GitHub's edit history.
    render(<CommentThreadView thread={thread()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByPlaceholderText('Edit your comment…')).toBeNull());
    expect(editComment).not.toHaveBeenCalled();
  });
});

describe('CommentThreadView deleting your own comment', () => {
  beforeEach(() => {
    deleteComment.mockReset();
    deleteComment.mockResolvedValue(undefined);
    addComment.mockClear();
    mockCtx.currentUser = { login: 'alice' };
    mockCtx.commentBackendLabel = 'GitHub';
  });

  it.each([false, true])('confirms before deleting a saved comment (PR-level: %s)', async (isIssueComment) => {
    render(<CommentThreadView thread={thread({ isIssueComment })} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteComment).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Confirm comment deletion' })).toHaveTextContent(
      'Delete this comment from GitHub? This cannot be undone. Replies are kept.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }));
    await waitFor(() => expect(deleteComment).toHaveBeenCalledExactlyOnceWith('t1', 'c1'));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Confirm comment deletion' })).toBeNull());
  });

  it('cancels without deleting or losing the reply draft', () => {
    render(<CommentThreadView thread={thread()} />);
    typeReply('unsent reply');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }));
    expect(deleteComment).not.toHaveBeenCalled();
    expect(screen.getByText('please fix')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Reply…')).toHaveValue('unsent reply');
  });

  it('shows a failure with the comment and draft intact, and allows a retry', async () => {
    deleteComment.mockRejectedValueOnce(new Error('permission denied'));
    render(<CommentThreadView thread={thread()} />);
    typeReply('unsent reply');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
    expect(screen.getByText('please fix')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Reply…')).toHaveValue('unsent reply');
    expect(screen.getByRole('button', { name: 'Delete comment' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }));
    await waitFor(() => expect(deleteComment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('disables duplicate deletion, edits and keyboard replies while deleting', async () => {
    let finish!: () => void;
    deleteComment.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    render(<CommentThreadView thread={thread()} />);
    const box = typeReply('unsent');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }));
    expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel deletion' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(addComment).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(deleteComment).toHaveBeenCalledTimes(1);
  });

  it('targets an authored reply rather than deleting its conversation', async () => {
    const root = thread().comments[0];
    render(<CommentThreadView thread={thread({
      comments: [
        { ...root, author: { login: 'bob' } },
        { ...root, id: 'reply', nodeId: 'PRRC_reply', body: 'my reply' },
      ],
    })} />);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }));
    await waitFor(() => expect(deleteComment).toHaveBeenCalledWith('t1', 'reply'));
  });

  it('does not offer deletion on another author, a pending comment or an unaddressable comment', () => {
    const root = thread().comments[0];
    render(<CommentThreadView thread={thread({
      comments: [
        { ...root, author: { login: 'bob' } },
        { ...root, id: 'pending-123' },
        { ...root, id: 'no-node', nodeId: undefined },
      ],
    })} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('does not offer deletion while signed out or editing', () => {
    mockCtx.currentUser = undefined;
    const { rerender } = render(<CommentThreadView thread={thread()} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    mockCtx.currentUser = { login: 'alice' };
    rerender(<CommentThreadView thread={thread()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('also offers individual local-comment deletion without promising a GitHub write', () => {
    mockCtx.commentBackendLabel = 'Local (this device)';
    render(<CommentThreadView thread={thread({
      comments: [{ ...thread().comments[0], local: true, nodeId: undefined }],
    })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('group', { name: 'Confirm comment deletion' })).not.toHaveTextContent('from GitHub');
  });

  it('does not strand the thread if a refresh removes the comment being confirmed', () => {
    const root = thread().comments[0];
    const reply = { ...root, id: 'reply', body: 'kept reply' };
    const { rerender } = render(<CommentThreadView thread={thread({ comments: [root, reply] })} />);
    typeReply('draft');
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    rerender(<CommentThreadView thread={thread({ comments: [reply] })} />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled();
  });
});

describe('NewCommentComposer draft', () => {
  const composerBox = () =>
    screen.getByPlaceholderText('Start a comment thread…') as HTMLTextAreaElement;

  function type(text: string) {
    fireEvent.change(composerBox(), { target: { value: text, selectionStart: text.length } });
  }

  it('empties the box as the comment is sent, not when it lands', async () => {
    // The new thread is rendered optimistically directly above this composer,
    // so holding the draft until the write returns showed the comment twice.
    let land!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { land = () => resolve(); }));
    render(<NewCommentComposer onSubmit={onSubmit} onCancel={() => {}} />);
    type('looks wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('looks wrong'));
    expect(composerBox().value).toBe('');
    // …and the button says so, so an empty box doesn't read as a lost draft.
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();

    await act(async () => { land(); });
    expect(composerBox().value).toBe('');
  });

  it('puts the text back when the comment is refused', async () => {
    const onSubmit = vi.fn(async () => { throw new Error('outside the diff'); });
    render(<NewCommentComposer onSubmit={onSubmit} onCancel={() => {}} />);
    type('looks wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('outside the diff');
    expect(composerBox().value).toBe('looks wrong');
  });
});

describe('CommentThreadView comment timestamp', () => {
  it('reveals the full datetime when you hover the relative time', () => {
    // "2h ago" is unhelpful when you need to know which day it was.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { container } = render(
      <CommentThreadView
        thread={thread({
          comments: [
            {
              id: 'c1',
              author: { login: 'alice' },
              body: 'please fix',
              createdAt: twoHoursAgo,
            },
          ],
        })}
      />,
    );

    const time = container.querySelector('.comment__time');
    expect(time?.textContent).toBe('2h ago');
    expect(time?.getAttribute('title')).toBe(absoluteTime(twoHoursAgo));
    expect(time?.getAttribute('title')).toContain(String(new Date(twoHoursAgo).getFullYear()));
  });
});
