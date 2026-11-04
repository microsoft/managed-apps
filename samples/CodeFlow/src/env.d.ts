/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_GITHUB_HOST?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_DEV_PLAYER_URL?: string;
  readonly VITE_STORAGE_PROVIDER?: string;
  readonly VITE_APP_STORAGE_PREFIX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
