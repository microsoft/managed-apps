/**
 * Typed app configuration, read once from `import.meta.env.VITE_*`.
 *
 * Every value has a safe default so the app runs with no `.env` at all. Copy
 * `.env.example` to `.env.local` to override them. Nothing here is a secret:
 * Vite inlines `VITE_*` values into the client bundle.
 */

export interface AppConfig {
  /** Display name used in the page title and header. */
  appName: string;
  /**
   * Web origin of the GitHub instance the connector talks to. Used only to build
   * "open on GitHub" links when the API response doesn't include a URL.
   */
  githubHost: string;
  /**
   * Shareable URL of the deployed app (as printed by `npx ms app play`). Deep links
   * append their query to it. Empty means "links point at the current page".
   */
  appUrl: string;
  /** Base URL of the player used for local development links. */
  devPlayerUrl: string;
  /** Storage provider id registered in `src/storage/index.ts`. */
  storageProvider: string;
  /** Prefix that isolates this app's browser storage from other apps on the same origin. */
  storagePrefix: string;
}

type Env = Record<string, string | boolean | undefined>;

function read(env: Env, key: string, fallback: string): string {
  const value = env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function origin(value: string, fallback: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.origin : fallback;
  } catch {
    return fallback;
  }
}

/** Builds the config from an env object. Exported for tests. */
export function buildConfig(env: Env): AppConfig {
  return {
    appName: read(env, 'VITE_APP_NAME', 'CodeFlow'),
    githubHost: origin(read(env, 'VITE_GITHUB_HOST', 'https://github.com'), 'https://github.com'),
    appUrl: read(env, 'VITE_APP_URL', ''),
    devPlayerUrl: read(env, 'VITE_DEV_PLAYER_URL', 'https://play.preview.managedapps.cloud.microsoft'),
    storageProvider: read(env, 'VITE_STORAGE_PROVIDER', 'local'),
    storagePrefix: read(env, 'VITE_APP_STORAGE_PREFIX', 'codeflow'),
  };
}

export const config: AppConfig = buildConfig(import.meta.env as unknown as Env);

/** Version from package.json, injected by Vite at build time. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
