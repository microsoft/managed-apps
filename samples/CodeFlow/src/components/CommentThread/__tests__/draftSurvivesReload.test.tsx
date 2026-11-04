import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommentThreadView, NewCommentComposer } from '../CommentThread';
import type { CommentThread } from '../../../types';
import { appStorage } from '../../../storage';

/**
 * The auto-refresh case: a background poll spots a new commit, the app reloads
 * the pull request, and `App` swaps the whole review tree out while it does.
 * Every composer is unmounted mid-sentence. These tests reproduce that by
 * unmounting and re-rendering, and assert the text comes back.
 */

const addComment = vi.fn(async () => {});
const editComment = vi.fn(async () => {});

const mockCtx = {
  pr: null,
  prKey: 'o/r#1',
  commentBackendLabel: 'GitHub',
  currentUser: { login: 'alice' },
  actions: {
    addComment,
    editComment,
    setThreadStatus: vi.fn(async () => {}),
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

function type(placeholder: string, text: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value: text, selectionStart: text.length },
  });
}

const valueOf = (placeholder: string) =>
  (screen.getByPlaceholderText(placeholder) as HTMLTextAreaElement).value;

beforeEach(() => {
  addComment.mockClear();
  addComment.mockResolvedValue(undefined);
  editComment.mockClear();
  editComment.mockResolvedValue(undefined);
});

describe('a reply in progress', () => {
  it('is still there after the refresh takes the thread down and puts it back', () => {
    const view = render(<CommentThreadView thread={thread()} />);
    type('Reply…', 'most of a reply');
    view.unmount();

    render(<CommentThreadView thread={thread()} />);
    expect(valueOf('Reply…')).toBe('most of a reply');
  });

  it('does not follow the reviewer onto a different thread', () => {
    const view = render(<CommentThreadView thread={thread()} />);
    type('Reply…', 'about thread one');
    view.unmount();

    render(<CommentThreadView thread={thread({ id: 't2' })} />);
    expect(valueOf('Reply…')).toBe('');
  });

  it('is gone once the reply has actually been posted', async () => {
    const view = render(<CommentThreadView thread={thread()} />);
    type('Reply…', 'ship it');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(addComment).toHaveBeenCalledWith('t1', 'ship it'));
    view.unmount();

    render(<CommentThreadView thread={thread()} />);
    expect(valueOf('Reply…')).toBe('');
  });

  it('survives a refresh that lands while a failed reply is on screen', async () => {
    addComment.mockRejectedValueOnce(new Error('offline'));
    const view = render(<CommentThreadView thread={thread()} />);
    type('Reply…', 'worth keeping');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    view.unmount();

    render(<CommentThreadView thread={thread()} />);
    expect(valueOf('Reply…')).toBe('worth keeping');
  });
});

describe('an edit in progress', () => {
  const openEditor = () => fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

  it('comes back to the edited text, not the original comment', () => {
    const view = render(<CommentThreadView thread={thread()} />);
    openEditor();
    type('Edit your comment…', 'please fix, with detail');
    view.unmount();

    render(<CommentThreadView thread={thread()} />);
    openEditor();
    expect(valueOf('Edit your comment…')).toBe('please fix, with detail');
  });

  it('is discarded when the reviewer cancels out of it', () => {
    const view = render(<CommentThreadView thread={thread()} />);
    openEditor();
    type('Edit your comment…', 'never mind');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    view.unmount();

    render(<CommentThreadView thread={thread()} />);
    openEditor();
    expect(valueOf('Edit your comment…')).toBe('please fix');
  });

  it('is discarded once the edit has been saved', async () => {
    const view = render(<CommentThreadView thread={thread()} />);
    openEditor();
    type('Edit your comment…', 'fixed, thanks');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(editComment).toHaveBeenCalledWith('t1', 'c1', 'fixed, thanks'));
    view.unmount();

    render(<CommentThreadView thread={thread()} />);
    openEditor();
    expect(valueOf('Edit your comment…')).toBe('please fix');
  });
});

describe('a new thread in progress', () => {
  const draftKey = 'codeflow:draft:o/r#1|line|right|12|src/app.ts';

  it('is restored into the composer it was typed in', () => {
    const view = render(
      <NewCommentComposer draftKey={draftKey} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    type('Start a comment thread…', 'this needs a test');
    view.unmount();

    render(<NewCommentComposer draftKey={draftKey} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(valueOf('Start a comment thread…')).toBe('this needs a test');
  });

  it('is dropped when the composer is cancelled', () => {
    const view = render(
      <NewCommentComposer draftKey={draftKey} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    type('Start a comment thread…', 'on reflection, no');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    view.unmount();

    render(<NewCommentComposer draftKey={draftKey} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(valueOf('Start a comment thread…')).toBe('');
  });

  it('stays in memory when there is nowhere to save it', () => {
    // No pull request in context yet, so no key — the composer must still work.
    render(<NewCommentComposer onSubmit={vi.fn()} onCancel={vi.fn()} />);
    type('Start a comment thread…', 'unsaved but usable');
    expect(valueOf('Start a comment thread…')).toBe('unsaved but usable');
    expect(appStorage().drafts.keys()).toHaveLength(0);
  });
});
