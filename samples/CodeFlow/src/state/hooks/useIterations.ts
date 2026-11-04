import { useCallback } from 'react';
import type { CodeFlowState } from '../codeFlowContext';
import { rangeIdOf } from '../codeFlowContext';
import type { ComparisonResult, Iteration, PrSummary } from '../../types';
import { GitHubService } from '../../services/githubService';
import { isFullRange, resolveCompareRange } from '../../utils/mergeIterations';
import { computeSeenForRange } from './useFileSelection';

export function useIterations(
  state: CodeFlowState,
  patch: (p: Partial<CodeFlowState>) => void,
  compareSeqRef: React.MutableRefObject<number>,
) {
  const computeComparison = useCallback(
    async (
      pr: PrSummary,
      iterations: Iteration[],
      fromIndex: number,
      toIndex: number,
      fullRange: ComparisonResult,
    ): Promise<ComparisonResult> => {
      const lo = Math.min(fromIndex, toIndex);
      const hi = Math.max(fromIndex, toIndex);
      // The full range is already fetched as the PR's own base..head diff,
      // which is correct by construction — never re-derive it.
      if (isFullRange(iterations, lo, hi)) return fullRange;
      const repo = { owner: pr.coordinates.owner, name: pr.coordinates.name };
      // A sub-range crossing a merge commit must be measured against the
      // mainline the merge brought in, or the diff replays everything the
      // merge dragged in alongside the PR's own work.
      const { baseSha, headSha } = resolveCompareRange(iterations, lo, hi, pr.baseSha);
      return GitHubService.compare(repo, baseSha, headSha);
    },
    [],
  );

  const selectIterations = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!state.pr || !state.fullRange) return;
      const seq = ++compareSeqRef.current;
      patch({ fromIndex, toIndex, comparisonLoading: true });
      try {
        const comparison = await computeComparison(
          state.pr,
          state.iterations,
          fromIndex,
          toIndex,
          state.fullRange,
        );
        if (seq !== compareSeqRef.current) return;

        const key = `${state.pr.coordinates.owner}/${state.pr.coordinates.name}#${state.pr.coordinates.number}`;
        const newRangeId = rangeIdOf(state.iterations, fromIndex, toIndex);
        const seen = computeSeenForRange(key, newRangeId, comparison.files);

        const stillSelected =
          state.selectedFile &&
          comparison.files.some((f) => f.filename === state.selectedFile);
        patch({
          comparison,
          comparisonLoading: false,
          seen,
          selectedFile: stillSelected ? state.selectedFile : comparison.files[0]?.filename,
        });
      } catch (e) {
        if (seq !== compareSeqRef.current) return;
        patch({
          comparisonLoading: false,
          error: e instanceof Error ? e.message : 'Failed to compare iterations',
        });
      }
    },
    [
      state.pr,
      state.fullRange,
      state.iterations,
      state.selectedFile,
      patch,
      computeComparison,
      compareSeqRef,
    ],
  );

  return { selectIterations };
}
