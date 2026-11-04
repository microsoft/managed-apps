import { useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownloadRegular } from '@fluentui/react-icons/headless/svg/arrow-download';
import { ArrowUploadRegular } from '@fluentui/react-icons/headless/svg/arrow-upload';
import { ConfirmDialog } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import { config } from '../config';
import { errorMessage } from '../lib/format';
import { pastSessionsKey, usePastSessions } from '../lib/pastSessions';
import { removeSampleData } from '../lib/sampleData';
import { useToast } from '../lib/toast';
import { downloadSnapshot, readSnapshotFile, storageErrorMessage, ValidationError, type StorageSnapshot } from '../storage/core';
import { useAppStorage } from '../storage/useAppStorage';

function exportFileName(now = new Date()): string {
  return `${config.storagePrefix}-data-${now.toISOString().slice(0, 10)}.json`;
}

function countRecords(snapshot: StorageSnapshot): number {
  return Object.values(snapshot.collections).reduce((sum, records) => sum + records.length, 0);
}

/** ValidationError keeps the specific reason (e.g. "not valid JSON") in `issues` when it is text. */
function fileErrorMessage(error: unknown): string {
  if (error instanceof ValidationError && typeof error.issues === 'string') return error.issues;
  return storageErrorMessage(error);
}

export function Settings() {
  const storage = useAppStorage();
  const { provider } = storage;
  const client = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<StorageSnapshot | null>(null);
  const past = usePastSessions();
  const sampleCount = (past.data ?? []).filter((s) => s.sample).length;

  // Record counts for the summary; refreshed whenever this page is shown.
  const summary = useQuery({
    queryKey: ['settings', 'summary'],
    queryFn: async () => {
      const snapshot = await provider.exportAll();
      return { records: countRecords(snapshot) };
    },
    staleTime: 0,
  });

  const exportData = useMutation({
    mutationFn: () => downloadSnapshot(provider, exportFileName()),
    onError: (error) => toast({ tone: 'error', message: `Couldn’t export your data. ${storageErrorMessage(error)}` }),
  });

  const importData = useMutation({
    mutationFn: (snapshot: StorageSnapshot) => provider.importAll(snapshot, { mode: 'replace' }),
    onSuccess: () => {
      setPendingImport(null);
      toast({ tone: 'success', message: 'Data imported.' });
      void client.invalidateQueries();
    },
  });

  const removeSamples = useMutation({
    mutationFn: () => removeSampleData(storage),
    onSuccess: (count) => {
      toast({ tone: 'success', message: `Removed ${count} sample ${count === 1 ? 'session' : 'sessions'}.` });
      void client.invalidateQueries({ queryKey: pastSessionsKey });
    },
    onError: (error) => toast({ tone: 'error', message: `Couldn’t remove the sample data. ${errorMessage(error)}` }),
  });

  const onFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      importData.reset();
      setPendingImport(await readSnapshotFile(file));
    } catch (error) {
      toast({ tone: 'error', message: `Couldn’t read that file. ${fileErrorMessage(error)}` });
    }
  };

  return (
    <div className="page page--narrow">
      <header className="page-header">
        <h1 tabIndex={-1}>Settings and data</h1>
        <p className="lede">See where {config.appName} keeps its data, and move it in or out.</p>
      </header>

      <section aria-labelledby="storage-heading" className="section">
        <h2 id="storage-heading" className="section__title">
          Storage
        </h2>
        {provider.capabilities.shared ? (
          <p>
            Data is stored in a shared backend (<code>{provider.id}</code>). Everyone using this app sees the same sessions and
            topics; who may change them is decided by that backend’s permissions.
          </p>
        ) : (
          <p>
            <strong>Local mode.</strong> Sessions, topics and preferences are stored in this browser only. Other people and other
            browsers don’t see them, and clearing site data deletes them. Export a copy to keep a backup or to move to a shared
            backend later.
          </p>
        )}
        <p className="meta">
          {summary.isPending ? 'Counting records…' : summary.isError ? 'Couldn’t count records.' : `${summary.data.records} records stored.`}
        </p>
      </section>

      <section aria-labelledby="export-heading" className="section">
        <h2 id="export-heading" className="section__title">
          Export and import
        </h2>
        <p>The export is a JSON file with every session, topic request, past session and preference.</p>
        <div className="row-actions row-actions--start">
          <button type="button" className="button" onClick={() => exportData.mutate()} disabled={exportData.isPending}>
            {exportData.isPending ? <Spinner /> : <ArrowDownloadRegular />}
            Export data
          </button>
          <button type="button" className="button" onClick={() => fileInput.current?.click()} disabled={importData.isPending}>
            <ArrowUploadRegular />
            Import data…
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => void onFileChosen(e)} />
        </div>
      </section>

      {sampleCount > 0 && (
        <section aria-labelledby="sample-heading" className="section">
          <h2 id="sample-heading" className="section__title">
            Sample data
          </h2>
          <p>
            {sampleCount} fictional past {sampleCount === 1 ? 'session was' : 'sessions were'} added on first run so the app isn’t
            empty. Removing them is permanent; they won’t be added again.
          </p>
          <button type="button" className="button" onClick={() => removeSamples.mutate()} disabled={removeSamples.isPending}>
            {removeSamples.isPending && <Spinner />}
            Remove sample data
          </button>
        </section>
      )}

      <ConfirmDialog
        open={pendingImport !== null}
        title="Replace your data with this file?"
        message={
          <p>
            The file has {pendingImport ? countRecords(pendingImport) : 0} records. Importing replaces the sessions, topics, past
            sessions and preferences currently stored{provider.capabilities.shared ? '' : ' in this browser'}.
          </p>
        }
        confirmLabel="Replace data"
        danger
        busy={importData.isPending}
        error={importData.isError ? fileErrorMessage(importData.error) : undefined}
        onConfirm={() => pendingImport && importData.mutate(pendingImport)}
        onCancel={() => setPendingImport(null)}
      />
    </div>
  );
}
