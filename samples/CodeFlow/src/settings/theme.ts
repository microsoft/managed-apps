/**
 * Turning a theme *preference* into the theme that is actually painted.
 *
 * The stylesheet only ever knows about *concrete* palettes — `dark`, `light` and
 * the hidden `dogfood` — keyed off `data-theme` on the document element.
 * `system` is therefore resolved here rather than in CSS, so a single attribute
 * drives every rule and the app can also set `color-scheme` (which controls
 * native widgets and scrollbars) to a concrete value.
 */

import type { ResolvedTheme, ThemeName } from './settings';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Which native colour scheme each palette sits closest to. Dogfood is a bright
 * pink, so the browser should draw its scrollbars and form controls light.
 */
const NATIVE_SCHEME: Record<ResolvedTheme, 'dark' | 'light'> = {
  dark: 'dark',
  light: 'light',
  dogfood: 'light',
};

/** Does the host currently ask for a dark palette? Defaults to dark when unknown. */
export function prefersDarkScheme(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    // Older engines throw on unsupported queries; dark is the app's heritage look.
    return true;
  }
}

/** Collapse a preference to the palette that should be painted right now. */
export function resolveTheme(theme: ThemeName, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

/**
 * Paint a resolved theme onto the document.
 *
 * `color-scheme` is set alongside `data-theme` so form controls, scrollbars and
 * the canvas the browser paints before our CSS lands all match the palette.
 */
export function applyThemeToDocument(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = NATIVE_SCHEME[theme];
}

/**
 * Watch the OS colour scheme, invoking `onChange` whenever it flips.
 *
 * Returns a no-op unsubscribe when the environment has no `matchMedia`, so
 * callers never need to branch.
 */
export function watchSystemTheme(onChange: (prefersDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  let query: MediaQueryList;
  try {
    query = window.matchMedia(DARK_QUERY);
  } catch {
    return () => {};
  }

  const handler = (event: MediaQueryListEvent) => onChange(event.matches);

  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }
  // Safari < 14 and jsdom only expose the deprecated listener API.
  if (typeof query.addListener === 'function') {
    query.addListener(handler);
    return () => query.removeListener?.(handler);
  }
  return () => {};
}
