import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThreadBadge } from '../ThreadBadge';
import type { CommentThread } from '../../../types';

function makeThread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 't1',
    prKey: 'owner/repo#1',
    filename: 'src/app.ts',
    side: 'right' as const,
    line: 10,
    status: 'active',
    comments: [
      {
        id: 'c1',
        body: 'looks good',
        author: { login: 'alice', name: 'Alice' },
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ThreadBadge', () => {
  it('renders active badge with bubble and count', () => {
    const thread = makeThread({ status: 'active' });
    render(<ThreadBadge thread={thread} onClick={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('💬');
    expect(btn.textContent).toContain('1');
    expect(btn.className).toContain('diff__thread-badge--active');
  });

  it('renders active badge with count for multiple comments', () => {
    const thread = makeThread({
      status: 'active',
      comments: [
        { id: 'c1', body: 'first', author: { login: 'a', name: 'A' }, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'c2', body: 'second', author: { login: 'b', name: 'B' }, createdAt: '2026-01-02T00:00:00Z' },
        { id: 'c3', body: 'third', author: { login: 'c', name: 'C' }, createdAt: '2026-01-03T00:00:00Z' },
      ],
    });
    render(<ThreadBadge thread={thread} onClick={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('3');
  });

  it('renders resolved badge with bubble and checkmark, no count', () => {
    const thread = makeThread({ status: 'resolved' });
    render(<ThreadBadge thread={thread} onClick={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('💬');
    expect(btn.textContent).toContain('✓');
    expect(btn.textContent).not.toMatch(/\d/);
    expect(btn.className).toContain('diff__thread-badge--resolved');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    const thread = makeThread();
    render(<ThreadBadge thread={thread} onClick={onClick} />);
    screen.getByRole('button').click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows thread body preview in title', () => {
    const thread = makeThread({ comments: [{ id: 'c1', body: 'fix this bug', author: { login: 'x', name: 'X' }, createdAt: '2026-01-01T00:00:00Z' }] });
    render(<ThreadBadge thread={thread} onClick={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.title).toContain('fix this bug');
  });
});
