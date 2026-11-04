import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InlineDiff } from '../InlineDiff';
import { SplitDiff } from '../SplitDiff';
import { useFileComments } from '../useFileComments';
import { parsePatch } from '../../../utils/diffParser';
import { lineDraftKey, readDraft, writeDraft } from '../../../utils/commentDrafts';
import type { CommentThread, DiffSide } from '../../../types';
import type { DiffSideMode } from '../../../utils/diffSide';
import type { CreateThreadInput } from '../../../services/comments/CommentStore';
import { selectCode } from '../../../test/selectCode';

const createThread = vi.fn<(input: Omit<CreateThreadInput, 'prKey' | 'author'>) => Promise<void>>(async () => {});
const ctx = {
  prKey: 'o/r#1', toIndex: 2, comparison: { headSha: 'head123' },
  commentBackendLabel: 'GitHub', currentUser: { login: 'alice' },
  actions: { createThread, setThreadClosed: vi.fn() },
};
let threads: CommentThread[] = [];
vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ctx,
  useFileThreads: () => threads,
}));

const diff = parsePatch('@@ -1,4 +1,5 @@\n first\n-old\n+new\n+extra\n last\n end');
const sparse = parsePatch('@@ -1 +1 @@\n first\n@@ -10 +10 @@\n tenth');
const filename = 'src/a.ts';

function Viewer({ mode = 'inline', file = filename, model = diff, sideMode = 'both' }: {
  mode?: 'inline' | 'split'; file?: string; model?: typeof diff; sideMode?: DiffSideMode;
}) {
  const comments = useFileComments(file, model);
  const Body = mode === 'inline' ? InlineDiff : SplitDiff;
  return <Body diff={model} onStartComment={comments.startComment} commentRange={comments.composer}
    extrasRow={comments.extrasRow} threadBadges={comments.threadBadges} sideMode={sideMode} />;
}

function clickPlus(side: DiffSide, line: number) {
  const button = screen.getByRole('button', { name: `Comment on ${side} line ${line}` });
  const before = document.getSelection()?.toString();
  // Preventing mousedown's default is what keeps browser focus from replacing the selection.
  expect(fireEvent.mouseDown(button)).toBe(false);
  expect(document.getSelection()?.toString()).toBe(before);
  fireEvent.mouseUp(button);
  fireEvent.click(button);
}

function expectAtLine(element: Element, side: DiffSide, line: number) {
  const row = element.closest('tr')?.previousElementSibling;
  expect(row?.querySelector(`[data-comment-${side}="${line}"]`)).toBeTruthy();
}

beforeEach(() => {
  document.getSelection()?.removeAllRanges();
  createThread.mockReset();
  createThread.mockResolvedValue(undefined);
  threads = [];
  ctx.prKey = 'o/r#1';
});

describe.each(['inline', 'split'] as const)('%s highlight-first comments', (mode) => {
  describe.each(['left', 'right'] as const)('%s side', (side) => {
    it.each([1, 2, 3])('uses the full highlighted range after one + click on selected line %s', async (clicked) => {
      const { container, rerender } = render(<Viewer mode={mode} />);
      selectCode(container, side, 1, 3);
      expect(screen.queryByRole('textbox')).toBeNull();
      clickPlus(side, clicked);
      expectAtLine(screen.getByRole('textbox'), side, 1);
      expect(screen.getByText(new RegExp(`Comment on ${side} lines 1-3`))).toBeTruthy();
      expect(container.querySelectorAll('.diff__line--comment-range')).toHaveLength(3);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'review this block' } });
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
      await waitFor(() => expect(createThread).toHaveBeenCalledWith({
        filename, side, startLine: 1, line: 3, body: 'review this block',
        commitSha: 'head123', iterationIndex: 2,
        lineText: side === 'left' ? 'first\nold\nlast' : 'first\nnew\nextra',
      }));
      await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
      threads = [{
        id: 'posted', prKey: ctx.prKey, filename, side, startLine: 1, line: 3,
        status: 'active', createdAt: '', updatedAt: '',
        comments: [{ id: '1', author: { login: 'alice' }, body: 'posted range', createdAt: '' }],
      }];
      rerender(<Viewer mode={mode} />);
      expect(screen.getAllByText('posted range')).toHaveLength(1);
      expectAtLine(screen.getByText('posted range'), side, 1);
      expect(screen.getByText('a.ts:1-3')).toBeTruthy();
    });

    it('accepts a backwards highlight and restores its draft at the top line', () => {
      const first = render(<Viewer mode={mode} />);
      selectCode(first.container, side, 1, 3, true);
      clickPlus(side, 2);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'keep this draft' } });
      const key = lineDraftKey(ctx.prKey, filename, side, 3, 1);
      expect(readDraft(key)).toBe('keep this draft');
      first.unmount();
      render(<Viewer mode={mode} />);
      expect(screen.getByRole('textbox')).toHaveValue('keep this draft');
      expectAtLine(screen.getByRole('textbox'), side, 1);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(readDraft(key)).toBe('');
    });

    it('selects and comments in single-side mode', () => {
      const { container } = render(<Viewer mode={mode} sideMode={side} />);
      expect(screen.queryByRole('button', {
        name: `Comment on ${side === 'left' ? 'right' : 'left'} line 1`,
      })).toBeNull();
      selectCode(container, side, 1, 3);
      clickPlus(side, 3);
      expectAtLine(screen.getByRole('textbox'), side, 1);
    });
  });

  it('preserves ordinary single-line comments without a selection', async () => {
    render(<Viewer mode={mode} />);
    clickPlus('right', 2);
    expectAtLine(screen.getByRole('textbox'), 'right', 2);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'one line' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(createThread).toHaveBeenCalledTimes(1));
    expect(createThread.mock.calls[0][0]).toMatchObject({ side: 'right', line: 2 });
    expect(createThread.mock.calls[0][0]).not.toHaveProperty('startLine');
  });

  it('ignores a selection when + is not beside one of its lines', () => {
    const { container } = render(<Viewer mode={mode} />);
    selectCode(container, 'right', 1, 3);
    clickPlus('right', 4);
    expect(screen.getByText(/Comment on right line 4/)).toBeTruthy();
    expectAtLine(screen.getByRole('textbox'), 'right', 4);
  });

  it('keeps both endpoints and the draft at the top after a failed submission', async () => {
    createThread.mockRejectedValueOnce(new Error('GitHub rejected the range'));
    const { container } = render(<Viewer mode={mode} />);
    selectCode(container, 'right', 1, 3);
    clickPlus('right', 3);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'retry this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('GitHub rejected the range'));
    expect(screen.getByRole('textbox')).toHaveValue('retry this');
    expect(readDraft(lineDraftKey(ctx.prKey, filename, 'right', 3, 1))).toBe('retry this');
    expectAtLine(screen.getByRole('textbox'), 'right', 1);
  });

  it('seeds a suggestion with all highlighted source lines', () => {
    const { container } = render(<Viewer mode={mode} />);
    selectCode(container, 'left', 1, 3);
    clickPlus('left', 2);
    fireEvent.click(screen.getByTitle('Code suggestion'));
    expect(screen.getByRole('textbox')).toHaveValue('```suggestion\nfirst\nold\nlast\n```\n');
  });

  it('places a collapsed range badge at the first line', () => {
    threads = [{
      id: 'posted', prKey: ctx.prKey, filename, side: 'left', startLine: 1, line: 3,
      status: 'resolved', createdAt: '', updatedAt: '',
      comments: [{ id: '1', author: { login: 'alice' }, body: 'saved', createdAt: '' }],
    }];
    const { container } = render(<Viewer mode={mode} />);
    const badge = container.querySelector('.diff__badges');
    expect(badge).not.toBeNull();
    expect(badge?.closest('tr')?.querySelector('[data-comment-left="1"]')).toBeTruthy();
  });
});

it('blocks submission across hidden lines rather than silently commenting on unseen code', async () => {
  const { container } = render(<Viewer model={sparse} />);
  selectCode(container, 'right', 1, 10);
  clickPlus('right', 10);
  expect(screen.getByRole('alert')).toHaveTextContent('continuous range of visible lines');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'block' } });
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  await waitFor(() => expect(screen.getAllByRole('alert').some((alert) =>
    alert.textContent?.includes('Show the full file before commenting'))).toBe(true));
  expect(createThread).not.toHaveBeenCalled();
});

it('reopens a highlighted range draft without overwriting another single-line draft', () => {
  const rangeKey = lineDraftKey(ctx.prKey, filename, 'right', 3, 1);
  const singleKey = lineDraftKey(ctx.prKey, filename, 'right', 4);
  writeDraft(singleKey, 'single draft');
  writeDraft(rangeKey, 'range draft');
  const { container } = render(<Viewer />);
  selectCode(container, 'right', 1, 3);
  clickPlus('right', 2);
  expect(screen.getByRole('textbox')).toHaveValue('range draft');
  expect(readDraft(singleKey)).toBe('single draft');
});

it('resets range selection when the PR changes even if the filename stays the same', () => {
  const { container, rerender } = render(<Viewer />);
  selectCode(container, 'right', 1, 3);
  clickPlus('right', 2);
  ctx.prKey = 'o/r#2';
  rerender(<Viewer />);
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('cannot change the target while a range comment is sending', async () => {
  let complete!: () => void;
  createThread.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
  const { container } = render(<Viewer />);
  selectCode(container, 'right', 1, 3);
  clickPlus('right', 3);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'posting' } });
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  clickPlus('right', 4);
  expect(screen.getByRole('alert')).toHaveTextContent('finish sending');
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expectAtLine(screen.getByRole('textbox'), 'right', 1);
  complete();
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(createThread).toHaveBeenCalledTimes(1);
});
