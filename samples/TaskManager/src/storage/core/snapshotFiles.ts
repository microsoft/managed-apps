import { ValidationError } from './errors';
import type { StorageProvider, StorageSnapshot } from './types';

/** Saves every collection and key/value namespace to a JSON file the user downloads. */
export async function downloadSnapshot(provider: StorageProvider, fileName: string): Promise<void> {
  const snapshot = await provider.exportAll();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Reads a snapshot file chosen by the user. Throws ValidationError for anything else. */
export async function readSnapshotFile(file: Blob): Promise<StorageSnapshot> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new ValidationError('snapshot', 'json', 'The file is not valid JSON.');
  }
  const candidate = parsed as Partial<StorageSnapshot> | null;
  if (
    !candidate
    || candidate.format !== 'app-storage-snapshot'
    || candidate.formatVersion !== 1
    || typeof candidate.collections !== 'object'
    || typeof candidate.kv !== 'object'
  ) {
    throw new ValidationError('snapshot', 'format', 'The file is not a data export from this app.');
  }
  return candidate as StorageSnapshot;
}
