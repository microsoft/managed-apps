import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIterations } from '../useIterations';
import type { CodeFlowState } from '../../codeFlowContext';
import type { ComparisonResult, Iteration, PrSummary } from '../../../types';
import { GitHubService } from '../../../services/githubService';

vi.mock('../../../services/githubService', () => ({
  GitHubService: { compare: vi.fn() },
}));

const compare = vi.mocked(GitHubService.compare);

const BASE = 'base000';
const MAINLINE = 'main999';

function commit(index: number, sha: string, parents?: string[]): Iteration {
  return {
    index,
    sha,
    shortSha: sha.slice(0, 7),
    label: `Iteration ${index}`,
    isBase: false,
    ...(parents ? { parents } : {}),
  };
}

/** 0 base · 1 c1 · 2 c2 · 3 MERGE · 4 c4 */
const iterations: Iteration[] = [
  { index: 0, sha: BASE, shortSha: BASE.slice(0, 7), label: 'Base', isBase: true },
  commit(1, 'c1'),
  commit(2, 'c2'),
  commit(3, 'm3', ['c2', MAINLINE]),
  commit(4, 'c4'),
];

const pr = {
  coordinates: { owner: 'acme', name: 'widgets', number: 7 },
  baseSha: BASE,
} as unknown as PrSummary;

function result(files: string[]): ComparisonResult {
  return {
    baseSha: 'x',
    headSha: 'y',
    files: files.map((filename) => ({
      filename,
      status: 'modified' as const,
      additions: 1,
      deletions: 0,
      changes: 1,
    })),
    commits: [],
  };
}

const fullRange = result(['full.ts']);

function makeState(overrides: Partial<CodeFlowState> = {}): CodeFlowState {
  return {
    pr,
    iterations,
    fullRange,
    fromIndex: 0,
    toIndex: 4,
    ...overrides,
  } as unknown as CodeFlowState;
}

async function select(from: number, to: number, overrides: Partial<CodeFlowState> = {}) {
  const patch = vi.fn();
  const seqRef = { current: 0 };
  const { result: hook } = renderHook(() =>
    useIterations(makeState(overrides), patch, seqRef),
  );
  await act(async () => {
    await hook.current.selectIterations(from, to);
  });
  return patch;
}

beforeEach(() => {
  compare.mockReset();
  compare.mockResolvedValue(result(['sub.ts']));
});

describe('useIterations — full-PR range', () => {
  // The full range is the PR's own base..head diff, already fetched and correct
  // by construction. Re-deriving it could only make it wrong.
  it('reuses the cached comparison without calling the API', async () => {
    const patch = await select(0, 4);
    expect(compare).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(expect.objectContaining({ comparison: fullRange }));
  });

  it('reuses it when the endpoints are selected in reverse', async () => {
    await select(4, 0);
    expect(compare).not.toHaveBeenCalled();
  });

  it('still reuses it on a branch containing a merge commit', async () => {
    // Guards the blast radius of the merge fix: it must never reach the
    // default view a reviewer opens the PR on.
    await select(0, 4, { fromIndex: 2, toIndex: 3 });
    expect(compare).not.toHaveBeenCalled();
  });
});

describe('useIterations — sub-ranges', () => {
  const repo = { owner: 'acme', name: 'widgets' };

  it('compares the selected commits when no merge is involved', async () => {
    await select(1, 2);
    expect(compare).toHaveBeenCalledWith(repo, 'c1', 'c2');
  });

  it('compares against the merged-in mainline when the range ends on a merge', async () => {
    await select(2, 3);
    expect(compare).toHaveBeenCalledWith(repo, MAINLINE, 'm3');
  });

  it('compares against the merged-in mainline when the range spans a merge', async () => {
    await select(1, 3, { });
    expect(compare).toHaveBeenCalledWith(repo, MAINLINE, 'm3');
  });

  it('stays incremental when the range starts at the merge', async () => {
    await select(3, 4);
    expect(compare).toHaveBeenCalledWith(repo, 'm3', 'c4');
  });

  it('normalises a reversed sub-range', async () => {
    await select(3, 2);
    expect(compare).toHaveBeenCalledWith(repo, MAINLINE, 'm3');
  });

  it('reports comparison failures without leaving the bar spinning', async () => {
    compare.mockRejectedValue(new Error('boom'));
    const patch = await select(1, 2);
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({ comparisonLoading: false, error: 'boom' }),
    );
  });
});
