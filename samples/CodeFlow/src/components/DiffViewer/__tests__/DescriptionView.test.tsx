import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DescriptionView } from '../DescriptionView';
import type { CommentThread } from '../../../types';

// The real thread view pulls in the markdown editor and the CodeFlow context;
// stub it so this test focuses on DescriptionView's collapse wiring. The
// collapsed pill (CollapsedThread) is deliberately left un-mocked.
vi.mock('../../CommentThread/CommentThread', () => ({
  CommentThreadView: ({
    thread,
    onCollapse,
  }: {
    thread: CommentThread;
    onCollapse?: () => void;
  }) => (
    <div data-testid={`expanded-${thread.id}`}>
      <button type="button" disabled={!onCollapse} onClick={onCollapse}>
        head-{thread.id}
      </button>
    </div>
  ),
  NewCommentComposer: () => <div data-testid="composer" />,
}));

const ctx = {
  pr: { title: 'Some PR', body: 'body text', coordinates: { owner: 'o', name: 'r', number: 1 } },
  comparison: { files: [{ filename: 'src/app.ts' }] },
  threads: [] as CommentThread[],
  actions: { addIssueComment: vi.fn(async () => {}) },
};

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ctx,
}));

function makeThread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 't1',
    prKey: 'o/r#1',
    filename: '',
    side: 'right',
    line: 0,
    status: 'active',
    isIssueComment: true,
    comments: [
      { id: 'c1', body: 'top level note', author: { login: 'alice' }, createdAt: '2026-01-01T00:00:00Z' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('DescriptionView body', () => {
  beforeEach(() => {
    ctx.threads = [];
  });

  it('renders the description as markdown rather than plain text', () => {
    ctx.pr.body = '## Heading\n\nSome **bold** text and a [link](https://example.com).';
    const { container } = render(<DescriptionView />);

    const body = container.querySelector('.description__text.markdown-body');
    expect(body).toBeTruthy();
    expect(container.querySelector('pre.description__text')).toBeNull();
    expect(body?.querySelector('h2')?.textContent).toBe('Heading');
    expect(body?.querySelector('strong')?.textContent).toBe('bold');
    expect(body?.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('renders GitHub-flavored markdown such as task lists', () => {
    ctx.pr.body = '- [x] done\n- [ ] todo';
    const { container } = render(<DescriptionView />);

    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it('shows the empty state when there is no description', () => {
    ctx.pr.body = '';
    render(<DescriptionView />);

    expect(screen.getByText('No description provided.')).toBeTruthy();
  });
});

describe('DescriptionView conversations', () => {
  beforeEach(() => {
    ctx.pr.body = 'body text';
  });

  it('renders description threads expanded by default', () => {
    ctx.threads = [makeThread()];
    render(<DescriptionView />);
    expect(screen.getByTestId('expanded-t1')).toBeTruthy();
    expect(screen.queryByTitle('Expand thread')).toBeNull();
  });

  it('wires up a collapse handler on the thread header', () => {
    ctx.threads = [makeThread()];
    render(<DescriptionView />);
    expect((screen.getByText('head-t1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('collapses a description thread to a summary pill and expands it again', () => {
    ctx.threads = [makeThread()];
    render(<DescriptionView />);

    fireEvent.click(screen.getByText('head-t1'));

    expect(screen.queryByTestId('expanded-t1')).toBeNull();
    const pill = screen.getByTitle('Expand thread');
    expect(pill.getAttribute('data-thread-id')).toBe('t1');
    expect(pill.textContent).toContain('top level note');
    expect(pill.textContent).toContain('Active');

    fireEvent.click(pill);

    expect(screen.getByTestId('expanded-t1')).toBeTruthy();
    expect(screen.queryByTitle('Expand thread')).toBeNull();
  });

  it('collapses each conversation independently', () => {
    ctx.threads = [makeThread(), makeThread({ id: 't2' })];
    render(<DescriptionView />);

    fireEvent.click(screen.getByText('head-t1'));

    expect(screen.queryByTestId('expanded-t1')).toBeNull();
    expect(screen.getByTestId('expanded-t2')).toBeTruthy();
    expect(screen.getAllByTitle('Expand thread')).toHaveLength(1);
  });
});
