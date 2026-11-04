import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MarkdownPreview } from '../MarkdownPreview';
import type { MarkdownPreviewBlock } from '../../../utils/markdownPreview';
import { buildMarkdownPreview } from '../../../utils/markdownPreview';
import { parsePatch } from '../../../utils/diffParser';

afterEach(cleanup);

function block(over: Partial<MarkdownPreviewBlock> = {}): MarkdownPreviewBlock {
  return {
    key: 'b0',
    status: 'unchanged',
    newText: 'Hello',
    oldText: 'Hello',
    added: 0,
    removed: 0,
    newStart: 1,
    newEnd: 1,
    oldStart: 1,
    oldEnd: 1,
    ...over,
  };
}

describe('MarkdownPreview', () => {
  it('says so when there is nothing to render', () => {
    render(<MarkdownPreview blocks={[]} />);
    expect(screen.getByText('Nothing to preview in this file.')).toBeTruthy();
  });

  it('renders the Markdown rather than its source', () => {
    render(<MarkdownPreview blocks={[block({ newText: '# Title', oldText: '# Title' })]} />);
    // A heading, not a line of text starting with a hash.
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
    expect(screen.queryByText('# Title')).toBeNull();
  });

  it('names each block by state and line range', () => {
    render(
      <MarkdownPreview
        blocks={[
          block({
            status: 'changed',
            newStart: 12,
            newEnd: 18,
            newText: 'after',
            oldText: 'before',
            added: 2,
            removed: 1,
          }),
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Changed, lines 12\u201318' })).toBeTruthy();
  });

  it('falls back to the bare state when there is no range', () => {
    render(
      <MarkdownPreview
        blocks={[
          block({
            status: 'added',
            newStart: undefined,
            newEnd: undefined,
            oldStart: undefined,
            oldEnd: undefined,
            oldText: '',
          }),
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Added' })).toBeTruthy();
  });

  it('shows both halves of a rewrite, before over after', () => {
    const { container } = render(
      <MarkdownPreview
        blocks={[block({ status: 'changed', oldText: 'before', newText: 'after' })]}
      />,
    );
    expect(screen.getByText('before')).toBeTruthy();
    expect(screen.getByText('after')).toBeTruthy();
    const sides = container.querySelectorAll('.mdpreview__side');
    expect(sides.length).toBe(2);
    expect(sides[0].className).toContain('mdpreview__side--old');
    expect(sides[1].className).toContain('mdpreview__side--new');
  });

  it('shows only the new text for an addition', () => {
    const { container } = render(
      <MarkdownPreview blocks={[block({ status: 'added', oldText: '', newText: 'brand new' })]} />,
    );
    expect(screen.getByText('brand new')).toBeTruthy();
    expect(container.querySelectorAll('.mdpreview__side--old').length).toBe(0);
  });

  it('shows only the old text for a removal, quoted by its old line numbers', () => {
    const { container } = render(
      <MarkdownPreview
        blocks={[
          block({
            status: 'removed',
            oldText: 'gone',
            newText: '',
            oldStart: 4,
            oldEnd: 5,
            newStart: 9,
            newEnd: 9,
            removed: 2,
          }),
        ]}
      />,
    );
    expect(screen.getByText('gone')).toBeTruthy();
    expect(container.querySelectorAll('.mdpreview__side--new').length).toBe(0);
    expect(screen.getByRole('group', { name: 'Removed, lines 4\u20135' })).toBeTruthy();
  });

  it('does not repeat an unchanged block on both sides', () => {
    const { container } = render(<MarkdownPreview blocks={[block()]} />);
    expect(container.querySelectorAll('.mdpreview__side--old').length).toBe(0);
    expect(container.querySelectorAll('.mdpreview__side--new').length).toBe(1);
  });

  it('counts the lines that changed', () => {
    render(<MarkdownPreview blocks={[block({ status: 'changed', added: 3, removed: 2 })]} />);
    expect(screen.getByText('+3')).toBeTruthy();
    expect(screen.getByText('\u22122')).toBeTruthy();
  });

  it('omits a zero count rather than printing +0', () => {
    render(<MarkdownPreview blocks={[block({ status: 'added', added: 2, oldText: '' })]} />);
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.queryByText('\u22120')).toBeNull();
  });

  it('marks skipped content as a separator', () => {
    render(
      <MarkdownPreview
        blocks={[block({ key: 'g0', status: 'gap', label: '@@ -1,4 +1,6 @@', newText: '' })]}
      />,
    );
    const sep = screen.getByRole('separator', { name: 'Skipped content' });
    expect(sep.textContent).toContain('@@ -1,4 +1,6 @@');
  });

  it('carries the state in a class so the wash can follow it', () => {
    const { container } = render(<MarkdownPreview blocks={[block({ status: 'removed' })]} />);
    expect(container.querySelector('.mdpreview__block--removed')).toBeTruthy();
  });

  it.each([
    { name: 'addition', source: '+new\n+text', side: 'right', startLine: 20, line: 21 },
    { name: 'removal', source: '-old\n-text', side: 'left', startLine: 10, line: 11 },
    { name: 'list', source: ' - item\n   - nested', side: 'right', startLine: 20, line: 21 },
    { name: 'table', source: ' | A | B |\n | - | - |\n | a | b |', side: 'right', startLine: 20, line: 22 },
    { name: 'code fence', source: ' ```ts\n const a = 1;\n \n ```', side: 'right', startLine: 20, line: 23 },
  ])('anchors a rendered $name to its source range, including hidden Markdown syntax', ({
    source, side, startLine, line,
  }) => {
    const onStartComment = vi.fn();
    render(<MarkdownPreview blocks={buildMarkdownPreview(parsePatch(`@@ -10,4 +20,4 @@\n${source}`))}
      onStartComment={onStartComment} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onStartComment).toHaveBeenCalledWith({ side, startLine, line });
  });

  it('never offers a comment action on skipped content or a block with no source location', () => {
    render(<MarkdownPreview onStartComment={vi.fn()} blocks={[
      block({ key: 'gap', status: 'gap', label: 'Skipped' }),
      block({ key: 'missing', newStart: undefined, newEnd: undefined }),
    ]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a restored composer even when every source line is blank and has no preview block', () => {
    render(<MarkdownPreview blocks={[]} composer={{ side: 'right', line: 1 }}
      renderComposer={() => <textarea aria-label="Draft" />} />);
    expect(screen.getByText('Nothing to preview in this file.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBeTruthy();
    expect(screen.getByText("This draft's source lines are not shown in the preview.")).toBeTruthy();
  });
});
