import { describe, expect, it } from 'vitest';
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  MAX_FULL_FILE_LINE_LIMIT,
  MAX_REFRESH_SECONDS,
  MAX_SETTINGS_FONT_SIZE,
  MIN_FULL_FILE_LINE_LIMIT,
  MIN_REFRESH_SECONDS,
  MIN_SETTINGS_FONT_SIZE,
  normalizeSettings,
  THEME_NAMES,
} from '../settings';
import {
  MAX_FULL_FILE_LINES,
  NO_FULL_FILE_LINE_LIMIT,
} from '../../utils/fullFileBudget';
import { CODE_FONT_NAMES } from '../codeFont';

describe('normalizeSettings', () => {
  it('returns the defaults for anything that is not an object', () => {
    for (const input of [undefined, null, 'nope', 42, []]) {
      expect(normalizeSettings(input)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('does not share the nested filter object with the defaults', () => {
    const a = normalizeSettings(undefined);
    a.summaryFilters.active = false;
    expect(DEFAULT_SETTINGS.summaryFilters.active).toBe(true);
    expect(normalizeSettings(undefined).summaryFilters.active).toBe(true);
  });

  it('keeps recognised values', () => {
    const result = normalizeSettings({
      theme: 'dark',
      bugSwarm: true,
      defaultViewMode: 'split',
      defaultFontSize: 16,
      codeFont: 'consolas',
      codeLigatures: false,
      ignoreWhitespace: false,
      diffSide: 'left',
      diffSearch: { caseSensitive: true, wholeWord: false, regex: true },
      hideSeenFiles: true,
      summaryOpenByDefault: false,
      summaryFilters: { active: true, resolved: false, closed: false },
      refreshIntervalSeconds: 60,
      syntaxHighlight: false,
      markdownPreview: false,
    });

    expect(result).toEqual({
      theme: 'dark',
      bugSwarm: true,
      dogfoodTheme: false,
      defaultViewMode: 'split',
      defaultFullFile: true,
      fullFileLineLimit: MAX_FULL_FILE_LINES,
      defaultFontSize: 16,
      codeFont: 'consolas',
      codeLigatures: false,
      ignoreWhitespace: false,
      wordDiff: true,
      diffSide: 'left',
      diffSearch: { caseSensitive: true, wholeWord: false, regex: true },
      hideSeenFiles: true,
      summaryOpenByDefault: false,
      summaryFilters: { active: true, resolved: false, closed: false },
      autoFlagOpenedPrs: true,
      refreshIntervalSeconds: 60,
      syntaxHighlight: false,
      markdownPreview: false,
      selectionHighlight: true,
    });
  });

  it('previews Markdown by default and ignores a non-boolean', () => {
    expect(DEFAULT_SETTINGS.markdownPreview).toBe(true);
    expect(normalizeSettings({}).markdownPreview).toBe(true);
    expect(normalizeSettings({ markdownPreview: 'yes' }).markdownPreview).toBe(true);
    expect(normalizeSettings({ markdownPreview: false }).markdownPreview).toBe(false);
  });

  it('shows both diff sides by default and rejects an unknown mode', () => {
    expect(DEFAULT_SETTINGS.diffSide).toBe('both');
    expect(normalizeSettings({}).diffSide).toBe('both');
    expect(normalizeSettings({ diffSide: 'sideways' }).diffSide).toBe('both');
    expect(normalizeSettings({ diffSide: 'right' }).diffSide).toBe('right');
  });

  it('shows the whole file by default and ignores a non-boolean', () => {
    expect(DEFAULT_SETTINGS.defaultFullFile).toBe(true);
    expect(normalizeSettings({}).defaultFullFile).toBe(true);
    expect(normalizeSettings({ defaultFullFile: 'yes' }).defaultFullFile).toBe(true);
    expect(normalizeSettings({ defaultFullFile: false }).defaultFullFile).toBe(false);
  });

  it('starts the full-file budget where the viewer does', () => {
    expect(DEFAULT_SETTINGS.fullFileLineLimit).toBe(MAX_FULL_FILE_LINES);
    expect(normalizeSettings({}).fullFileLineLimit).toBe(MAX_FULL_FILE_LINES);
  });

  it('keeps "always expand" rather than clamping it up to the floor', () => {
    expect(normalizeSettings({ fullFileLineLimit: NO_FULL_FILE_LINE_LIMIT }).fullFileLineLimit)
      .toBe(NO_FULL_FILE_LINE_LIMIT);
  });

  it('clamps a full-file budget outside the offered range', () => {
    expect(normalizeSettings({ fullFileLineLimit: 5 }).fullFileLineLimit)
      .toBe(MIN_FULL_FILE_LINE_LIMIT);
    expect(normalizeSettings({ fullFileLineLimit: 1_000_000 }).fullFileLineLimit)
      .toBe(MAX_FULL_FILE_LINE_LIMIT);
    expect(normalizeSettings({ fullFileLineLimit: -20 }).fullFileLineLimit)
      .toBe(MIN_FULL_FILE_LINE_LIMIT);
  });

  it('falls back to the default budget for a value that is not a number', () => {
    expect(normalizeSettings({ fullFileLineLimit: 'lots' }).fullFileLineLimit)
      .toBe(DEFAULT_SETTINGS.fullFileLineLimit);
  });

  it('starts find-in-file with every toggle off and drops non-boolean toggles', () => {
    expect(normalizeSettings({}).diffSearch).toEqual({
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    expect(normalizeSettings({ diffSearch: 'nope' }).diffSearch).toEqual({
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    expect(
      normalizeSettings({ diffSearch: { regex: 'yes', wholeWord: true } }).diffSearch,
    ).toEqual({ caseSensitive: false, wholeWord: true, regex: false });
  });

  it('does not share the nested search options with the defaults', () => {
    const a = normalizeSettings(undefined);
    a.diffSearch.regex = true;
    expect(DEFAULT_SETTINGS.diffSearch.regex).toBe(false);
    expect(normalizeSettings(undefined).diffSearch.regex).toBe(false);
  });

  it('auto-flags opened PRs by default, and only stops on an explicit false', () => {
    expect(DEFAULT_SETTINGS.autoFlagOpenedPrs).toBe(true);
    expect(normalizeSettings({}).autoFlagOpenedPrs).toBe(true);
    expect(normalizeSettings({ autoFlagOpenedPrs: 'yes' }).autoFlagOpenedPrs).toBe(true);
    expect(normalizeSettings({ autoFlagOpenedPrs: false }).autoFlagOpenedPrs).toBe(false);
  });

  it('keeps the bug swarm off until it is explicitly asked for', () => {
    expect(DEFAULT_SETTINGS.bugSwarm).toBe(false);
    expect(normalizeSettings({}).bugSwarm).toBe(false);
    expect(normalizeSettings({ bugSwarm: 'yes' }).bugSwarm).toBe(false);
    expect(normalizeSettings({ bugSwarm: true }).bugSwarm).toBe(true);
  });

  it('keeps the dogfood theme out of the picker until it is asked for', () => {
    expect(DEFAULT_SETTINGS.dogfoodTheme).toBe(false);
    expect(normalizeSettings({}).dogfoodTheme).toBe(false);
    expect(normalizeSettings({ dogfoodTheme: 'woof' }).dogfoodTheme).toBe(false);
    expect(normalizeSettings({ dogfoodTheme: true }).dogfoodTheme).toBe(true);
  });

  // Revealing the option and wearing it are separate decisions, so a document
  // that has one must never imply the other.
  it('keeps the reveal switch independent of the theme in use', () => {
    expect(normalizeSettings({ dogfoodTheme: true }).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(normalizeSettings({ theme: 'dogfood' }).dogfoodTheme).toBe(false);
    expect(normalizeSettings({ theme: 'dogfood' }).theme).toBe('dogfood');
  });

  it('hides whitespace-only changes by default, so a failed read never looks like "turned off"', () => {
    expect(DEFAULT_SETTINGS.ignoreWhitespace).toBe(true);
    expect(normalizeSettings({}).ignoreWhitespace).toBe(true);
    expect(normalizeSettings({ ignoreWhitespace: 'off' }).ignoreWhitespace).toBe(true);
    expect(normalizeSettings({ ignoreWhitespace: false }).ignoreWhitespace).toBe(false);
  });

  it('highlights changed words by default, and only stops on an explicit false', () => {
    expect(DEFAULT_SETTINGS.wordDiff).toBe(true);
    expect(normalizeSettings({}).wordDiff).toBe(true);
    expect(normalizeSettings({ wordDiff: 'off' }).wordDiff).toBe(true);
    expect(normalizeSettings({ wordDiff: false }).wordDiff).toBe(false);
  });

  it('echoes the word you select by default, and only stops on an explicit false', () => {
    expect(DEFAULT_SETTINGS.selectionHighlight).toBe(true);
    expect(normalizeSettings({}).selectionHighlight).toBe(true);
    expect(normalizeSettings({ selectionHighlight: 'off' }).selectionHighlight).toBe(true);
    expect(normalizeSettings({ selectionHighlight: false }).selectionHighlight).toBe(false);
  });

  it('falls back per field rather than discarding the whole document', () => {
    const result = normalizeSettings({
      theme: 'neon',
      defaultViewMode: 'sideways',
      hideSeenFiles: true,
    });

    expect(result.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(result.defaultViewMode).toBe(DEFAULT_SETTINGS.defaultViewMode);
    // The one good field still survives.
    expect(result.hideSeenFiles).toBe(true);
  });

  it('accepts every shipped theme', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('dark');
    for (const theme of THEME_NAMES) {
      expect(normalizeSettings({ theme }).theme).toBe(theme);
    }
  });

  it('clamps the font size into the supported range', () => {
    expect(normalizeSettings({ defaultFontSize: 2 }).defaultFontSize).toBe(MIN_SETTINGS_FONT_SIZE);
    expect(normalizeSettings({ defaultFontSize: 99 }).defaultFontSize).toBe(MAX_SETTINGS_FONT_SIZE);
    expect(normalizeSettings({ defaultFontSize: 13.4 }).defaultFontSize).toBe(13);
    expect(normalizeSettings({ defaultFontSize: 'big' }).defaultFontSize).toBe(
      DEFAULT_SETTINGS.defaultFontSize,
    );
  });

  it('preserves the existing font and ligature behavior for older documents', () => {
    expect(normalizeSettings({})).toMatchObject({
      codeFont: 'default',
      codeLigatures: true,
    });
  });

  it('accepts every offered source code font', () => {
    for (const codeFont of CODE_FONT_NAMES) {
      expect(normalizeSettings({ codeFont }).codeFont).toBe(codeFont);
    }
  });

  it('drops invalid font settings without discarding other preferences', () => {
    for (const codeFont of ['unknown', 'inherit', '"Injected"; color: red', null, 3, {}]) {
      expect(normalizeSettings({ codeFont, codeLigatures: 'off', defaultFontSize: 18 }))
        .toMatchObject({ codeFont: 'default', codeLigatures: true, defaultFontSize: 18 });
    }
  });

  it('polls an open PR every five minutes out of the box', () => {
    expect(DEFAULT_SETTINGS.refreshIntervalSeconds).toBe(300);
    expect(normalizeSettings({}).refreshIntervalSeconds).toBe(300);
  });

  it('still lets a reviewer pick a shorter cadence than the default', () => {
    expect(normalizeSettings({ refreshIntervalSeconds: 15 }).refreshIntervalSeconds).toBe(15);
  });

  it('clamps the refresh cadence but lets 0 through as "off"', () => {
    expect(normalizeSettings({ refreshIntervalSeconds: 0 }).refreshIntervalSeconds).toBe(0);
    expect(normalizeSettings({ refreshIntervalSeconds: 3 }).refreshIntervalSeconds).toBe(
      MIN_REFRESH_SECONDS,
    );
    expect(normalizeSettings({ refreshIntervalSeconds: 99_999 }).refreshIntervalSeconds).toBe(
      MAX_REFRESH_SECONDS,
    );
    expect(normalizeSettings({ refreshIntervalSeconds: 'often' }).refreshIntervalSeconds).toBe(
      DEFAULT_SETTINGS.refreshIntervalSeconds,
    );
  });

  it('tolerates a malformed summaryFilters value', () => {
    expect(normalizeSettings({ summaryFilters: 'all' }).summaryFilters).toEqual(
      DEFAULT_SETTINGS.summaryFilters,
    );
    expect(normalizeSettings({ summaryFilters: { active: false } }).summaryFilters).toEqual({
      active: false,
      resolved: true,
      closed: true,
    });
  });
});

describe('applySettingsPatch', () => {
  it('leaves untouched fields alone', () => {
    const base = normalizeSettings({ defaultFontSize: 18, wordDiff: false });
    const next = applySettingsPatch(base, { hideSeenFiles: true });

    expect(next.defaultFontSize).toBe(18);
    expect(next.wordDiff).toBe(false);
    expect(next.hideSeenFiles).toBe(true);
  });

  it('merges summary filters instead of replacing them', () => {
    const base = normalizeSettings(undefined);
    const next = applySettingsPatch(base, { summaryFilters: { closed: false } });

    expect(next.summaryFilters).toEqual({ active: true, resolved: true, closed: false });
  });

  it('merges find-in-file toggles instead of replacing them', () => {
    const base = normalizeSettings(undefined);
    const next = applySettingsPatch(base, { diffSearch: { regex: true } });

    expect(next.diffSearch).toEqual({ caseSensitive: false, wholeWord: false, regex: true });
  });

  it('normalises the patched value', () => {
    const next = applySettingsPatch(normalizeSettings(undefined), { defaultFontSize: 400 });
    expect(next.defaultFontSize).toBe(MAX_SETTINGS_FONT_SIZE);
  });

  it('does not mutate the document it was given', () => {
    const base = normalizeSettings(undefined);
    applySettingsPatch(base, { hideSeenFiles: true, summaryFilters: { active: false } });

    expect(base.hideSeenFiles).toBe(false);
    expect(base.summaryFilters.active).toBe(true);
  });
});
