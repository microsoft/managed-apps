import { useSyncExternalStore } from 'react';
import { subscribeReviewState } from '../../utils/storage';
import { onStorageReset, storageGeneration } from '../../storage';

let revision = 0;

function subscribe(notify: () => void): () => void {
  let inner = subscribeReviewState(() => {
    revision += 1;
    notify();
  });
  const offReset = onStorageReset(() => {
    inner();
    inner = subscribeReviewState(() => {
      revision += 1;
      notify();
    });
    notify();
  });
  return () => {
    inner();
    offReset();
  };
}

function snapshot(): string {
  return `${storageGeneration()}:${revision}`;
}

/**
 * Re-render when stored review state changes outside React (another tab, a
 * shared backend refresh, or a write from elsewhere in the app). Views that read
 * `utils/storage` during render need this.
 */
export function useReviewStateRevision(): string {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
