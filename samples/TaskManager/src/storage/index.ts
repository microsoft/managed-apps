import { appConfig } from "@/config";
import { createLogger } from "@/lib/logger";
import {
  createLocalProvider,
  createMemoryProvider,
  type StorageProvider,
} from "./core";

export * from "./collections";

const log = createLogger("storage");

/**
 * Storage providers this app can use, keyed by `VITE_STORAGE_PROVIDER`.
 * Add a shared backend (SharePoint, Dataverse, your own API) with the
 * `add-data-source` skill: implement `src/storage/providers/<name>.ts` and
 * register its factory here.
 */
export const providerRegistry: Record<string, () => StorageProvider> = {
  local: () =>
    createLocalProvider({
      prefix: appConfig.storage.prefix,
      onWarning: (message) => log.warn(message),
    }),
  memory: () => createMemoryProvider({ prefix: appConfig.storage.prefix }),
};

/** Creates the provider selected by `VITE_STORAGE_PROVIDER` (default `local`). */
export function createStorage(providerId: string = appConfig.storage.provider): StorageProvider {
  const factory = providerRegistry[providerId];
  if (!factory) {
    log.warn(`Unknown storage provider "${providerId}"; falling back to local.`);
    return providerRegistry.local();
  }
  return factory();
}
