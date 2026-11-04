import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DiffViewer } from '../DiffViewer';
import { resetSettingsStoreForTests, updateSettings } from '../../../settings/settingsStore';
import { lineDraftKey, readDraft, writeDraft } from '../../../utils/commentDrafts';
import type { CommentThread } from '../../../types';
import type { CreateThreadInput } from '../../../services/comments/CommentStore';

const filename = 'docs/readme.md';
const patch = [
  '@@ -10,6 +20,7 @@',
  ' # Heading',
  ' ',
  '-old paragraph',
  '-old continuation',
  '+new paragraph',
  '+new continuation',
  '+extra line',
  ' ',
  ' last paragraph',
].join('\n');
const createThread = vi.fn<(input: Omit<CreateThreadInput, 'prKey' | 'author'>) => Promise<void>>();
const ctx = {
  prKey: 'o/r#1',
  selectedFile: filename,
  viewMode: 'inline',
  toIndex: 2,
  comparison: {
    headSha: 'head123',
    files: [{ filename, status: 'modified', additions: 3, deletions: 2, changes: 5, patch }],
  },
  commentBackendLabel: 'GitHub',
  currentUser: { login: 'alice' },
  actions: { createThread, setViewMode: vi.fn(), consumeLineFocus: vi.fn(), setThreadClosed: vi.fn() },
};
let threads: CommentThread[] = [];

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ctx,
  useFileThreads: () => threads,
}));

vi.mock('../../../services/githubService', () => ({
  GitHubService: { getFileContent: vi.fn().mockResolvedValue(undefined) },
}));

beforeEach(() => {
  resetSettingsStoreForTests();
  updateSettings({ markdownPreview: true, defaultFullFile: false, syntaxHighlight: false });
  createThread.mockReset();
  createThread.mockResolvedValue(undefined);
  threads = [];
  ctx.selectedFile = filename;
  ctx.viewMode = 'inline';
});

describe('comments in the real Markdown preview', () => {
  it.each([
    { side: 'left', startLine: 12, line: 13, lineText: 'old paragraph\nold continuation' },
    { side: 'right', startLine: 22, line: 24, lineText: 'new paragraph\nnew continuation\nextra line' },
  ] as const)('posts the $side block with its exact source range without leaving Preview', async ({
    side, startLine, line, lineText,
  }) => {
    const { container, rerender } = render(<DiffViewer />);
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `Comment on ${side} lines ${startLine}-${line}` }));
    expect(screen.getByRole('textbox').closest('.mdpreview__composer')?.previousElementSibling)
      .toHaveClass('mdpreview__block--changed');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review this paragraph' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(createThread).toHaveBeenCalledWith({
      filename, side, startLine, line, lineText, body: 'Review this paragraph',
      iterationIndex: 2, commitSha: 'head123',
    }));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(container.querySelector('.mdpreview')).toBeTruthy();
    expect(container.querySelector('[data-diff-row]')).toBeNull();
    threads = [{
      id: 'posted', prKey: ctx.prKey, filename, side, startLine, line,
      status: 'active', createdAt: '', updatedAt: '',
      comments: [{ id: '1', author: { login: 'alice' }, body: 'Review this paragraph', createdAt: '' }],
    }];
    rerender(<DiffViewer />);
    expect(screen.getByText('Review this paragraph')).toBeTruthy();
  });

  it('comments on an unchanged heading as one line, without inventing a range', async () => {
    render(<DiffViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on right line 20' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Heading feedback' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(createThread).toHaveBeenCalledTimes(1));
    expect(createThread.mock.calls[0][0]).toMatchObject({ side: 'right', line: 20, lineText: '# Heading' });
    expect(createThread.mock.calls[0][0]).not.toHaveProperty('startLine');
  });

  it.each(['left', 'right'] as const)('only offers %s anchors in a single-side preview', (side) => {
    updateSettings({ diffSide: side });
    render(<DiffViewer />);
    expect(screen.getByRole('button', { name: `Comment on ${side} line ${side === 'left' ? 10 : 20}` }))
      .toBeTruthy();
    expect(screen.queryByRole('button', { name: new RegExp(`Comment on ${side === 'left' ? 'right' : 'left'}`) }))
      .toBeNull();
  });

  it('keeps the draft and range after an error and seeds suggestions from Markdown source', async () => {
    createThread.mockRejectedValueOnce(new Error('Comment failed'));
    render(<DiffViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on right lines 22-24' }));
    fireEvent.click(screen.getByTitle('Code suggestion'));
    expect(screen.getByRole('textbox')).toHaveValue(
      '```suggestion\nnew paragraph\nnew continuation\nextra line\n```\n',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Comment failed'));
    expect(readDraft(lineDraftKey(ctx.prKey, filename, 'right', 24, 22))).toContain('new paragraph');
    expect(screen.getByText(/Comment on right lines 22-24/)).toBeTruthy();
  });

  it.each(['inline', 'split'])('preserves the draft through %s Source and Preview switches and reloads', (mode) => {
    ctx.viewMode = mode;
    const first = render(<DiffViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on right lines 22-24' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Markdown view: Preview' }));
    expect(screen.getByRole('textbox')).toHaveValue('Keep my draft');
    expect(screen.getByRole('textbox').closest('tr')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Markdown view: Source' }));
    expect(screen.getByRole('textbox')).toHaveValue('Keep my draft');
    first.unmount();
    render(<DiffViewer />);
    expect(screen.getByRole('textbox')).toHaveValue('Keep my draft');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(readDraft(lineDraftKey(ctx.prKey, filename, 'right', 24, 22))).toBe('');
  });

  it('keeps a source-only blank-line draft accessible instead of hiding it in Preview', () => {
    writeDraft(lineDraftKey(ctx.prKey, filename, 'right', 21), 'Blank line draft');
    render(<DiffViewer />);
    expect(screen.getByRole('textbox')).toHaveValue('Blank line draft');
    expect(screen.getByText("This draft's source lines are not shown in the preview.")).toBeTruthy();
  });

  it('keeps a draft accessible when its side is hidden', () => {
    updateSettings({ diffSide: 'left' });
    writeDraft(lineDraftKey(ctx.prKey, filename, 'right', 24, 22), 'Hidden side draft');
    render(<DiffViewer />);
    expect(screen.getByRole('textbox')).toHaveValue('Hidden side draft');
    expect(screen.getByText("This draft's source lines are not shown in the preview.")).toBeTruthy();
  });

  it('does not move the composer to another block while a comment is sending', async () => {
    let complete!: () => void;
    createThread.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
    render(<DiffViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on right lines 22-24' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Posting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Comment on right line 20' }));
    expect(screen.getByRole('alert')).toHaveTextContent('finish sending');
    expect(screen.getByText(/Comment on right lines 22-24\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    complete();
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(createThread).toHaveBeenCalledTimes(1);
  });

  it('does not carry a preview composer into another file', () => {
    const { rerender } = render(<DiffViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on right lines 22-24' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'File draft' } });
    ctx.selectedFile = 'other.md';
    rerender(<DiffViewer />);
    expect(screen.queryByRole('textbox')).toBeNull();
    ctx.selectedFile = filename;
    rerender(<DiffViewer />);
    expect(screen.getByRole('textbox')).toHaveValue('File draft');
  });
});
