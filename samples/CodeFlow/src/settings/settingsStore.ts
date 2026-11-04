/**
 * The live user settings document.
 *
 * Settings are stored as one value under `settings` in the `prefs` key/value
 * namespace of app storage. Reads are synchronous — components read settings
 * during render, often to seed `useState` — so the current document is cached in
 * memory and re-read whenever storage reports a change (another tab, or app
 * storage being replaced).
 *
 * Concurrency: the most recent deliberate edit wins. Settings are a single small
 * document the reviewer edits by hand, so there is nothing meaningful to merge.
 */

import { z } from 'zod';
import { appStorage, onStorageReset } from '../storage';
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
  type SettingsPatch,
} from './settings';
import { applyCodeFontToDocument } from './codeFont';
import {
  applyThemeToDocument,
  prefersDarkScheme,
  resolveTheme,
  watchSystemTheme,
} from './theme';

export const SETTINGS_KEY = 'settings';

/** Stored settings are validated leniently: `normalizeSettings` repairs bad fields. */
const storedSettingsSchema = z.record(z.string(), z.unknown());

let current: AppSettings | undefined;
let unsubscribeStore: (() => void) | undefined;

/* ------------------------------ Change feed ----------------------------- */

let revision = 0;
const subscribers = new Set<() => void>();

function emitChange(): void {
  revision += 1;
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      /* a bad subscriber must not break settings */
    }
  }
}

export function subscribeToSettings(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getSettingsRevision(): number {
  return revision;
}

/* -------------------------------- Effects ------------------------------- */

/** Push settings that other subsystems need to observe (theme, code font). */
function applyEffects(settings: AppSettings): void {
  applyThemeToDocument(resolveTheme(settings.theme, prefersDarkScheme()));
  applyCodeFontToDocument(settings.codeFont, settings.codeLigatures);
}

/* ------------------------------- Loading -------------------------------- */

function readStored(): AppSettings {
  try {
    return normalizeSettings(appStorage().prefs.get(SETTINGS_KEY, storedSettingsSchema));
  } catch {
    return normalizeSettings(undefined);
  }
}

function load(): AppSettings {
  if (current) return current;
  current = readStored();
  unsubscribeStore?.();
  unsubscribeStore = appStorage().prefs.subscribe((key) => {
    if (key !== SETTINGS_KEY) return;
    const next = readStored();
    if (current && JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    applyEffects(next);
    emitChange();
  });
  return current;
}

onStorageReset(() => {
  unsubscribeStore?.();
  unsubscribeStore = undefined;
  current = undefined;
  emitChange();
});

/** The live settings document. Safe to call during render. */
export function getSettings(): AppSettings {
  return load();
}

/**
 * Apply the stored theme and font to the document and keep `system` in step
 * with the OS colour scheme. Call once at startup.
 */
export function startSettingsEffects(): void {
  applyEffects(load());
  watchSystemTheme((prefersDark) => {
    applyThemeToDocument(resolveTheme(load().theme, prefersDark));
  });
}

/** Apply a settings change; it is persisted immediately. */
export function updateSettings(patch: SettingsPatch): AppSettings {
  const next = applySettingsPatch(load(), patch);
  current = next;
  try {
    appStorage().prefs.set(SETTINGS_KEY, next);
  } catch {
    /* storage full or unavailable — the in-memory copy still holds */
  }
  applyEffects(next);
  emitChange();
  return next;
}

/** Restore every setting to its shipped default. */
export function resetSettings(): AppSettings {
  return updateSettings(DEFAULT_SETTINGS);
}

/** Test seam: drop the cached document and every subscriber. */
export function resetSettingsStoreForTests(): void {
  subscribers.clear();
  unsubscribeStore?.();
  unsubscribeStore = undefined;
  current = undefined;
  revision = 0;
  try {
    appStorage().prefs.remove(SETTINGS_KEY);
  } catch {
    /* nothing to clear */
  }
  applyEffects(load());
}
