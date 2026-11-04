import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommentThread, ParsedDiff } from '../../../types';
import { useFileComments } from '../useFileComments';

const mockCtx: { comparison: unknown; toIndex: number; threads: CommentThread[]; actions: unknown } = {
  comparison: { files: [{ filename: 'src/app.ts' }] },
  toIndex: 1,
  threads: [],
  actions: { createThread: vi.fn(), addComment: vi.fn(), setThreadStatus: vi.fn(), setThreadClosed: vi.fn(), deleteThread: vi.fn() },
};

// The real `useFileThreads` memoises on the threads array, so a re-render that
// changed nothing hands back the *same* array. Mocking that away as a bare
// filter would quietly make every downstream memo look broken here and fine in
// production — so the mock keeps the memo.
vi.mock('../../../state/useCodeFlow', async () => {
  const { useMemo } = await import('react');
  return {
    useCodeFlow: () => mockCtx,
    useFileThreads: (filename: string | undefined) => {
      // Read out of the mutable fixture first: the memo has to depend on the
      // array itself, exactly as the real hook depends on `threads` from
      // context.
      const all = mockCtx.threads;
      return useMemo(
        () => (filename ? all.filter((t) => t.filename === filename) : []),
        [all, filename],
      );
    },
  };
});

const emptyDiff: ParsedDiff = { hunks: [], isEmpty: true };

function thread(overrides: Partial<CommentThread> & Pick<CommentThread, 'id'>): CommentThread {
  const now = '2024-01-01T00:00:00Z';
  return {
    prKey: 'o/r#1',
    filename: 'src/app.ts',
    side: 'right',
    line: 10,
    status: 'active',
    comments: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Re-render with a fresh thread array, the way a poll refresh arrives. */
function poll(threads: CommentThread[], rerender: () => void) {
  act(() => {
    mockCtx.threads = threads.map((t) => ({ ...t }));
  });
  rerender();
}

function setup(threads: CommentThread[]) {
  mockCtx.threads = threads;
  return renderHook(() => useFileComments('src/app.ts', emptyDiff));
}

describe('useFileComments expand/collapse', () => {
  it('expands an active thread by default', () => {
    const { result } = setup([thread({ id: 't1' })]);
    expect(result.current.expandedThreads.has('t1')).toBe(true);
  });

  it('collapses a resolved thread by default', () => {
    const { result } = setup([thread({ id: 't1', status: 'resolved' })]);
    expect(result.current.expandedThreads.has('t1')).toBe(false);
  });

  it('collapses a closed thread by default', () => {
    const { result } = setup([thread({ id: 't1', closed: true })]);
    expect(result.current.expandedThreads.has('t1')).toBe(false);
  });

  it('collapses a thread that arrives already settled on a later poll', () => {
    const { result, rerender } = setup([thread({ id: 't1' })]);
    expect(result.current.expandedThreads.has('t1')).toBe(true);

    poll([thread({ id: 't1' }), thread({ id: 't2', status: 'resolved' })], rerender);

    expect(result.current.expandedThreads.has('t1')).toBe(true);
    expect(result.current.expandedThreads.has('t2')).toBe(false);
  });

  it('collapses a thread when it transitions to closed', () => {
    const { result, rerender } = setup([thread({ id: 't1' })]);
    expect(result.current.expandedThreads.has('t1')).toBe(true);

    poll([thread({ id: 't1', closed: true })], rerender);

    expect(result.current.expandedThreads.has('t1')).toBe(false);
  });

  it('keeps an explicitly expanded settled thread open across a poll', () => {
    const { result, rerender } = setup([thread({ id: 't1', closed: true })]);
    expect(result.current.expandedThreads.has('t1')).toBe(false);

    act(() => result.current.expandThread('t1'));
    expect(result.current.expandedThreads.has('t1')).toBe(true);

    // A poll that changes nothing must not undo the reviewer's choice.
    poll([thread({ id: 't1', closed: true })], rerender);
    expect(result.current.expandedThreads.has('t1')).toBe(true);
  });

  it('keeps an explicitly collapsed active thread closed across a poll', () => {
    const { result, rerender } = setup([thread({ id: 't1' })]);

    act(() => result.current.collapseThread('t1'));
    expect(result.current.expandedThreads.has('t1')).toBe(false);

    poll([thread({ id: 't1' })], rerender);
    expect(result.current.expandedThreads.has('t1')).toBe(false);
  });

  it('lets a collapse override a previous expand and vice versa', () => {
    const { result } = setup([thread({ id: 't1', closed: true })]);

    act(() => result.current.expandThread('t1'));
    expect(result.current.expandedThreads.has('t1')).toBe(true);

    act(() => result.current.collapseThread('t1'));
    expect(result.current.expandedThreads.has('t1')).toBe(false);

    act(() => result.current.expandThread('t1'));
    expect(result.current.expandedThreads.has('t1')).toBe(true);
  });

  it('respects an explicit expand when a thread is reopened and closed again', () => {
    // Deliberate: an explicit expand outranks the settled-collapses-by-default
    // rule until the reviewer collapses it themselves. The previous
    // transition-detecting implementation re-collapsed here.
    const { result, rerender } = setup([thread({ id: 't1', closed: true })]);
    act(() => result.current.expandThread('t1'));

    poll([thread({ id: 't1', closed: false })], rerender);
    expect(result.current.expandedThreads.has('t1')).toBe(true);

    poll([thread({ id: 't1', closed: true })], rerender);
    expect(result.current.expandedThreads.has('t1')).toBe(true);
  });

  it('tracks each thread independently', () => {
    const { result } = setup([
      thread({ id: 't1' }),
      thread({ id: 't2', status: 'resolved' }),
      thread({ id: 't3', closed: true }),
    ]);

    act(() => result.current.collapseThread('t1'));
    act(() => result.current.expandThread('t2'));

    expect(result.current.expandedThreads.has('t1')).toBe(false);
    expect(result.current.expandedThreads.has('t2')).toBe(true);
    expect(result.current.expandedThreads.has('t3')).toBe(false);
  });

  it('only reports ids present in the current thread list', () => {
    const { result, rerender } = setup([thread({ id: 't1' }), thread({ id: 't2' })]);
    expect(result.current.expandedThreads.size).toBe(2);

    poll([thread({ id: 't1' })], rerender);
    expect(result.current.expandedThreads.size).toBe(1);
    expect(result.current.expandedThreads.has('t2')).toBe(false);
  });
});

/**
 * The row renderers are memoised, and these two callbacks are among the props
 * they compare. If either is rebuilt on a render that changed nothing, every
 * row in the file re-renders with it and the memo buys nothing — which on a
 * long file is the difference between a responsive viewer and a frozen one.
 */
describe('useFileComments render stability', () => {
  it('keeps its row callbacks stable across an inconsequential re-render', () => {
    const { result, rerender } = setup([thread({ id: 't1' })]);
    const before = { extrasRow: result.current.extrasRow, threadBadges: result.current.threadBadges };

    rerender();

    expect(result.current.extrasRow).toBe(before.extrasRow);
    expect(result.current.threadBadges).toBe(before.threadBadges);
  });

  it('rebuilds them when a thread is expanded, so the row can redraw', () => {
    const { result } = setup([thread({ id: 't1', status: 'resolved' })]);
    const before = result.current.extrasRow;

    act(() => result.current.expandThread('t1'));

    // Stability must not become staleness: this is a change a row has to see.
    expect(result.current.extrasRow).not.toBe(before);
  });
});
