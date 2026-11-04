import { useEffect } from 'react';
import { z } from 'zod';
import type { KeyValueStore } from '../storage/core';
import { useKeyValue } from '../storage/core/hooks';
import { useAppStorage } from '../storage/useAppStorage';

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = 'theme';
export const themeSchema = z.enum(['system', 'light', 'dark']);

export function readStoredTheme(prefs: KeyValueStore): ThemeChoice {
  try {
    return prefs.get(THEME_KEY, themeSchema) ?? 'system';
  } catch {
    return 'system';
  }
}

/** Applies the theme to <html>. No attribute means "follow the system". */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** The theme preference, kept in the `prefs` key/value store (this device for local storage). */
export function useThemePreference() {
  const { prefs } = useAppStorage();
  const [theme, setStored] = useKeyValue<ThemeChoice>(prefs, THEME_KEY, themeSchema, 'system');

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (choice: ThemeChoice) => {
    try {
      setStored(choice === 'system' ? undefined : choice);
    } catch {
      // Storage can be full or blocked; the choice still applies until the page reloads.
      applyTheme(choice);
    }
  };

  return { theme, setTheme };
}
