/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_SERIES_NAME?: string;
  readonly VITE_SERIES_DESCRIPTION?: string;
  readonly VITE_SERIES_WEEKDAY?: string;
  readonly VITE_SERIES_START_TIME?: string;
  readonly VITE_SERIES_END_TIME?: string;
  readonly VITE_SERIES_TIME_ZONE?: string;
  readonly VITE_SERIES_END_DATE?: string;
  readonly VITE_SERIES_WEEKS_AHEAD?: string;
  readonly VITE_SERIES_SKIP_DATES?: string;
  readonly VITE_STORAGE_PROVIDER?: string;
  readonly VITE_APP_STORAGE_PREFIX?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_SEED_SAMPLE_DATA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
