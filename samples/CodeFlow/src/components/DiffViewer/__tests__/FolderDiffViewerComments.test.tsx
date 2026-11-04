import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FolderDiffViewer } from '../FolderDiffViewer';
import type { CommentThread, FileChange } from '../../../types';
import { selectCode } from '../../../test/selectCode';

// Renders the real InlineDiff/SplitDiff so the gutter "+" button is exercised.

const createThread = vi.fn(async () => {});

const mockCtx: {
  comparison: { files: FileChange[]; headSha?: string } | null;
  selectedFolder: string | null;
  viewMode: 'inline' | 'split';
  threads: CommentThread[];
  toIndex: number;
  commentBackendLabel: string;
  actions: Record<string, unknown>;
} = {
  comparison: null,
  selectedFolder: null,
  viewMode: 'inline',
  threads: [],
  toIndex: 2,
  commentBackendLabel: 'GitHub',
  actions: { selectFile: vi.fn(), createThread, addComment: vi.fn(), setThreadStatus: vi.fn(), setThreadClosed: vi.fn(), deleteThread: vi.fn() },
};

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => mockCtx,
  useFileThreads: (filename: string | undefined) =>
    filename ? mockCtx.threads.filter((t) => t.filename === filename) : [],
}));

function file(overrides: Partial<FileChange> & Pick<FileChange, 'filename'>): FileChange {
  return {
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: '@@ -1,1 +1,2 @@\n context\n+added line',
    ...overrides,
  };
}

function thread(overrides: Partial<CommentThread> & Pick<CommentThread, 'filename'>): CommentThread {
  const now = '2024-01-01T00:00:00Z';
  return {
    id: 't1',
    prKey: 'o/r#1',
    side: 'right',
    line: 2,
    status: 'active',
    comments: [{ id: 'c1', author: { login: 'alice' }, body: 'existing note', createdAt: now }],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('FolderDiffViewer commenting', () => {
  beforeEach(() => {
    document.getSelection()?.removeAllRanges();
    createThread.mockClear();
    mockCtx.threads = [];
    mockCtx.viewMode = 'inline';
    mockCtx.comparison = { files: [file({ filename: 'src/deploy/Alpha.tsx' })], headSha: 'sha123' };
    mockCtx.selectedFolder = 'src/deploy';
  });

  it('renders a clickable add-comment button on each commentable line', () => {
    const { container } = render(<FolderDiffViewer />);
    const buttons = container.querySelectorAll('.diff__addcomment');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('opens the composer and creates a thread anchored to the folder file', async () => {
    const { container } = render(<FolderDiffViewer />);

    const addButtons = container.querySelectorAll('.diff__addcomment');
    // Last line of the patch is the added line (new line number 2).
    fireEvent.click(addButtons[addButtons.length - 1]);

    const textarea = await screen.findByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'looks wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(createThread).toHaveBeenCalledTimes(1));
    expect(createThread).toHaveBeenCalledWith({
      filename: 'src/deploy/Alpha.tsx',
      side: 'right',
      line: 2,
      body: 'looks wrong',
      iterationIndex: 2,
      commitSha: 'sha123',
      lineText: 'added line',
    });
  });

  it('renders existing threads for the file inline in the folder view', () => {
    mockCtx.threads = [thread({ filename: 'src/deploy/Alpha.tsx' })];
    render(<FolderDiffViewer />);
    expect(screen.getByText('existing note')).toBeTruthy();
  });

  it('does not render threads belonging to a different file', () => {
    mockCtx.threads = [thread({ filename: 'src/deploy/Other.tsx' })];
    render(<FolderDiffViewer />);
    expect(screen.queryByText('existing note')).toBeNull();
  });

  it('supports commenting in split view too', () => {
    mockCtx.viewMode = 'split';
    const { container } = render(<FolderDiffViewer />);
    expect(container.querySelectorAll('.diff__addcomment').length).toBeGreaterThan(0);
  });

  it.each(['inline', 'split'] as const)('supports range comments within a folder in %s mode', async (mode) => {
    mockCtx.viewMode = mode;
    const { container } = render(<FolderDiffViewer />);
    selectCode(container, 'right', 1, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on right line 2' }));
    expect(screen.getByRole('textbox').closest('tr')?.previousElementSibling
      ?.querySelector('[data-comment-right="1"]')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'the whole block' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(createThread).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'src/deploy/Alpha.tsx', startLine: 1, line: 2, side: 'right',
      lineText: 'context\nadded line', body: 'the whole block',
    })));
  });

  it.each(['inline', 'split'] as const)('does not reuse a highlight from another folder file in %s mode', (mode) => {
    mockCtx.viewMode = mode;
    mockCtx.comparison = { files: [
      file({ filename: 'src/deploy/Alpha.tsx' }), file({ filename: 'src/deploy/Beta.tsx' }),
    ] };
    const { container } = render(<FolderDiffViewer />);
    const files = container.querySelectorAll('.folder-file');
    selectCode(files[0], 'right', 1, 2);
    const otherPlus = files[1].querySelector('[aria-label="Comment on right line 2"]');
    expect(otherPlus).not.toBeNull();
    fireEvent.click(otherPlus!);
    expect(screen.getByText(/Comment on right line 2/)).toBeTruthy();
  });
});
