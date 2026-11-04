import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileSelection, computeSeenForRange } from '../useFileSelection';
import type { CodeFlowState } from '../../codeFlowContext';
import type { FileChange } from '../../../types';
import { savePatchHashes, setFileSeen, getLastReviewed } from '../../../utils/storage';

function makeState(overrides: Partial<CodeFlowState> = {}): CodeFlowState {
  return {
    status: 'ready',
    iterations: [
      { index: 0, sha: 'base000000000', shortSha: 'base00', label: 'Base', isBase: true },
      { index: 1, sha: 'head111111111', shortSha: 'head11', label: 'Commit 1', isBase: false },
    ],
    fromIndex: 0,
    toIndex: 1,
    comparisonLoading: false,
    seen: {},
    threads: [],
    threadsLoading: false,
    closed: {},
    closedBy: {},
    viewMode: 'inline',
    reviewers: [],
    comparison: {
      baseSha: 'base000000000',
      headSha: 'head111111111',
      files: [
        { filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
        { filename: 'b.ts', status: 'added', additions: 5, deletions: 0, changes: 5 },
      ],
      commits: [],
    },
    ...overrides,
  };
}

describe('useFileSelection', () => {
  it('selectFile updates selectedFile and clears selectedFolder', () => {
    let currentState = makeState({
      selectedFolder: 'src/components',
    } as Partial<CodeFlowState>);
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;

    const { result } = renderHook(() => useFileSelection('owner/repo#1', setState));

    act(() => { result.current.selectFile('main.ts'); });
    expect(currentState.selectedFile).toBe('main.ts');
    expect(currentState.selectedFolder).toBeUndefined();
  });

  it('selectFile cancels a line-focus request the reviewer has navigated away from', () => {
    // Opening a file by hand is the reviewer saying where they want to be. A
    // search hit clicked earlier must not still be pending, or returning to
    // its file later would replay the jump.
    let currentState = makeState({
      lineFocusRequest: { filename: 'a.ts', side: 'right', line: 2, seq: 1 },
    } as Partial<CodeFlowState>);
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;

    const { result } = renderHook(() => useFileSelection('owner/repo#1', setState));

    act(() => { result.current.selectFile('b.ts'); });
    expect(currentState.selectedFile).toBe('b.ts');
    expect(currentState.lineFocusRequest).toBeUndefined();
  });

  it('selectFolder updates selectedFolder and clears selectedFile', () => {
    let currentState = makeState({
      selectedFile: 'main.ts',
      lineFocusRequest: { filename: 'main.ts', side: 'right', line: 2, seq: 1 },
    } as Partial<CodeFlowState>);
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;

    const { result } = renderHook(() => useFileSelection('owner/repo#1', setState));

    act(() => { result.current.selectFolder('src/components'); });
    expect(currentState.selectedFolder).toBe('src/components');
    expect(currentState.selectedFile).toBeUndefined();
    expect(currentState.lineFocusRequest).toBeUndefined();
  });

  it('toggleSeen toggles file seen state', () => {
    let currentState = makeState({ seen: {} });
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;

    const { result } = renderHook(() => useFileSelection('owner/repo#1', setState));

    act(() => { result.current.toggleSeen('a.ts'); });
    expect(currentState.seen['a.ts']).toBe(true);

    act(() => { result.current.toggleSeen('a.ts'); });
    expect(currentState.seen['a.ts']).toBeUndefined();
  });

  it('markAllSeen marks all comparison files', () => {
    let currentState = makeState({ seen: {} });
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;

    const { result } = renderHook(() => useFileSelection('owner/repo#1', setState));

    act(() => { result.current.markAllSeen(true); });
    expect(currentState.seen['a.ts']).toBe(true);
    expect(currentState.seen['b.ts']).toBe(true);
  });

  it('toggleSeen is a no-op when prKeyStr is undefined', () => {
    const setState = vi.fn();

    const { result } = renderHook(() => useFileSelection(undefined, setState as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>));
    act(() => { result.current.toggleSeen('a.ts'); });
    expect(setState).not.toHaveBeenCalled();
  });

  it('remembers the iteration being reviewed when a file is marked seen', () => {
    let currentState = makeState({ seen: {} });
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;

    const { result } = renderHook(() => useFileSelection('owner/repo#9', setState));

    act(() => { result.current.toggleSeen('a.ts'); });
    expect(currentState.lastReviewed).toMatchObject({ sha: 'head111111111', index: 1 });
    expect(getLastReviewed('owner/repo#9')?.sha).toBe('head111111111');
  });

  it('does not move the marker when a file is un-marked', () => {
    // Unticking is a correction, not a review.
    let currentState = makeState({ seen: {} });
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;

    const { result } = renderHook(() => useFileSelection('owner/repo#10', setState));

    act(() => { result.current.toggleSeen('a.ts'); });
    act(() => { result.current.toggleSeen('a.ts'); });
    // Still recorded from the first (marking) call, and never a second time.
    expect(getLastReviewed('owner/repo#10')?.sha).toBe('head111111111');
  });

  it('remembers the iteration when everything is marked seen at once', () => {
    let currentState = makeState({ seen: {} });
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;

    const { result } = renderHook(() => useFileSelection('owner/repo#11', setState));

    act(() => { result.current.markAllSeen(true); });
    expect(getLastReviewed('owner/repo#11')?.sha).toBe('head111111111');
  });

  it('does not record a review when everything is un-marked', () => {
    let currentState = makeState({ seen: {} });
    const setState = vi.fn((fn) => {
      if (typeof fn === 'function') currentState = fn(currentState);
    }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;

    const { result } = renderHook(() => useFileSelection('owner/repo#12', setState));

    act(() => { result.current.markAllSeen(false); });
    expect(getLastReviewed('owner/repo#12')).toBeUndefined();
  });
});

describe('computeSeenForRange', () => {
  it('returns empty seen when no previous range exists', () => {
    const files: FileChange[] = [
      { filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    ];
    const seen = computeSeenForRange('owner/repo#1', 'range-new', files);
    expect(seen).toEqual({});
  });

  it('migrates seen from previous range when hashes match', () => {
    const files: FileChange[] = [
      { filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: 'same' },
    ];
    // Set up previous range
    savePatchHashes('owner/repo#2', 'range-old', files);
    setFileSeen('owner/repo#2', 'range-old', 'a.ts', true);

    // Now compute for new range with same file content
    const seen = computeSeenForRange('owner/repo#2', 'range-new', files);
    expect(seen['a.ts']).toBe(true);
  });
});