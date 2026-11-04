/**
 * The user settings document.
 *
 * Settings are a per-reviewer preference document, distinct from the review
 * state in `utils/storage`: they say how the app should behave rather than what
 * the reviewer has already looked at. They are stored as one value in the
 * `prefs` key/value namespace (see `settings/settingsStore`).
 *
 * Everything here is pure so it can be exercised without a browser or a server.
 */

import {
  DEFAULT_DIFF_SIDE,
  isDiffSideMode,
  type DiffSideMode,
} from '../utils/diffSide';
import {
  MAX_FULL_FILE_LINES,
  NO_FULL_FILE_LINE_LIMIT,
} from '../utils/fullFileBudget';
import { CODE_FONT_NAMES, type CodeFont } from './codeFont';

/**
 * Theme preference. `system` follows the host OS rather than pinning a palette,
 * and is resolved to a concrete theme at paint time — see `settings/theme`.
 *
 * `dogfood` is an easter egg: it is a real, persisted preference, but the
 * settings panel only lists it once {@link AppSettings.dogfoodTheme} is on, so
 * it stays something you opt into rather than a fourth thing to scan past.
 */
export type ThemeName = 'dark' | 'light' | 'system' | 'dogfood';

/** A theme that can actually be painted; `system` always resolves to one of these. */
export type ResolvedTheme = 'dark' | 'light' | 'dogfood';

export const THEME_NAMES: readonly ThemeName[] = ['dark', 'light', 'system', 'dogfood'];

export type SettingsViewMode = 'inline' | 'split';

/** Filters applied to the comment summary panel when a PR is first opened. */
export interface SummaryFilterSettings {
  active: boolean;
  resolved: boolean;
  closed: boolean;
}

/** Toggles on the diff viewer's find-in-file widget. */
export interface DiffSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface AppSettings {
  /* --- General --- */
  theme: ThemeName;
  /**
   * Send a swarm of insects flying across the screen whenever a comment
   * appears.
   *
   * Off by default for the same reason as the companion above: surprise
   * animation over someone's code review has to be asked for, not sprung on
   * them. A reviewer who has told their OS to keep motion down never gets it
   * regardless of this.
   */
  bugSwarm: boolean;
  /**
   * Offer the hidden `dogfood` palette as a fourth option in the theme picker.
   *
   * Turning it on only *reveals* the choice — it never switches the theme for
   * you, so nobody flips a switch labelled "show me this" and finds the whole
   * app has gone pink. Turning it back off leaves a reviewer who is actually
   * wearing dogfood able to take it off again: the picker keeps listing the
   * theme it is currently set to.
   */
  dogfoodTheme: boolean;

  /* --- PRs --- */
  /** Diff layout a PR opens with. */
  defaultViewMode: SettingsViewMode;
  /**
   * Open each file expanded to its whole contents rather than to the changed
   * hunks alone. On by default, because reviewing a change with none of its
   * surroundings is guesswork.
   *
   * Like `diffSide` and unlike whitespace or word diff, this is not a per-file
   * default: the toolbar's Full file / Diff only button writes straight back
   * here. How much of a file you want to see is a way of reading, not a property
   * of the file in front of you, so the choice follows the reviewer from file to
   * file, from PR to PR, instead of resetting on
   * every reload.
   */
  defaultFullFile: boolean;
  /**
   * How long a file may be before expanding it waits for a second, deliberate
   * click — see `utils/fullFileBudget` for what the expansion costs.
   *
   * {@link NO_FULL_FILE_LINE_LIMIT} means never wait: a reviewer who works in
   * long files and would rather wait for the render than click through the
   * warning every time can say so once, here.
   */
  fullFileLineLimit: number;
  /** Starting code font size in the diff viewer, in px. */
  defaultFontSize: number;
  /** Installed monospace font used for source code, without changing UI text. */
  codeFont: CodeFont;
  /** Allow fonts to combine source characters into ligatures such as !=. */
  codeLigatures: boolean;
  /**
   * Fold changes that are only whitespace — line endings, indentation, trailing
   * spaces — into context lines, so an editor that rewrote a file's line endings
   * doesn't bury the real edit. On by default; the diff toolbar can override it
   * per file, and the viewer always says when something is being hidden.
   */
  ignoreWhitespace: boolean;
  /**
   * Highlight the words that actually changed within a rewritten line, rather
   * than colouring the whole line. On by default; like whitespace, the diff
   * toolbar can override it per file.
   */
  wordDiff: boolean;
  /**
   * Colour code by language in the diff viewer. On by default; a file whose
   * language isn't recognised simply renders plain. Turning it off is the
   * remedy if the tokens fight with the red and green change backgrounds, or
   * if a very large file feels slower than it should.
   */
  syntaxHighlight: boolean;
  /**
   * Render Markdown files as formatted prose instead of raw source, with the
   * change carried onto each paragraph, heading and list item. On by default,
   * because raw Markdown is the one case where the source is harder to review
   * than the result; the diff toolbar can override it per file.
   */
  markdownPreview: boolean;
  /**
   * Light up the other occurrences of a word when you select it in the diff, so
   * you can see where an identifier is used without opening find. On by
   * default; it goes quiet while the find widget is open, which owns the same
   * highlight layer.
   */
  selectionHighlight: boolean;
  /**
   * Which side(s) of the diff are shown. Unlike whitespace and word diff this
   * is not a per-file default: the toolbar's cycle button writes straight back
   * here, so the choice follows the reviewer from file to file, from PR to PR,
   *.
   */
  diffSide: DiffSideMode;
  /**
   * Last-used find-in-file toggles. Remembered rather than reset on every
   * search, so a reviewer who works in regex stays in regex.
   */
  diffSearch: DiffSearchOptions;
  /** Start the file list with already-seen files hidden. */
  hideSeenFiles: boolean;
  /** Start the comment summary panel expanded. */
  summaryOpenByDefault: boolean;
  /** Which comment buckets are ticked when the summary first renders. */
  summaryFilters: SummaryFilterSettings;
  /** Flag every open PR you load in the viewer so it shows up under Flagged. */
  autoFlagOpenedPrs: boolean;
  /**
   * Background poll cadence for an open PR, in seconds. `0` disables polling.
   *
   * Defaults to five minutes: an open PR polls for as long as it is on screen,
   * so a tighter cadence costs the API far more than it buys a reviewer, who
   * notices new activity the moment they touch the page anyway. Anyone who
   * wants it snappier can pick a shorter cadence in settings.
   */
  refreshIntervalSeconds: number;
}

export const MIN_REFRESH_SECONDS = 10;
export const MAX_REFRESH_SECONDS = 600;

export const MIN_SETTINGS_FONT_SIZE = 8;
export const MAX_SETTINGS_FONT_SIZE = 24;

/**
 * Bounds on the full-file line budget, either side of
 * {@link NO_FULL_FILE_LINE_LIMIT}, which is offered as its own choice.
 *
 * The floor keeps a stored `1` from making the warning universal, which would
 * read as the expansion being broken rather than as a budget.
 */
export const MIN_FULL_FILE_LINE_LIMIT = 100;
export const MAX_FULL_FILE_LINE_LIMIT = 50_000;

/** How much one press of the diff viewer's zoom buttons moves the font size. */
export const SETTINGS_FONT_SIZE_STEP = 1;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  bugSwarm: false,
  dogfoodTheme: false,
  defaultViewMode: 'inline',
  defaultFullFile: true,
  fullFileLineLimit: MAX_FULL_FILE_LINES,
  defaultFontSize: 12,
  codeFont: 'default',
  codeLigatures: true,
  ignoreWhitespace: true,
  wordDiff: true,
  syntaxHighlight: true,
  markdownPreview: true,
  selectionHighlight: true,
  diffSide: DEFAULT_DIFF_SIDE,
  diffSearch: { caseSensitive: false, wholeWord: false, regex: false },
  hideSeenFiles: false,
  summaryOpenByDefault: true,
  summaryFilters: { active: true, resolved: true, closed: true },
  autoFlagOpenedPrs: true,
  refreshIntervalSeconds: 300,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Coerce an arbitrary stored document into a complete `AppSettings`.
 *
 * Stored settings can hold documents written by an older (or newer) build. Anything unrecognised
 * falls back to the default rather than failing, so one bad field can never lock
 * a reviewer out of the app.
 */
export function normalizeSettings(raw: unknown): AppSettings {
  // Re-enter with an empty document rather than spreading the defaults, so every
  // nested object below is freshly built and a caller can never mutate
  // `DEFAULT_SETTINGS` through the result.
  if (!isRecord(raw)) return normalizeSettings({});

  const filters = isRecord(raw.summaryFilters) ? raw.summaryFilters : {};
  const search = isRecord(raw.diffSearch) ? raw.diffSearch : {};

  return {
    theme: oneOf(raw.theme, THEME_NAMES, DEFAULT_SETTINGS.theme),
    bugSwarm: bool(raw.bugSwarm, DEFAULT_SETTINGS.bugSwarm),
    dogfoodTheme: bool(raw.dogfoodTheme, DEFAULT_SETTINGS.dogfoodTheme),
    defaultViewMode: oneOf(
      raw.defaultViewMode,
      ['inline', 'split'] as const,
      DEFAULT_SETTINGS.defaultViewMode,
    ),
    defaultFullFile: bool(raw.defaultFullFile, DEFAULT_SETTINGS.defaultFullFile),
    // `NO_FULL_FILE_LINE_LIMIT` means "never hold a file back", so like the
    // refresh cadence it has to survive the clamp that keeps the rest sane.
    fullFileLineLimit:
      raw.fullFileLineLimit === NO_FULL_FILE_LINE_LIMIT
        ? NO_FULL_FILE_LINE_LIMIT
        : clampedInt(
            raw.fullFileLineLimit,
            DEFAULT_SETTINGS.fullFileLineLimit,
            MIN_FULL_FILE_LINE_LIMIT,
            MAX_FULL_FILE_LINE_LIMIT,
          ),
    defaultFontSize: clampedInt(
      raw.defaultFontSize,
      DEFAULT_SETTINGS.defaultFontSize,
      MIN_SETTINGS_FONT_SIZE,
      MAX_SETTINGS_FONT_SIZE,
    ),
    codeFont: oneOf(raw.codeFont, CODE_FONT_NAMES, DEFAULT_SETTINGS.codeFont),
    codeLigatures: bool(raw.codeLigatures, DEFAULT_SETTINGS.codeLigatures),
    ignoreWhitespace: bool(raw.ignoreWhitespace, DEFAULT_SETTINGS.ignoreWhitespace),
    wordDiff: bool(raw.wordDiff, DEFAULT_SETTINGS.wordDiff),
    syntaxHighlight: bool(raw.syntaxHighlight, DEFAULT_SETTINGS.syntaxHighlight),
    markdownPreview: bool(raw.markdownPreview, DEFAULT_SETTINGS.markdownPreview),
    selectionHighlight: bool(raw.selectionHighlight, DEFAULT_SETTINGS.selectionHighlight),
    diffSide: isDiffSideMode(raw.diffSide) ? raw.diffSide : DEFAULT_SETTINGS.diffSide,
    diffSearch: {
      caseSensitive: bool(search.caseSensitive, DEFAULT_SETTINGS.diffSearch.caseSensitive),
      wholeWord: bool(search.wholeWord, DEFAULT_SETTINGS.diffSearch.wholeWord),
      regex: bool(search.regex, DEFAULT_SETTINGS.diffSearch.regex),
    },
    hideSeenFiles: bool(raw.hideSeenFiles, DEFAULT_SETTINGS.hideSeenFiles),
    summaryOpenByDefault: bool(
      raw.summaryOpenByDefault,
      DEFAULT_SETTINGS.summaryOpenByDefault,
    ),
    summaryFilters: {
      active: bool(filters.active, DEFAULT_SETTINGS.summaryFilters.active),
      resolved: bool(filters.resolved, DEFAULT_SETTINGS.summaryFilters.resolved),
      closed: bool(filters.closed, DEFAULT_SETTINGS.summaryFilters.closed),
    },
    autoFlagOpenedPrs: bool(raw.autoFlagOpenedPrs, DEFAULT_SETTINGS.autoFlagOpenedPrs),
    // `0` means "never poll", so it has to survive the clamp that otherwise
    // keeps the cadence sane.
    refreshIntervalSeconds:
      raw.refreshIntervalSeconds === 0
        ? 0
        : clampedInt(
            raw.refreshIntervalSeconds,
            DEFAULT_SETTINGS.refreshIntervalSeconds,
            MIN_REFRESH_SECONDS,
            MAX_REFRESH_SECONDS,
          ),
  };
}

/**
 * A partial change to the settings document.
 *
 * The two nested objects accept partials of their own, because
 * {@link applySettingsPatch} shallow-merges them onto the current values — a
 * caller flipping one comment-summary filter or one find-in-file toggle should
 * not have to restate its siblings.
 */
export type SettingsPatch = Partial<Omit<AppSettings, 'summaryFilters' | 'diffSearch'>> & {
  summaryFilters?: Partial<SummaryFilterSettings>;
  diffSearch?: Partial<DiffSearchOptions>;
};

/** Apply a partial change on top of a settings document, re-normalising the result. */
export function applySettingsPatch(base: AppSettings, patch: SettingsPatch): AppSettings {
  return normalizeSettings({
    ...base,
    ...patch,
    summaryFilters: { ...base.summaryFilters, ...(patch.summaryFilters ?? {}) },
    diffSearch: { ...base.diffSearch, ...(patch.diffSearch ?? {}) },
  });
}
