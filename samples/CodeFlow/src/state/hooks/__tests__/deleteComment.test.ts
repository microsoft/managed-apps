import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommentActions } from '../useCommentActions';
import type { CommentThread } from '../../../types';
import type { CodeFlowState } from '../../codeFlowContext';
import type { CommentStore } from '../../../services/comments/CommentStore';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

function setup() {
  const thread: CommentThread = {
    id: 't1', prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 1,
    status: 'active', createdAt: '', updatedAt: '',
    comments: [
      { id: 'c1', nodeId: 'PRRC_1', author: { login: 'alice' }, body: 'mine', createdAt: '' },
      { id: 'c2', nodeId: 'PRRC_2', author: { login: 'bob' }, body: 'theirs', createdAt: '' },
    ],
  };
  const initial: CodeFlowState = {
    status: 'ready', iterations: [], fromIndex: 0, toIndex: 0, comparisonLoading: false,
    seen: {}, threads: [thread], threadsLoading: false, closed: {}, closedBy: {},
    viewMode: 'inline', reviewers: [], currentUser: { login: 'Alice' },
    pr: {
      coordinates: { owner: 'o', name: 'r', number: 1 }, title: 'PR', author: { login: 'bob' },
      state: 'open', draft: false, merged: false,
      baseRef: 'main', headRef: 'feature', baseSha: 'base', headSha: 'head',
    },
  };
  const store: CommentStore = {
    backend: 'github', label: 'GitHub', listThreads: vi.fn(),
    createThread: vi.fn(), addComment: vi.fn(), editComment: vi.fn(),
    deleteComment: vi.fn().mockResolvedValue(undefined), setStatus: vi.fn(), deleteThread: vi.fn(),
  };
  const storeRef = { current: store };
  const hook = renderHook(() => {
    const [state, setState] = useState(initial);
    const actions = useCommentActions('o/r#1', state, setState, storeRef);
    return { state, setState, actions };
  });
  return { ...hook, store, thread };
}

describe('deleteComment action', () => {
  it('keeps the comment while pending, then removes only it without a fallible read-back', async () => {
    const { result, store, thread } = setup();
    let finish!: () => void;
    vi.mocked(store.deleteComment).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    let pending!: Promise<void>;
    act(() => { pending = result.current.actions.deleteComment('t1', 'c1'); });
    expect(result.current.state.threads[0].comments).toEqual(thread.comments);
    await act(async () => { finish(); await pending; });
    expect(store.deleteComment).toHaveBeenCalledWith('o/r#1', 't1', 'c1', thread);
    expect(result.current.state.threads[0].comments).toEqual([thread.comments[1]]);
    expect(store.listThreads).not.toHaveBeenCalled();
  });

  it('preserves a concurrent reply when deletion completes', async () => {
    const { result, store, thread } = setup();
    let finish!: () => void;
    vi.mocked(store.deleteComment).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    let pending!: Promise<void>;
    act(() => { pending = result.current.actions.deleteComment('t1', 'c1'); });
    const reply = { ...thread.comments[1], id: 'c3', body: 'new reply' };
    act(() => result.current.setState((s) => ({
      ...s, threads: [{ ...thread, comments: [...thread.comments, reply] }],
    })));
    await act(async () => { finish(); await pending; });
    expect(result.current.state.threads[0].comments).toEqual([thread.comments[1], reply]);
  });

  it('removes the thread when its last comment is deleted', async () => {
    const { result, thread } = setup();
    act(() => result.current.setState((s) => ({
      ...s, threads: [{ ...thread, comments: [thread.comments[0]] }],
    })));
    await act(async () => { await result.current.actions.deleteComment('t1', 'c1'); });
    expect(result.current.state.threads).toEqual([]);
  });

  it('preserves the whole thread and rejects with the server error on failure', async () => {
    const { result, store, thread } = setup();
    vi.mocked(store.deleteComment).mockRejectedValueOnce(new Error('permission denied'));
    await act(async () => {
      await expect(result.current.actions.deleteComment('t1', 'c1')).rejects.toThrow('permission denied');
    });
    expect(result.current.state.threads).toEqual([thread]);
  });

  it('does not delete another author or a missing comment', async () => {
    const { result, store } = setup();
    await expect(result.current.actions.deleteComment('t1', 'c2')).rejects.toThrow('Only your own');
    await expect(result.current.actions.deleteComment('t1', 'absent')).rejects.toThrow('Comment not found');
    expect(store.deleteComment).not.toHaveBeenCalled();
  });

  it('does not remove a same-ID comment from another PR after navigation', async () => {
    const { result, store, thread } = setup();
    let finish!: () => void;
    vi.mocked(store.deleteComment).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    let pending!: Promise<void>;
    act(() => { pending = result.current.actions.deleteComment('t1', 'c1'); });
    act(() => result.current.setState((s) => ({
      ...s,
      pr: s.pr ? { ...s.pr, coordinates: { owner: 'o', name: 'r', number: 2 } } : undefined,
      threads: [{ ...thread, prKey: 'o/r#2' }],
    })));
    await act(async () => { finish(); await pending; });
    expect(result.current.state.threads[0].comments).toEqual(thread.comments);
  });
});
