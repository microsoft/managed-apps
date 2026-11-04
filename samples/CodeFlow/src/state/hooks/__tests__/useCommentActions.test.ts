import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommentActions } from '../useCommentActions';
import type { CodeFlowState } from '../../codeFlowContext';
import type { CommentStore } from '../../../services/comments/CommentStore';
import type { CommentThread } from '../../../types';
import { getClosedThreads } from '../../../utils/storage';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function makeState(overrides: Partial<CodeFlowState> = {}): CodeFlowState {
  return {
    status: 'ready',
    iterations: [],
    fromIndex: 0,
    toIndex: 0,
    comparisonLoading: false,
    seen: {},
    threads: [],
    threadsLoading: false,
    closed: {},
    closedBy: {},
    viewMode: 'inline',
    reviewers: [],
    currentUser: { login: 'testuser' },
    ...overrides,
  };
}

/** Minimal stand-in so `refreshThreads` recognises the PR key it was handed. */
const PR = { coordinates: { owner: 'o', name: 'r', number: 1 } } as CodeFlowState['pr'];

function makeMockStore(overrides: Partial<CommentStore> = {}): CommentStore {
  return {
    backend: 'github',
    label: 'GitHub (synced)',
    listThreads: vi.fn().mockResolvedValue([]),
    createThread: vi.fn().mockResolvedValue({
      id: 'real-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'active', comments: [{ id: 'real-1', author: { login: 'testuser' }, body: 'hi', createdAt: '' }],
      createdAt: '', updatedAt: '',
    }),
    addComment: vi.fn().mockResolvedValue({
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'active', comments: [
        { id: '1', author: { login: 'alice' }, body: 'root', createdAt: '' },
        { id: '2', author: { login: 'testuser' }, body: 'reply', createdAt: '' },
      ],
      createdAt: '', updatedAt: '',
    }),
    setStatus: vi.fn().mockResolvedValue({}),
    editComment: vi.fn().mockResolvedValue({
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'active', comments: [
        { id: '1', author: { login: 'testuser' }, body: 'edited', createdAt: '' },
      ],
      createdAt: '', updatedAt: '',
    }),
    deleteThread: vi.fn().mockResolvedValue(undefined),
    deleteComment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('useCommentActions', () => {
  it('preserves the range in the optimistic thread before GitHub responds', async () => {
    let current = makeState();
    const setState: React.Dispatch<React.SetStateAction<CodeFlowState>> = (next) => {
      current = typeof next === 'function' ? next(current) : next;
    };
    const store = makeMockStore({
      createThread: vi.fn(async (input) => {
        expect(current.threads[0]).toMatchObject({ side: 'left', startLine: 2, line: 5 });
        expect(input).toMatchObject({ side: 'left', startLine: 2, line: 5 });
        throw new Error('request refused');
      }),
    });
    const { result } = renderHook(() => useCommentActions('o/r#1', current, setState, { current: store }));
    await act(async () => {
      await expect(result.current.createThread({
        filename: 'a.ts', side: 'left', startLine: 2, line: 5, body: 'block',
      })).rejects.toThrow('request refused');
    });
    expect(current.threads).toEqual([]);
  });

  it('createThread adds optimistic thread then replaces with server response', async () => {
    vi.useFakeTimers();
    const state = makeState();
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const store = makeMockStore();
    const storeRef = { current: store };

    const { result } = renderHook(() => useCommentActions('o/r#1', currentState, setState, storeRef));

    await act(async () => {
      await result.current.createThread({
        filename: 'a.ts', side: 'right', line: 5, body: 'hi', iterationIndex: 1,
      });
    });

    expect(store.createThread).toHaveBeenCalledWith(expect.objectContaining({
      prKey: 'o/r#1', filename: 'a.ts', body: 'hi',
    }));

    vi.useRealTimers();
  });

  it('createThread rolls back optimistic on failure', async () => {
    const state = makeState();
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const store = makeMockStore({
      createThread: vi.fn().mockRejectedValue(new Error('network error')),
    });
    const storeRef = { current: store };

    const { result } = renderHook(() => useCommentActions('o/r#1', currentState, setState, storeRef));

    // The failure must propagate so the composer can show it and keep the draft.
    await act(async () => {
      await expect(
        result.current.createThread({
          filename: 'a.ts', side: 'right', line: 5, body: 'hi',
        }),
      ).rejects.toThrow('network error');
    });

    // After rollback, threads should be empty
    expect(currentState.threads).toHaveLength(0);
  });

  it('editComment swaps the body optimistically, then keeps the server’s copy', async () => {
    vi.useFakeTimers();
    const existingThread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'active',
      comments: [{ id: '1', author: { login: 'testuser' }, body: 'before', createdAt: '' }],
      createdAt: '', updatedAt: '',
    };
    const state = makeState({ threads: [existingThread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const store = makeMockStore();
    const storeRef = { current: store };

    const { result } = renderHook(() => useCommentActions('o/r#1', currentState, setState, storeRef));

    await act(async () => {
      await result.current.editComment('thread-1', '1', 'after');
    });

    expect(store.editComment).toHaveBeenCalledWith(
      'o/r#1', 'thread-1', '1', 'after', existingThread,
    );
    expect(currentState.threads[0].comments[0].body).toBe('edited');

    vi.useRealTimers();
  });

  it('editComment puts the old text back when the save is refused', async () => {
    // GitHub refuses an edit by anyone but the author, so a rejected save must
    // not leave the reader looking at a version that was never accepted.
    const existingThread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'active',
      comments: [{ id: '1', author: { login: 'testuser' }, body: 'before', createdAt: '' }],
      createdAt: '', updatedAt: '',
    };
    const state = makeState({ threads: [existingThread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const store = makeMockStore({
      editComment: vi.fn().mockRejectedValue(new Error('not the author')),
    });
    const storeRef = { current: store };

    const { result } = renderHook(() => useCommentActions('o/r#1', currentState, setState, storeRef));

    // The failure has to propagate so the editor can stay open with the draft.
    await act(async () => {
      await expect(result.current.editComment('thread-1', '1', 'after')).rejects.toThrow(
        'not the author',
      );
    });

    expect(currentState.threads[0].comments[0].body).toBe('before');
  });

  it('addComment rolls back on failure', async () => {
    const existingThread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'active', comments: [{ id: '1', author: { login: 'alice' }, body: 'root', createdAt: '' }],
      createdAt: '', updatedAt: '',
    };
    const state = makeState({ threads: [existingThread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const store = makeMockStore({
      addComment: vi.fn().mockRejectedValue(new Error('fail')),
    });
    const storeRef = { current: store };

    const { result } = renderHook(() => useCommentActions('o/r#1', currentState, setState, storeRef));

    await act(async () => {
      await expect(result.current.addComment('thread-1', 'my reply')).rejects.toThrow('fail');
    });

    // Should have rolled back — only original comment remains
    expect(currentState.threads[0].comments).toHaveLength(1);
  });

  it('setThreadStatus optimistically updates and rolls back on failure', async () => {
    const existingThread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'active', comments: [], createdAt: '', updatedAt: '',
    };
    const state = makeState({ threads: [existingThread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const store = makeMockStore({
      setStatus: vi.fn().mockRejectedValue(new Error('fail')),
      listThreads: vi.fn().mockResolvedValue([existingThread]),
    });
    const storeRef = { current: store };

    const { result } = renderHook(() => useCommentActions('o/r#1', currentState, setState, storeRef));

    await act(async () => {
      await expect(result.current.setThreadStatus('thread-1', 'resolved')).rejects.toThrow('fail');
    });

    // Should have rolled back to 'active'
    expect(currentState.threads[0].status).toBe('active');
  });

  it('deleteThread optimistically removes and rolls back on failure', async () => {
    const existingThread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'active', comments: [], createdAt: '', updatedAt: '',
    };
    const state = makeState({ threads: [existingThread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const store = makeMockStore({
      deleteThread: vi.fn().mockRejectedValue(new Error('fail')),
      listThreads: vi.fn().mockResolvedValue([existingThread]),
    });
    const storeRef = { current: store };

    const { result } = renderHook(() => useCommentActions('o/r#1', currentState, setState, storeRef));

    await act(async () => {
      await result.current.deleteThread('thread-1');
    });

    // Should have been rolled back
    expect(currentState.threads).toHaveLength(1);
    expect(currentState.threads[0].id).toBe('thread-1');
  });

  it('setThreadClosed also calls setStatus to sync resolved state to GitHub', () => {
    const thread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'active', comments: [], createdAt: '', updatedAt: '',
    };
    const state = makeState({ threads: [thread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const store = makeMockStore();
    const storeRef = { current: store };

    const { result } = renderHook(() =>
      useCommentActions('o/r#1', currentState, setState, storeRef),
    );

    act(() => {
      result.current.setThreadClosed('thread-1', true);
    });

    // Local closed flag set
    expect(currentState.closed).toEqual({ 'thread-1': true });
    // Optimistic status update to 'resolved'
    expect(currentState.threads[0].status).toBe('resolved');
    // GitHub sync triggered
    expect(store.setStatus).toHaveBeenCalledWith('o/r#1', 'thread-1', 'resolved');
  });

  it('setThreadClosed calls setStatus with active when reopening', () => {
    const thread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'resolved', comments: [], createdAt: '', updatedAt: '',
      closed: true,
    };
    const state = makeState({ threads: [thread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const store = makeMockStore();
    const storeRef = { current: store };

    const { result } = renderHook(() =>
      useCommentActions('o/r#1', currentState, setState, storeRef),
    );

    act(() => {
      result.current.setThreadClosed('thread-1', false);
    });

    expect(currentState.closed).toEqual({});
    expect(currentState.threads[0].status).toBe('active');
    expect(store.setStatus).toHaveBeenCalledWith('o/r#1', 'thread-1', 'active');
  });

  it('setThreadClosed skips GitHub sync for issue comments', () => {
    const thread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: '', side: 'right', line: 0,
      status: 'active', comments: [], createdAt: '', updatedAt: '',
      isIssueComment: true,
    };
    const state = makeState({ threads: [thread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const store = makeMockStore();
    const storeRef = { current: store };

    const { result } = renderHook(() =>
      useCommentActions('o/r#1', currentState, setState, storeRef),
    );

    act(() => {
      result.current.setThreadClosed('thread-1', true);
    });

    expect(currentState.closed).toEqual({ 'thread-1': true });
    // Status unchanged and no GitHub API call
    expect(currentState.threads[0].status).toBe('active');
    expect(store.setStatus).not.toHaveBeenCalled();
  });

  it('setThreadStatus logs error on failure', async () => {
    const existingThread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'active', comments: [], createdAt: '', updatedAt: '',
    };
    const state = makeState({ threads: [existingThread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const store = makeMockStore({
      setStatus: vi.fn().mockRejectedValue(new Error('resolve failed')),
      listThreads: vi.fn().mockResolvedValue([existingThread]),
    });
    const storeRef = { current: store };

    const { result } = renderHook(() =>
      useCommentActions('o/r#1', currentState, setState, storeRef),
    );

    await act(async () => {
      await expect(result.current.setThreadStatus('thread-1', 'resolved')).rejects.toThrow(
        'resolve failed',
      );
    });

    // Rolled back
    expect(currentState.threads[0].status).toBe('active');
    // Error was logged
    expect(console.error).toHaveBeenCalled();
  });

  /**
   * The bug this guards: GitHub's review threads are not read-your-writes
   * consistent, so the refresh that follows a status write could report the
   * status the reviewer had just changed away from — and win.
   */
  it('setThreadStatus keeps the new status when the read-back is still stale', async () => {
    const resolvedThread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'resolved', comments: [], createdAt: '', updatedAt: '',
    };
    const state = makeState({ pr: PR, threads: [resolvedThread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    // GitHub accepts the unresolve but still reports the thread as resolved.
    const store = makeMockStore({
      listThreads: vi.fn().mockResolvedValue([{ ...resolvedThread }]),
    });
    const storeRef = { current: store };

    const { result } = renderHook(() =>
      useCommentActions('o/r#1', currentState, setState, storeRef),
    );

    await act(async () => {
      await result.current.setThreadStatus('thread-1', 'active');
    });

    expect(currentState.threads[0].status).toBe('active');

    // And a later poll must not undo it either.
    await act(async () => {
      await result.current.refreshThreads();
    });

    expect(currentState.threads[0].status).toBe('active');
  });

  it('setThreadStatus hands control back to the server once it agrees', async () => {
    const resolvedThread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'resolved', comments: [], createdAt: '', updatedAt: '',
    };
    const state = makeState({ pr: PR, threads: [resolvedThread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const listThreads = vi
      .fn()
      // Stale read-back, then the server catches up, then someone else
      // resolves the thread again on GitHub.
      .mockResolvedValueOnce([{ ...resolvedThread }])
      .mockResolvedValueOnce([{ ...resolvedThread, status: 'active' as const }])
      .mockResolvedValueOnce([{ ...resolvedThread }]);
    const storeRef = { current: makeMockStore({ listThreads }) };

    const { result } = renderHook(() =>
      useCommentActions('o/r#1', currentState, setState, storeRef),
    );

    await act(async () => {
      await result.current.setThreadStatus('thread-1', 'active');
    });
    expect(currentState.threads[0].status).toBe('active');

    await act(async () => { await result.current.refreshThreads(); });
    expect(currentState.threads[0].status).toBe('active');

    await act(async () => { await result.current.refreshThreads(); });
    expect(currentState.threads[0].status).toBe('resolved');
  });

  it('setThreadStatus stops pinning a status the write never landed', async () => {
    const resolvedThread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'resolved', comments: [], createdAt: '', updatedAt: '',
    };
    const state = makeState({ pr: PR, threads: [resolvedThread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const storeRef = {
      current: makeMockStore({
        setStatus: vi.fn().mockRejectedValue(new Error('nope')),
        listThreads: vi.fn().mockResolvedValue([{ ...resolvedThread }]),
      }),
    };

    const { result } = renderHook(() =>
      useCommentActions('o/r#1', currentState, setState, storeRef),
    );

    await act(async () => {
      await expect(result.current.setThreadStatus('thread-1', 'active')).rejects.toThrow('nope');
    });

    await act(async () => { await result.current.refreshThreads(); });

    expect(currentState.threads[0].status).toBe('resolved');
  });

  it('setThreadClosed pins the unresolve so reopening survives a stale read', async () => {
    const resolvedThread: CommentThread = {
      id: 'thread-1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'resolved', comments: [], createdAt: '', updatedAt: '',
    };
    const state = makeState({ pr: PR, threads: [resolvedThread] });
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const storeRef = {
      current: makeMockStore({ listThreads: vi.fn().mockResolvedValue([{ ...resolvedThread }]) }),
    };

    const { result } = renderHook(() =>
      useCommentActions('o/r#1', currentState, setState, storeRef),
    );

    act(() => {
      result.current.setThreadClosed('thread-1', false);
    });
    await act(async () => { await result.current.refreshThreads(); });

    expect(currentState.threads[0].status).toBe('active');
  });

  it('setThreadClosed persists to storage and patches state.closed', () => {
    const state = makeState();
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const storeRef = { current: makeMockStore() };

    const { result } = renderHook(() =>
      useCommentActions('o/r#1', currentState, setState, storeRef),
    );

    act(() => {
      result.current.setThreadClosed('thread-1', true);
    });

    expect(currentState.closed).toEqual({ 'thread-1': true });
    expect(getClosedThreads('o/r#1')).toEqual({ 'thread-1': true });

    act(() => {
      result.current.setThreadClosed('thread-1', false);
    });

    expect(currentState.closed).toEqual({});
  });

  it('setThreadClosed records who closed the thread so other reviewers can see', () => {
    const state = makeState();
    let currentState = state;
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const storeRef = { current: makeMockStore() };

    const { result } = renderHook(() =>
      useCommentActions('o/r#1', currentState, setState, storeRef),
    );

    act(() => {
      result.current.setThreadClosed('thread-1', true);
    });

    expect(currentState.closedBy['thread-1']).toMatchObject({ closed: true });
    expect(currentState.closedBy['thread-1'].at).toEqual(expect.any(String));
  });
});
/**
 * The diff viewer memoises every row against props derived from `threads`, so
 * the array's identity is load-bearing: swap it for an equal one and the whole
 * open file re-renders. The poll runs on a timer, so doing that would freeze a
 * long file at a fixed interval for as long as it stayed open.
 */
describe('useCommentActions refreshThreads identity', () => {
  const COORDS = { owner: 'o', name: 'r', number: 1 };

  function harness(threads: CommentThread[], listed: CommentThread[]) {
    let currentState = makeState({ threads, pr: { coordinates: COORDS } } as Partial<CodeFlowState>);
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
    const storeRef = {
      current: makeMockStore({ listThreads: vi.fn().mockResolvedValue(listed) }),
    };
    const { result } = renderHook(() =>
      useCommentActions('o/r#1', currentState, setState, storeRef),
    );
    return {
      result,
      get threads() {
        return currentState.threads;
      },
      get state() {
        return currentState;
      },
    };
  }

  function thread(over: Partial<CommentThread> = {}): CommentThread {
    return {
      id: 't1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 5,
      status: 'active',
      comments: [{ id: 'c1', author: { login: 'alice' }, body: 'hi', createdAt: 'now' }],
      createdAt: 'now', updatedAt: 'now',
      ...over,
    } as CommentThread;
  }

  it('keeps the existing array when the poll found nothing new', async () => {
    const existing = [thread()];
    // What the store really returns: the same conversation, freshly parsed.
    const refetched = JSON.parse(JSON.stringify(existing)) as CommentThread[];
    const h = harness(existing, refetched);
    const stateBefore = h.state;

    await act(async () => { await h.result.current.refreshThreads(); });

    expect(h.threads).toBe(existing);
    // Untouched state means React bails out of the render entirely.
    expect(h.state).toBe(stateBefore);
  });

  it('takes the new array when a reply lands', async () => {
    const existing = [thread()];
    const withReply = [
      thread({
        comments: [
          { id: 'c1', author: { login: 'alice' }, body: 'hi', createdAt: 'now' },
          { id: 'c2', author: { login: 'bob' }, body: 'and', createdAt: 'later' },
        ],
      }),
    ];
    const h = harness(existing, withReply);

    await act(async () => { await h.result.current.refreshThreads(); });

    expect(h.threads).toBe(withReply);
  });

  it('takes the new array when a thread is resolved elsewhere', async () => {
    const existing = [thread()];
    const resolved = [thread({ status: 'resolved' })];
    const h = harness(existing, resolved);

    await act(async () => { await h.result.current.refreshThreads(); });

    expect(h.threads).toBe(resolved);
  });

  it('takes the new array when a thread appears', async () => {
    const existing = [thread()];
    const grown = [thread(), thread({ id: 't2' })];
    const h = harness(existing, grown);

    await act(async () => { await h.result.current.refreshThreads(); });

    expect(h.threads).toBe(grown);
  });
});
