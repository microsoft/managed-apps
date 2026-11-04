import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrphanedThreads } from '../OrphanedThreads';
import type { CommentThread } from '../../../types';

// CommentThreadView pulls from the CodeFlow context; stub it so we can test
// OrphanedThreads' controlled collapse behaviour in isolation.
vi.mock('../../CommentThread/CommentThread', () => ({
  CommentThreadView: ({
    thread,
    onCollapse,
  }: {
    thread: CommentThread;
    onCollapse?: () => void;
  }) => (
    <div data-thread-id={thread.id} data-testid={`expanded-${thread.id}`}>
      <button type="button" onClick={onCollapse}>
        collapse-{thread.id}
      </button>
    </div>
  ),
}));

function makeThread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 't1',
    prKey: 'owner/repo#1',
    filename: 'src/app.ts',
    side: 'right' as const,
    line: 10,
    status: 'active',
    comments: [
      { id: 'c1', body: 'outdated note', author: { login: 'alice' }, createdAt: '2026-01-01T00:00:00Z' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('OrphanedThreads', () => {
  it('renders a collapsed header with count and preview when not expanded', () => {
    const thread = makeThread();
    render(
      <OrphanedThreads
        threads={[thread]}
        expandedThreads={new Set()}
        onExpand={() => {}}
        onCollapse={() => {}}
      />,
    );
    const btn = screen.getByTitle('Expand thread');
    expect(btn.getAttribute('data-thread-id')).toBe('t1');
    expect(btn.textContent).toContain('outdated note');
    expect(btn.textContent).toContain('1');
    // Not expanded => no CommentThreadView
    expect(screen.queryByTestId('expanded-t1')).toBeNull();
  });

  it('calls onExpand when the collapsed header is clicked', () => {
    const onExpand = vi.fn();
    render(
      <OrphanedThreads
        threads={[makeThread()]}
        expandedThreads={new Set()}
        onExpand={onExpand}
        onCollapse={() => {}}
      />,
    );
    screen.getByTitle('Expand thread').click();
    expect(onExpand).toHaveBeenCalledWith('t1');
  });

  it('renders the full thread and wires collapse when expanded', () => {
    const onCollapse = vi.fn();
    render(
      <OrphanedThreads
        threads={[makeThread()]}
        expandedThreads={new Set(['t1'])}
        onExpand={() => {}}
        onCollapse={onCollapse}
      />,
    );
    expect(screen.getByTestId('expanded-t1')).toBeTruthy();
    screen.getByText('collapse-t1').click();
    expect(onCollapse).toHaveBeenCalledWith('t1');
  });

  it('shows the outdated count in the header', () => {
    render(
      <OrphanedThreads
        threads={[makeThread({ id: 'a' }), makeThread({ id: 'b' })]}
        expandedThreads={new Set()}
        onExpand={() => {}}
        onCollapse={() => {}}
      />,
    );
    expect(screen.getByText(/Outdated comments \(2\)/)).toBeTruthy();
  });

  it('labels a closed thread as Closed in the collapsed pill', () => {
    render(
      <OrphanedThreads
        threads={[makeThread({ closed: true })]}
        expandedThreads={new Set()}
        onExpand={() => {}}
        onCollapse={() => {}}
      />,
    );
    expect(screen.getByText('Closed')).toBeTruthy();
  });

  it('lets a caller that is not showing outdated threads say so', () => {
    render(
      <OrphanedThreads
        threads={[makeThread()]}
        expandedThreads={new Set()}
        onExpand={() => {}}
        onCollapse={() => {}}
        icon="💬"
        heading="Comments (1) — switch to Source to see them in place"
      />,
    );
    expect(screen.getByText(/switch to Source/)).toBeTruthy();
    expect(screen.queryByText(/Outdated comments/)).toBeNull();
    expect(screen.queryByText('⚠️')).toBeNull();
  });
});
