import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  getSettings,
  getSettingsRevision,
  resetSettings,
  resetSettingsStoreForTests,
  SETTINGS_KEY,
  subscribeToSettings,
  updateSettings,
} from '../settingsStore';
import { DEFAULT_SETTINGS } from '../settings';
import { CODE_FONT_NAMES } from '../codeFont';
import { appStorage, resetAppStorageForTests } from '../../storage';

const stored = () => appStorage().prefs.get(SETTINGS_KEY, z.record(z.string(), z.unknown()));

beforeEach(() => {
  resetSettingsStoreForTests();
});

describe('reads', () => {
  it('starts from the defaults when nothing is stored', () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a stored document from the prefs namespace', () => {
    appStorage().prefs.set(SETTINGS_KEY, { ...DEFAULT_SETTINGS, theme: 'light', defaultFontSize: 16 });
    resetSettingsStoreForTests();
    // resetSettingsStoreForTests clears the key, so seed again after it.
    appStorage().prefs.set(SETTINGS_KEY, { ...DEFAULT_SETTINGS, theme: 'light', defaultFontSize: 16 });
    expect(getSettings().theme).toBe('light');
    expect(getSettings().defaultFontSize).toBe(16);
  });

  it('repairs a stored document with bad fields instead of failing', () => {
    appStorage().prefs.set(SETTINGS_KEY, { theme: 'neon', defaultFontSize: 'huge' });
    expect(getSettings().theme).toBe(DEFAULT_SETTINGS.theme);
    expect(getSettings().defaultFontSize).toBe(DEFAULT_SETTINGS.defaultFontSize);
  });

  it('reloads when app storage is replaced', () => {
    updateSettings({ theme: 'light' });
    resetAppStorageForTests();
    expect(getSettings().theme).toBe(DEFAULT_SETTINGS.theme);
  });
});

describe('writes', () => {
  it('applies a change in memory immediately and persists it', () => {
    updateSettings({ defaultFontSize: 18 });
    expect(getSettings().defaultFontSize).toBe(18);
    expect(stored()).toMatchObject({ defaultFontSize: 18 });
  });

  it('merges partial nested patches', () => {
    updateSettings({ summaryFilters: { resolved: false } });
    expect(getSettings().summaryFilters).toEqual({ active: true, resolved: false, closed: true });
  });

  it('notifies subscribers and bumps the revision', () => {
    const listener = vi.fn();
    const before = getSettingsRevision();
    const unsubscribe = subscribeToSettings(listener);
    updateSettings({ wordDiff: false });
    expect(listener).toHaveBeenCalled();
    expect(getSettingsRevision()).toBeGreaterThan(before);
    unsubscribe();
  });

  it('picks up a change written by another tab', () => {
    const listener = vi.fn();
    subscribeToSettings(listener);
    getSettings();
    appStorage().prefs.set(SETTINGS_KEY, { ...DEFAULT_SETTINGS, theme: 'light' });
    expect(getSettings().theme).toBe('light');
    expect(listener).toHaveBeenCalled();
  });

  it('resets every setting to its default', () => {
    updateSettings({ theme: 'light', wordDiff: false });
    resetSettings();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(stored()).toMatchObject({ theme: DEFAULT_SETTINGS.theme, wordDiff: true });
  });
});

describe('effects', () => {
  it('paints the theme onto the document', () => {
    updateSettings({ theme: 'light' });
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('applies the code font to the document', () => {
    const font = CODE_FONT_NAMES.find((f) => f !== 'default') ?? CODE_FONT_NAMES[0];
    updateSettings({ codeFont: font });
    expect(getSettings().codeFont).toBe(font);
  });
});
