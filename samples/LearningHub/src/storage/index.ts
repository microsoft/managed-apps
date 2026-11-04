import { config as appConfig, type AppConfig } from '../config';
import { logger } from '../lib/logger';
import { allCollections, KV_NAMESPACES, PAST_SESSIONS, SESSIONS, TOPICS, type PastSessionData, type SessionData, type TopicData } from './collections';
import { createLocalProvider, type Collection, type KeyValueStore, type StorageProvider, type StorageWarningHandler } from './core';

/** Storage warnings (quarantined records, blocked storage) go to the dev logger, without payloads. */
const onWarning: StorageWarningHandler = (message) => logger.warn(message);

/**
 * Provider registry. The key is the value of `VITE_STORAGE_PROVIDER`. To add a backend
 * (SharePoint, Dataverse, a REST API, …) follow `.github/skills/add-data-source/SKILL.md`:
 * implement `src/storage/providers/<name>.ts` and add one entry here.
 */
export const providers: Record<string, () => StorageProvider> = {
  local: () => createLocalProvider({ prefix: appConfig.storagePrefix, onWarning }),
};

/** Creates the provider selected by configuration, falling back to `local` for unknown names. */
export function createStorage(config: Pick<AppConfig, 'storageProvider'> = appConfig): StorageProvider {
  const factory = providers[config.storageProvider];
  if (!factory) {
    logger.warn(`Unknown storage provider "${config.storageProvider}"; using local storage.`);
    return providers.local();
  }
  return factory();
}

/** Typed handles to every collection and key/value namespace the app uses. */
export interface AppStorage {
  provider: StorageProvider;
  sessions: Collection<SessionData>;
  topics: Collection<TopicData>;
  pastSessions: Collection<PastSessionData>;
  /** User preferences such as the theme. */
  prefs: KeyValueStore;
  /** Small app flags, such as whether sample data was seeded. */
  app: KeyValueStore;
  /** Navigation memory used to restore the route after a reload. */
  nav: KeyValueStore;
}

const opened = new WeakMap<StorageProvider, AppStorage>();

/**
 * Binds the app's collections to a provider (memoized per provider). Registering every collection
 * up front lets export/import validate all of them.
 */
export function openAppStorage(provider: StorageProvider): AppStorage {
  const existing = opened.get(provider);
  if (existing) return existing;
  for (const definition of allCollections) provider.collection(definition);
  const storage: AppStorage = {
    provider,
    sessions: provider.collection(SESSIONS),
    topics: provider.collection(TOPICS),
    pastSessions: provider.collection(PAST_SESSIONS),
    prefs: provider.kv(KV_NAMESPACES.prefs),
    app: provider.kv(KV_NAMESPACES.app),
    nav: provider.kv(KV_NAMESPACES.nav),
  };
  opened.set(provider, storage);
  return storage;
}
