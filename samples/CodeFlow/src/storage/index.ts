import {
  createLocalProvider,
  createMemoryProvider,
  storageErrorMessage,
  type Collection,
  type KeyValueStore,
  type StorageProvider,
  type StorageWarningHandler,
} from './core';
import { config } from '../config';
import { createLogger } from '../lib/logger';
import {
  approvalsCollection,
  feedbackCollection,
  feedbackCommentsCollection,
  prNotesCollection,
  reviewStateCollection,
  type Approval,
  type FeedbackCommentRecord,
  type FeedbackRecord,
  type PrNotes,
  type ReviewState,
} from './collections';
import { createCollectionMirror, type CollectionMirror } from './mirror';
import { createSessionKv } from './providers/session';

export * from './collections';
export type { CollectionMirror } from './mirror';

const log = createLogger('storage');

/* ------------------------------ Provider registry ------------------------------ */

export interface ProviderFactoryOptions {
  /** Key prefix / namespace for this app's data. */
  prefix: string;
  onWarning: StorageWarningHandler;
}

export type ProviderFactory = (options: ProviderFactoryOptions) => StorageProvider;

/**
 * Every storage backend the app can use, keyed by the value of
 * `VITE_STORAGE_PROVIDER`. Add a shared backend (SharePoint, Dataverse, an API…)
 * by implementing it in `src/storage/providers/` and registering it here — see
 * `.github/skills/add-data-source/SKILL.md`.
 */
export const storageProviders: Record<string, ProviderFactory> = {
  local: ({ prefix, onWarning }) => createLocalProvider({ prefix, onWarning }),
  memory: ({ prefix, onWarning }) => createMemoryProvider({ prefix, onWarning }),
};

/** Creates the provider selected by configuration (default: `local`). */
export function createStorage(
  options: { provider?: string; prefix?: string } = {},
): StorageProvider {
  const id = options.provider ?? config.storageProvider;
  const prefix = options.prefix ?? config.storagePrefix;
  const factory = storageProviders[id];
  if (!factory) {
    throw new Error(
      `Unknown storage provider "${id}". Registered providers: ${Object.keys(storageProviders).join(', ')}.`,
    );
  }
  return factory({ prefix, onWarning: reportStorageNotice });
}

/* --------------------------------- Notices ------------------------------------ */

let notice: string | undefined;
const noticeListeners = new Set<() => void>();

/** Records a user-facing storage problem (quota, blocked storage, failed save). */
export function reportStorageNotice(message: string): void {
  notice = message;
  log.warn(message);
  for (const listener of [...noticeListeners]) listener();
}

export function getStorageNotice(): string | undefined {
  return notice;
}

export function dismissStorageNotice(): void {
  notice = undefined;
  for (const listener of [...noticeListeners]) listener();
}

export function subscribeStorageNotice(listener: () => void): () => void {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}

/* -------------------------------- App storage --------------------------------- */

/** Everything the app persists, opened over one provider. */
export interface AppStorage {
  provider: StorageProvider;
  reviewState: CollectionMirror<ReviewState>;
  prNotes: CollectionMirror<PrNotes>;
  approvals: Collection<Approval>;
  feedback: Collection<FeedbackRecord>;
  feedbackComments: Collection<FeedbackCommentRecord>;
  /** Settings and pinned repositories. */
  prefs: KeyValueStore;
  /** Unsent comment text. */
  drafts: KeyValueStore;
  /** Pane sizes and other layout state. */
  ui: KeyValueStore;
  /** Tab-scoped state that survives a reload of the same tab only. */
  session: KeyValueStore;
}

function openAppStorage(provider: StorageProvider, session: KeyValueStore): AppStorage {
  const onWriteError = (error: unknown) => reportStorageNotice(storageErrorMessage(error));
  return {
    provider,
    reviewState: createCollectionMirror(provider.collection(reviewStateCollection), { onWriteError }),
    prNotes: createCollectionMirror(provider.collection(prNotesCollection), { onWriteError }),
    approvals: provider.collection(approvalsCollection),
    feedback: provider.collection(feedbackCollection),
    feedbackComments: provider.collection(feedbackCommentsCollection),
    prefs: provider.kv('prefs'),
    drafts: provider.kv('drafts'),
    ui: provider.kv('ui'),
    session,
  };
}

let current: AppStorage | undefined;
let generation = 0;
const resetListeners = new Set<() => void>();

function install(storage: AppStorage): AppStorage {
  current = storage;
  generation += 1;
  for (const listener of [...resetListeners]) listener();
  return storage;
}

let listening = false;

function listenForLifecycle(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  // Shared backends don't push changes; pick up other people's edits on focus.
  window.addEventListener('focus', () => {
    const refreshable = current?.provider as (StorageProvider & { refresh?: () => void }) | undefined;
    refreshable?.refresh?.();
  });
  const flush = () => {
    void current?.reviewState.flush();
    void current?.prNotes.flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/**
 * Opens app storage over `provider` (default: the configured one) and loads the
 * review-state mirrors. Call once before rendering, and again after an import
 * so every cached view reloads.
 */
export async function initAppStorage(provider: StorageProvider = createStorage()): Promise<AppStorage> {
  const storage = install(openAppStorage(provider, current?.session ?? createSessionKv(`${config.storagePrefix}-tab`)));
  await Promise.all([storage.reviewState.ready(), storage.prNotes.ready()]);
  listenForLifecycle();
  return storage;
}

/** The open app storage. Falls back to a non-persistent store if not initialised. */
export function appStorage(): AppStorage {
  if (!current) {
    const prefix = config.storagePrefix;
    const memory = createMemoryProvider({ prefix });
    install(openAppStorage(memory, createMemoryProvider({ prefix: `${prefix}-tab` }).kv('session')));
  }
  return current as AppStorage;
}

/** Increments whenever app storage is replaced, so module caches can reload. */
export function storageGeneration(): number {
  return generation;
}

export function onStorageReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
}

/** Test seam: replace app storage with a fresh in-memory provider. */
export function resetAppStorageForTests(provider: StorageProvider = createMemoryProvider({ prefix: 'test' })): AppStorage {
  notice = undefined;
  return install(openAppStorage(provider, createMemoryProvider({ prefix: 'test-tab' }).kv('session')));
}
