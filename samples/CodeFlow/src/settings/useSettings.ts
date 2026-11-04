import { useCallback, useSyncExternalStore } from 'react';
import {
  getSettings,
  getSettingsRevision,
  resetSettings,
  subscribeToSettings,
  updateSettings,
} from './settingsStore';
import type { AppSettings, SettingsPatch } from './settings';

export interface UseSettings {
  settings: AppSettings;
  update: (patch: SettingsPatch) => void;
  reset: () => void;
}

/**
 * Subscribe to the live settings document.
 *
 * The revision counter — rather than the settings object — is the external
 * snapshot, because the store hands back a stable reference and `useSyncExternalStore`
 * requires a value that is cheap to compare.
 */
export function useSettings(): UseSettings {
  useSyncExternalStore(subscribeToSettings, getSettingsRevision, getSettingsRevision);

  const update = useCallback((patch: SettingsPatch) => {
    updateSettings(patch);
  }, []);

  const reset = useCallback(() => {
    resetSettings();
  }, []);

  return { settings: getSettings(), update, reset };
}
