import { useStorageProvider } from './core/hooks';
import { openAppStorage, type AppStorage } from './index';

/** The app's typed storage handles for the provider passed to `<StorageRoot>`. */
export function useAppStorage(): AppStorage {
  return openAppStorage(useStorageProvider());
}
