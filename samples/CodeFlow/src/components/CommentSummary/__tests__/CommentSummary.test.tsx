import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CommentSummary } from '../CommentSummary';
import { absoluteTime } from '../../../utils/format';
import type { CommentThread } from '../../../types';

function makeThread(
  id: string,
  filename = 'src/app.ts',
  updatedAt = '2024-01-01T00:00:00Z',
  extra: Partial<CommentThread> = {},
): CommentThread {
  const now = '2024-01-01T00:00:00Z';
  return {
    id,
    prKey: 'owner/repo#1',
    filename,
    side: 'right',
    line: 1,
    status: 'active',
    comments: [{ id: `${id}-c1`, author: { login: 'alice' }, body: `comment-${id}`, createdAt: now }],
    createdAt: now,
    updatedAt,
    ...extra,
  } as CommentThread;
}

function makeCtx(threads: CommentThread[], focusedThreadId?: string) {
  return {
    prKey: 'owner/repo#1',
    threads,
    threadsLoading: false,
    focusRequest: focusedThreadId ? { threadId: focusedThreadId, seq: 1 } : undefined,
    actions: {
      focusThread: vi.fn(),
      setThreadClosed: vi.fn(),
    },
  };
}

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: vi.fn(),
}));

vi.mock('../../../settings/settingsStore', () => ({
  getSettings: () => ({ summaryFilters: { active: true, resolved: true, closed: true } }),
}));

import { useCodeFlow } from '../../../state/useCodeFlow';
const mockUseCodeFlow = vi.mocked(useCodeFlow);

describe('CommentSummary author filter', () => {
  function authored(
    id: string,
    login: string,
    extra: Partial<CommentThread> = {},
  ): CommentThread {
    return makeThread(id, 'src/app.ts', '2024-01-01T00:00:00Z', {
      comments: [{
        id: `${id}-c1`,
        author: { login, name: login === 'alice' ? 'Alice Ng' : undefined },
        body: `comment-${id}`,
        createdAt: '2024-01-01T00:00:00Z',
      }],
      ...extra,
    });
  }

  const mixed = () => [
    authored('alice', 'alice'),
    authored('bob', 'bob'),
    authored('bot', 'copilot[bot]'),
  ];
  const trigger = () => screen.getByRole('button', { name: /^Authors:/ });
  const picker = () => screen.getByRole('group', { name: 'Filter comments by author' });
  const option = (login: string) => within(picker()).getByRole('checkbox', {
    name: (name) => name.includes(`@${login}`),
  });
  const setContext = (threads: CommentThread[], prKey = 'owner/repo#1') => {
    const context = { ...makeCtx(threads), prKey };
    mockUseCodeFlow.mockReturnValue(context as unknown as ReturnType<typeof useCodeFlow>);
    return context;
  };

  it('starts with all authors selected and lets you exclude a bot without losing row actions', () => {
    const context = setContext(mixed());
    const { container } = render(<CommentSummary />);
    expect(container.querySelectorAll('.summary__row')).toHaveLength(3);
    expect(trigger()).toHaveTextContent('Authors: All');
    fireEvent.click(trigger());
    expect(within(picker()).getAllByRole('checkbox').every(
      (checkbox) => (checkbox as HTMLInputElement).checked,
    )).toBe(true);

    fireEvent.click(option('copilot[bot]'));
    expect(trigger()).toHaveTextContent('Authors: 2 of 3');
    expect(screen.queryByText('comment-bot')).not.toBeInTheDocument();
    expect(screen.getByText('comment-alice')).toBeInTheDocument();
    expect(screen.getByText('comment-bob')).toBeInTheDocument();
    expect(option('copilot[bot]')).not.toBeChecked();
    fireEvent.click(screen.getByText('comment-alice'));
    expect(context.actions.focusThread).toHaveBeenCalledWith('alice');
    const row = screen.getByText('comment-alice').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Close' }));
    expect(context.actions.setThreadClosed).toHaveBeenCalledWith('alice', true);
  });

  it('can clear all, select multiple authors, and restore all', () => {
    setContext(mixed());
    render(<CommentSummary />);
    fireEvent.click(trigger());
    fireEvent.click(within(picker()).getByRole('button', { name: 'Clear all' }));
    expect(trigger()).toHaveTextContent('Authors: 0 of 3');
    expect(screen.getByText('No comments match the current filters.')).toBeInTheDocument();

    fireEvent.click(option('alice'));
    fireEvent.click(option('bob'));
    expect(screen.getByText('comment-alice')).toBeInTheDocument();
    expect(screen.getByText('comment-bob')).toBeInTheDocument();
    expect(screen.queryByText('comment-bot')).not.toBeInTheDocument();

    fireEvent.click(within(picker()).getByRole('button', { name: 'Select all' }));
    expect(trigger()).toHaveTextContent('Authors: All');
    expect(screen.getByText('comment-bot')).toBeInTheDocument();
  });

  it('combines author selection with scope, status, search and sorting without removing picker options', () => {
    setContext([
      authored('alice-inline', 'alice'),
      authored('bob-inline', 'bob'),
      authored('alice-top', 'alice', { isIssueComment: true, filename: '' }),
      authored('alice-closed', 'alice', { closed: true }),
      authored('bot', 'copilot[bot]'),
    ]);
    const { container } = render(<CommentSummary />);
    fireEvent.click(trigger());
    fireEvent.click(option('copilot[bot]'));
    expect(container.querySelector('.summary__filter--active .summary__count')).toHaveTextContent('3');
    const scopes = screen.getByRole('group', { name: 'Filter comments by level' });
    expect(within(scopes).getByRole('button', { name: /^All/ })).toHaveTextContent('4');

    fireEvent.click(within(scopes).getByRole('button', { name: /^File-level/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^Closed/ }));
    fireEvent.change(screen.getByPlaceholderText('Search comments'), { target: { value: 'inline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Author' }));
    expect(Array.from(container.querySelectorAll('.summary__author')).map((cell) => cell.textContent))
      .toEqual(['Alice Ng', 'bob']);
    expect(container.querySelector('.summary__filter--active .summary__count')).toHaveTextContent('2');
    expect(within(picker()).getAllByRole('checkbox')).toHaveLength(3);
  });

  it('preserves exclusions across refreshes and includes newly arriving authors', () => {
    setContext(mixed());
    const { rerender } = render(<CommentSummary />);
    fireEvent.click(trigger());
    fireEvent.click(option('copilot[bot]'));

    setContext([]);
    rerender(<CommentSummary />);
    setContext([...mixed(), authored('carol', 'carol')]);
    rerender(<CommentSummary />);
    expect(option('copilot[bot]')).not.toBeChecked();
    expect(option('carol')).toBeChecked();
    expect(screen.queryByText('comment-bot')).not.toBeInTheDocument();
    expect(screen.getByText('comment-carol')).toBeInTheDocument();
    expect(trigger()).toHaveTextContent('Authors: 3 of 4');
  });

  it('resets author selection when switching pull requests', () => {
    setContext(mixed());
    const { rerender } = render(<CommentSummary />);
    fireEvent.click(trigger());
    fireEvent.click(option('copilot[bot]'));

    setContext(mixed().map((thread) => ({ ...thread, prKey: 'owner/repo#2' })), 'owner/repo#2');
    rerender(<CommentSummary />);
    expect(trigger()).toHaveTextContent('Authors: All');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('comment-bot')).toBeInTheDocument();
  });

  it('closes on Escape with focus restored, outside click, and keyboard focus leaving the picker', () => {
    setContext(mixed());
    render(<CommentSummary />);
    fireEvent.click(trigger());
    option('alice').focus();
    fireEvent.keyDown(option('alice'), { key: 'Escape' });
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveFocus();

    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByPlaceholderText('Search comments'));
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger());
    fireEvent.blur(option('alice'), { relatedTarget: screen.getByPlaceholderText('Search comments') });
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps an empty picker and comment loading state explicit', () => {
    const context = { ...makeCtx([]), threadsLoading: true };
    mockUseCodeFlow.mockReturnValue(context as unknown as ReturnType<typeof useCodeFlow>);
    render(<CommentSummary />);
    fireEvent.click(trigger());
    expect(screen.getByText('No authors yet.')).toBeInTheDocument();
    expect(screen.getByText(/Loading comments from GitHub/)).toBeInTheDocument();
  });

  it('clamps the picker to the viewport and keeps its position when selections reflow the toolbar', () => {
    setContext(mixed());
    render(<CommentSummary />);
    const button = trigger();
    button.getBoundingClientRect = () =>
      new DOMRect(window.innerWidth - 80, window.innerHeight - 80, 80, 25);
    fireEvent.click(button);
    expect(picker()).toHaveStyle({
      left: `${window.innerWidth - 294}px`,
      bottom: '84px',
      maxHeight: '280px',
    });

    button.getBoundingClientRect = () => new DOMRect(14, window.innerHeight - 40, 120, 25);
    fireEvent.click(option('copilot[bot]'));
    expect(picker()).toHaveStyle({ left: `${window.innerWidth - 294}px`, bottom: '84px' });

    fireEvent.keyDown(button, { key: 'Escape' });
    button.getBoundingClientRect = () => new DOMRect(14, 20, 120, 25);
    fireEvent.click(button);
    expect(picker()).toHaveStyle({ left: '14px', top: '49px', bottom: 'auto' });
    fireEvent(window, new Event('resize'));
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('CommentSummary row highlighting', () => {
  it('highlights only the focused thread, not other threads in the same file', () => {
    const threads = [
      makeThread('t1', 'src/app.ts', '2024-03-01T00:00:00Z'), // newest → first row
      makeThread('t2', 'src/app.ts', '2024-02-01T00:00:00Z'),
      makeThread('t3', 'src/other.ts', '2024-01-01T00:00:00Z'),
    ];
    mockUseCodeFlow.mockReturnValue(makeCtx(threads, 't1') as unknown as ReturnType<typeof useCodeFlow>);

    const { container } = render(<CommentSummary />);
    const rows = container.querySelectorAll('tr.summary__row');
    const currentRows = container.querySelectorAll('tr.summary__row--current');

    expect(rows.length).toBe(3);
    // Exactly one row is highlighted
    expect(currentRows.length).toBe(1);
    // The highlighted row contains t1's unique preview body
    expect(currentRows[0].textContent).toContain('comment-t1');
    // t2 (same file) and t3 (different file) are NOT highlighted
    const notCurrent = Array.from(rows).filter((r) => !r.classList.contains('summary__row--current'));
    expect(notCurrent.length).toBe(2);
  });

  it('does not highlight any row when no thread is focused', () => {
    const threads = [makeThread('t1'), makeThread('t2')];
    mockUseCodeFlow.mockReturnValue(makeCtx(threads) as unknown as ReturnType<typeof useCodeFlow>);

    const { container } = render(<CommentSummary />);
    const currentRows = container.querySelectorAll('tr.summary__row--current');
    expect(currentRows.length).toBe(0);
  });
});

describe('CommentSummary updated column', () => {
  it('reveals the full datetime when you hover the relative time', () => {
    const threads = [makeThread('t1', 'src/app.ts', '2024-03-01T09:15:00Z')];
    mockUseCodeFlow.mockReturnValue(makeCtx(threads) as unknown as ReturnType<typeof useCodeFlow>);

    const { container } = render(<CommentSummary />);
    const cell = container.querySelector('td.summary__updated');
    expect(cell?.getAttribute('title')).toBe(absoluteTime('2024-03-01T09:15:00Z'));
  });
});

describe('CommentSummary level filter', () => {
  const mixed = () => [
    makeThread('pr1', '', '2024-03-01T00:00:00Z', { isIssueComment: true }),
    makeThread('inline1', 'src/app.ts', '2024-02-01T00:00:00Z'),
    makeThread('inline2', 'src/other.ts', '2024-01-01T00:00:00Z'),
  ];

  const scopeButton = (label: string) =>
    within(screen.getByRole('group', { name: 'Filter comments by level' })).getByRole(
      'button',
      { name: new RegExp(`^${label}`) },
    );

  it('shows every comment until you narrow it', () => {
    mockUseCodeFlow.mockReturnValue(makeCtx(mixed()) as unknown as ReturnType<typeof useCodeFlow>);

    const { container } = render(<CommentSummary />);
    expect(container.querySelectorAll('tr.summary__row').length).toBe(3);
    expect(scopeButton('All')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows only file-level comments — the ones that can block the merge', () => {
    mockUseCodeFlow.mockReturnValue(makeCtx(mixed()) as unknown as ReturnType<typeof useCodeFlow>);

    const { container } = render(<CommentSummary />);
    fireEvent.click(scopeButton('File-level'));

    const rows = container.querySelectorAll('tr.summary__row');
    expect(rows.length).toBe(2);
    expect(container.textContent).toContain('comment-inline1');
    expect(container.textContent).not.toContain('comment-pr1');
    expect(scopeButton('File-level')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows only top-level comments', () => {
    mockUseCodeFlow.mockReturnValue(makeCtx(mixed()) as unknown as ReturnType<typeof useCodeFlow>);

    const { container } = render(<CommentSummary />);
    fireEvent.click(scopeButton('Top-level'));

    expect(container.querySelectorAll('tr.summary__row').length).toBe(1);
    expect(container.textContent).toContain('comment-pr1');
    expect(container.textContent).not.toContain('comment-inline1');
  });

  it('labels each level with how many comments it holds', () => {
    mockUseCodeFlow.mockReturnValue(makeCtx(mixed()) as unknown as ReturnType<typeof useCodeFlow>);

    render(<CommentSummary />);
    expect(scopeButton('All').textContent).toContain('3');
    expect(scopeButton('Top-level').textContent).toContain('1');
    expect(scopeButton('File-level').textContent).toContain('2');
  });

  it('narrows the status counts to the chosen level', () => {
    const threads = [
      makeThread('pr1', '', '2024-03-01T00:00:00Z', { isIssueComment: true }),
      makeThread('inline1', 'src/app.ts', '2024-02-01T00:00:00Z'),
    ];
    mockUseCodeFlow.mockReturnValue(makeCtx(threads) as unknown as ReturnType<typeof useCodeFlow>);

    const { container } = render(<CommentSummary />);
    const activeCount = () =>
      container.querySelector('.summary__filter--active .summary__count')?.textContent;

    expect(activeCount()).toBe('2');
    fireEvent.click(scopeButton('Top-level'));
    expect(activeCount()).toBe('1');
  });

  it('explains that the level filter is why nothing is listed', () => {
    const threads = [makeThread('pr1', '', '2024-03-01T00:00:00Z', { isIssueComment: true })];
    mockUseCodeFlow.mockReturnValue(makeCtx(threads) as unknown as ReturnType<typeof useCodeFlow>);

    const { container } = render(<CommentSummary />);
    fireEvent.click(scopeButton('File-level'));

    expect(container.querySelector('.summary__empty')?.textContent).toContain(
      'No comments match the current filters',
    );
  });
});

describe('CommentSummary sorting', () => {
  const byThreeAuthors = () => [
    makeThread('t-carol', 'src/app.ts', '2024-03-01T00:00:00Z', {
      comments: [
        { id: 'c1', author: { login: 'carol' }, body: 'comment-t-carol', createdAt: '2024-01-01T00:00:00Z' },
      ],
    }),
    makeThread('t-alice', 'src/app.ts', '2024-02-01T00:00:00Z', {
      comments: [
        { id: 'c2', author: { login: 'alice', name: 'Alice Ng' }, body: 'comment-t-alice', createdAt: '2024-01-01T00:00:00Z' },
      ],
    }),
    makeThread('t-bob', 'src/app.ts', '2024-01-01T00:00:00Z', {
      comments: [
        { id: 'c3', author: { login: 'bob' }, body: 'comment-t-bob', createdAt: '2024-01-01T00:00:00Z' },
      ],
    }),
  ];

  const authors = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('td.summary__author')).map((c) => c.textContent);

  const header = (name: string) => screen.getByRole('button', { name });

  const scopeButton = (label: string) =>
    within(screen.getByRole('group', { name: 'Filter comments by level' })).getByRole('button', {
      name: new RegExp(`^${label}`),
    });

  it('lists newest activity first until you ask for something else', () => {
    mockUseCodeFlow.mockReturnValue(
      makeCtx(byThreeAuthors()) as unknown as ReturnType<typeof useCodeFlow>,
    );

    const { container } = render(<CommentSummary />);
    expect(authors(container)).toEqual(['carol', 'Alice Ng', 'bob']);
  });

  it('sorts the comments by author when you click the Author header', () => {
    mockUseCodeFlow.mockReturnValue(
      makeCtx(byThreeAuthors()) as unknown as ReturnType<typeof useCodeFlow>,
    );

    const { container } = render(<CommentSummary />);
    fireEvent.click(header('Author'));

    expect(authors(container)).toEqual(['Alice Ng', 'bob', 'carol']);
  });

  it('reverses the author order on a second click', () => {
    mockUseCodeFlow.mockReturnValue(
      makeCtx(byThreeAuthors()) as unknown as ReturnType<typeof useCodeFlow>,
    );

    const { container } = render(<CommentSummary />);
    fireEvent.click(header('Author'));
    fireEvent.click(header('Author'));

    expect(authors(container)).toEqual(['carol', 'bob', 'Alice Ng']);
  });

  it('announces which column the list is ordered by', () => {
    mockUseCodeFlow.mockReturnValue(
      makeCtx(byThreeAuthors()) as unknown as ReturnType<typeof useCodeFlow>,
    );

    render(<CommentSummary />);
    expect(screen.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    fireEvent.click(header('Author'));
    expect(screen.getByRole('columnheader', { name: 'Author' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(screen.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });

  it('keeps the chosen order while you narrow the list', () => {
    const threads = [
      ...byThreeAuthors(),
      makeThread('t-pr', '', '2024-04-01T00:00:00Z', {
        isIssueComment: true,
        comments: [
          { id: 'c4', author: { login: 'dave' }, body: 'comment-t-pr', createdAt: '2024-01-01T00:00:00Z' },
        ],
      }),
    ];
    mockUseCodeFlow.mockReturnValue(makeCtx(threads) as unknown as ReturnType<typeof useCodeFlow>);

    const { container } = render(<CommentSummary />);
    fireEvent.click(header('Author'));
    fireEvent.click(scopeButton('File-level'));

    expect(authors(container)).toEqual(['Alice Ng', 'bob', 'carol']);
  });
});
