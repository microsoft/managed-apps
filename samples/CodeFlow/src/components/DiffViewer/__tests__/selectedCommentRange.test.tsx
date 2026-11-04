import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InlineDiff } from '../InlineDiff';
import { SplitDiff } from '../SplitDiff';
import { parsePatch } from '../../../utils/diffParser';
import { selectCode } from '../../../test/selectCode';

const diff = parsePatch('@@ -1,4 +1,4 @@\n alpha\n \n gamma\n delta');
const props = { diff, extrasRow: () => null, threadBadges: () => null };
beforeEach(() => document.getSelection()?.removeAllRanges());

describe.each([InlineDiff, SplitDiff])('selected code endpoints', (Body) => {
  it('handles highlighted syntax tokens and blank lines without counting gutter text', () => {
    const onStartComment = vi.fn();
    const { container } = render(<Body {...props} onStartComment={onStartComment}
      renderContent={(_column, _key, text) => <span><mark>{text || '\u00a0'}</mark></span>} />);
    selectCode(container, 'right', 1, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on right line 2' }));
    expect(onStartComment).toHaveBeenCalledWith({ side: 'right', startLine: 1, line: 3 });
  });

  it('excludes the final line when the highlight ends at its column zero', () => {
    const onStartComment = vi.fn();
    const { container } = render(<Body {...props} onStartComment={onStartComment} />);
    const selection = selectCode(container, 'right', 1, 3);
    const last = container.querySelector('[data-comment-right="3"]')!.firstChild!;
    const range = selection.getRangeAt(0);
    range.setEnd(last, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on right line 2' }));
    expect(onStartComment).toHaveBeenCalledWith({ side: 'right', startLine: 1, line: 2 });
  });

  it('keeps a partial selection within one line a single-line comment', () => {
    const onStartComment = vi.fn();
    const { container } = render(<Body {...props} onStartComment={onStartComment} />);
    const range = selectCode(container, 'right', 1, 1).getRangeAt(0);
    range.setStart(range.startContainer, 1);
    range.setEnd(range.endContainer, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on right line 1' }));
    expect(onStartComment).toHaveBeenCalledWith({ side: 'right', line: 1 });
  });

  it('ignores unrelated highlighted text outside code', () => {
    const onStartComment = vi.fn();
    render(<><p data-testid="elsewhere">unrelated text</p><Body {...props} onStartComment={onStartComment} /></>);
    const text = screen.getByTestId('elsewhere').firstChild!;
    document.getSelection()?.setBaseAndExtent(text, 0, text, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on right line 3' }));
    expect(onStartComment).toHaveBeenCalledWith({ side: 'right', line: 3 });
  });
});

it('does not combine opposite split panes into a range', () => {
  const onStartComment = vi.fn();
  const { container } = render(<SplitDiff {...props} onStartComment={onStartComment} />);
  const left = container.querySelector('[data-comment-left="1"]')!.firstChild!;
  const right = container.querySelector('[data-comment-right="3"]')!.firstChild!;
  document.getSelection()?.setBaseAndExtent(left, 0, right, 3);
  fireEvent.click(screen.getByRole('button', { name: 'Comment on right line 2' }));
  expect(onStartComment).toHaveBeenCalledWith({ side: 'right', line: 2 });
});

it.each(['left', 'right'] as const)('uses the clicked %s side of an inline selection spanning deletions and additions', (side) => {
  const onStartComment = vi.fn();
  const mixed = parsePatch('@@ -1,3 +1,3 @@\n-old first\n-old second\n+new first\n+new second\n context');
  const { container } = render(<InlineDiff {...props} diff={mixed} onStartComment={onStartComment} />);
  const start = container.querySelector('[data-comment-left="1"]')!.firstChild!;
  const end = container.querySelector('[data-comment-right="2"]')!.firstChild!;
  document.getSelection()?.setBaseAndExtent(start, 0, end, end.textContent!.length);
  fireEvent.click(screen.getByRole('button', { name: `Comment on ${side} line 2` }));
  expect(onStartComment).toHaveBeenCalledWith({ side, startLine: 1, line: 2 });
});
