import { useCallback } from 'react';
import type { CodeFlowState } from '../codeFlowContext';
import { rangeIdOf } from '../codeFlowContext';
import type { FileChange } from '../../types';
import {
  getSeenFiles,
  getLastRangeId,
  migrateSeenByContent,
  savePatchHashes,
  setFileSeen,
  setManyFilesSeen,
} from '../../utils/storage';
import { withReviewedIteration } from './reviewedIteration';

type SetState = React.Dispatch<React.SetStateAction<CodeFlowState>>;

export function useFileSelection(
  prKeyStr: string | undefined,
  setState: SetState,
) {
  // Opening a file by hand cancels any line-focus request still outstanding.
  // The reviewer has said where they want to be; a search hit they clicked
  // earlier must not still be waiting to pull them somewhere else.
  const selectFile = useCallback(
    (filename: string) =>
      setState((s) => ({
        ...s,
        selectedFile: filename,
        selectedFolder: undefined,
        lineFocusRequest: undefined,
      })),
    [setState],
  );

  const selectFolder = useCallback(
    (folderPath: string) =>
      setState((s) => ({
        ...s,
        selectedFolder: folderPath,
        selectedFile: undefined,
        lineFocusRequest: undefined,
      })),
    [setState],
  );

  const toggleSeen = useCallback(
    (filename: string) => {
      if (!prKeyStr) return;
      setState((s) => {
        const next = !s.seen[filename];
        const seen = setFileSeen(
          prKeyStr,
          rangeIdOf(s.iterations, s.fromIndex, s.toIndex),
          filename,
          next,
        );
        // Unmarking is a correction, not a review, so it doesn't move the marker.
        return next ? withReviewedIteration({ ...s, seen }, prKeyStr) : { ...s, seen };
      });
    },
    [prKeyStr, setState],
  );

  const markAllSeen = useCallback(
    (seenValue: boolean) => {
      if (!prKeyStr) return;
      setState((s) => {
        const files = (s.comparison?.files ?? []).map((f) => f.filename);
        const seen = setManyFilesSeen(
          prKeyStr,
          rangeIdOf(s.iterations, s.fromIndex, s.toIndex),
          files,
          seenValue,
        );
        return seenValue ? withReviewedIteration({ ...s, seen }, prKeyStr) : { ...s, seen };
      });
    },
    [prKeyStr, setState],
  );

  return { selectFile, selectFolder, toggleSeen, markAllSeen };
}

/**
 * Compute seen marks for a new range, migrating from a previous range if needed.
 */
export function computeSeenForRange(
  prKey: string,
  rangeId: string,
  files: FileChange[],
): Record<string, boolean> {
  const prevRangeId = getLastRangeId(prKey);
  if (prevRangeId && prevRangeId !== rangeId) {
    return migrateSeenByContent(prKey, prevRangeId, rangeId, files);
  }
  const seen = getSeenFiles(prKey, rangeId);
  savePatchHashes(prKey, rangeId, files);
  return seen;
}
