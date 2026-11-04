/**
 * App configuration. Every value comes from a `VITE_*` environment variable (see `.env.example`)
 * and falls back to a neutral default, so the app runs with no configuration at all.
 */

export interface AppConfig {
  /** Product name in the top bar and browser tab. */
  appName: string;
  /** Name of the session series, used as the home page heading. */
  seriesName: string;
  seriesDescription: string;
  /** Day of the week sessions happen on: 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Wall-clock start and end time (HH:MM, 24-hour) in `timeZone`. */
  startTime: string;
  endTime: string;
  /** IANA time zone the series runs in, e.g. `America/Los_Angeles`. */
  timeZone: string;
  /** Last date of the series (yyyy-mm-dd), or '' for an open-ended series. */
  endDate: string;
  /** How many weeks ahead the sign-up list shows. */
  weeksAhead: number;
  /** Dates (yyyy-mm-dd) on the cadence that are marked as holiday weeks. */
  skipDates: string[];
  /** Key of the storage provider registry in `src/storage/index.ts`. */
  storageProvider: string;
  /** Prefix that isolates this app's browser data from other apps on the same origin. */
  storagePrefix: string;
  /** Public URL of the deployed app, used for share links. '' derives it from the host page. */
  publicAppUrl: string;
  /** Seed a few fictional past sessions on first run (local storage only). */
  seedSampleData: boolean;
  /** Problems found while reading the environment; defaults were used instead. */
  warnings: string[];
}

export type EnvSource = Record<string, string | boolean | undefined>;

export const DEFAULT_CONFIG: Omit<AppConfig, 'warnings'> = {
  appName: 'Learning Hub',
  seriesName: 'Learning Series',
  seriesDescription: 'Weekly sessions where people share what they’ve learned. Catch up on past sessions and see what’s next.',
  weekday: 4,
  startTime: '09:00',
  endTime: '10:00',
  timeZone: 'America/Los_Angeles',
  endDate: '',
  weeksAhead: 12,
  skipDates: [],
  storageProvider: 'local',
  storagePrefix: 'learninghub',
  publicAppUrl: '',
  seedSampleData: true,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PREFIX = /^[A-Za-z0-9_-]{1,40}$/;

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Parses `env` into a config. Invalid values fall back to defaults and are reported in `warnings`. */
export function readConfig(env: EnvSource): AppConfig {
  const warnings: string[] = [];

  function text(name: string, fallback: string, valid: (v: string) => boolean = () => true): string {
    const raw = env[name];
    if (typeof raw !== 'string' || raw.trim() === '') return fallback;
    const value = raw.trim();
    if (valid(value)) return value;
    warnings.push(`${name} is invalid; using the default.`);
    return fallback;
  }

  function integer(name: string, fallback: number, min: number, max: number): number {
    const value = text(name, String(fallback), (v) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max);
    return Number(value);
  }

  function flag(name: string, fallback: boolean): boolean {
    const value = text(name, String(fallback), (v) => /^(true|false|1|0)$/i.test(v)).toLowerCase();
    return value === 'true' || value === '1';
  }

  const startTime = text('VITE_SERIES_START_TIME', DEFAULT_CONFIG.startTime, (v) => TIME.test(v));
  let endTime = text('VITE_SERIES_END_TIME', DEFAULT_CONFIG.endTime, (v) => TIME.test(v));
  if (endTime <= startTime) {
    warnings.push('VITE_SERIES_END_TIME must be after the start time; using one hour later.');
    const [h, m] = startTime.split(':').map(Number);
    endTime = h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const skipRaw = text('VITE_SERIES_SKIP_DATES', '');
  const skipDates = skipRaw
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => {
      if (DATE.test(d)) return true;
      warnings.push(`VITE_SERIES_SKIP_DATES contains an invalid date and it was ignored.`);
      return false;
    });

  return {
    appName: text('VITE_APP_NAME', DEFAULT_CONFIG.appName),
    seriesName: text('VITE_SERIES_NAME', DEFAULT_CONFIG.seriesName),
    seriesDescription: text('VITE_SERIES_DESCRIPTION', DEFAULT_CONFIG.seriesDescription),
    weekday: integer('VITE_SERIES_WEEKDAY', DEFAULT_CONFIG.weekday, 0, 6),
    startTime,
    endTime,
    timeZone: text('VITE_SERIES_TIME_ZONE', DEFAULT_CONFIG.timeZone, isTimeZone),
    endDate: text('VITE_SERIES_END_DATE', DEFAULT_CONFIG.endDate, (v) => DATE.test(v)),
    weeksAhead: integer('VITE_SERIES_WEEKS_AHEAD', DEFAULT_CONFIG.weeksAhead, 1, 104),
    skipDates,
    storageProvider: text('VITE_STORAGE_PROVIDER', DEFAULT_CONFIG.storageProvider, (v) => /^[a-z][a-z0-9-]*$/i.test(v)),
    storagePrefix: text('VITE_APP_STORAGE_PREFIX', DEFAULT_CONFIG.storagePrefix, (v) => PREFIX.test(v)),
    publicAppUrl: text('VITE_PUBLIC_APP_URL', DEFAULT_CONFIG.publicAppUrl, isHttpsUrl),
    seedSampleData: flag('VITE_SEED_SAMPLE_DATA', DEFAULT_CONFIG.seedSampleData),
    warnings,
  };
}

export const config: AppConfig = readConfig(import.meta.env);
