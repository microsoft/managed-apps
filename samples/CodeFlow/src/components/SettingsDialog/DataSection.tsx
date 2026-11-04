import { useCallback, useRef, useState } from 'react';
import { downloadSnapshot, readSnapshotFile, storageErrorMessage } from '../../storage/core';
import { appStorage, initAppStorage } from '../../storage';
import { SettingGroup, SettingRow } from './controls';

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'error'; message: string };

/**
 * Where the app keeps its data, plus Export / Import.
 *
 * Export writes every collection and preference to one JSON file. Import reads
 * such a file back (validating every record), which is also how data moves to a
 * shared storage provider: export in local mode, switch providers, import.
 */
export function DataSection() {
  const provider = appStorage().provider;
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const fileInput = useRef<HTMLInputElement>(null);

  const onExport = useCallback(async () => {
    setStatus({ kind: 'busy' });
    try {
      await appStorage().reviewState.flush();
      await appStorage().prNotes.flush();
      const date = new Date().toISOString().slice(0, 10);
      await downloadSnapshot(appStorage().provider, `codeflow-data-${date}.json`);
      setStatus({ kind: 'done', message: 'Export downloaded.' });
    } catch (error) {
      setStatus({ kind: 'error', message: storageErrorMessage(error) });
    }
  }, []);

  const onImportFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!window.confirm('Import this file? Records with the same id are replaced; everything else is kept.')) return;
    setStatus({ kind: 'busy' });
    try {
      const snapshot = await readSnapshotFile(file);
      await appStorage().reviewState.flush();
      await appStorage().prNotes.flush();
      const current = appStorage().provider;
      await current.importAll(snapshot, { mode: 'merge' });
      // Re-open storage so every cached view (settings, review state) reloads.
      await initAppStorage(current);
      setStatus({ kind: 'done', message: 'Import complete.' });
    } catch (error) {
      setStatus({ kind: 'error', message: storageErrorMessage(error) });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }, []);

  return (
    <>
      <SettingGroup title="Storage">
        <SettingRow
          label="Where your data lives"
          hint={
            provider.capabilities.shared
              ? 'Review notes, approvals and feedback are stored in a shared backend.'
              : 'Local mode: everything is kept in this browser only. Clearing site data removes it, and other reviewers cannot see it.'
          }
        >
          <code className="set__mono">{provider.id}</code>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Export and import">
        <SettingRow
          label="Export data"
          hint="Download review state, notes, approvals, feedback and preferences as one JSON file."
        >
          <button className="btn btn--sm" onClick={() => void onExport()} disabled={status.kind === 'busy'}>
            Export…
          </button>
        </SettingRow>
        <SettingRow
          label="Import data"
          hint="Load a file created by Export. Every record is validated; invalid ones are skipped."
        >
          <button
            className="btn btn--sm"
            onClick={() => fileInput.current?.click()}
            disabled={status.kind === 'busy'}
          >
            Import…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="import-file"
            onChange={(e) => void onImportFile(e.target.files?.[0])}
          />
        </SettingRow>
        {status.kind === 'done' && <p className="set__hint" role="status">{status.message}</p>}
        {status.kind === 'error' && <p className="set__error" role="alert">{status.message}</p>}
      </SettingGroup>
    </>
  );
}
