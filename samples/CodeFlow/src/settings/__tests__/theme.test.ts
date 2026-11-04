import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyThemeToDocument,
  prefersDarkScheme,
  resolveTheme,
  watchSystemTheme,
} from '../theme';

/** Install a fake `matchMedia` and hand back the listener plumbing for assertions. */
function stubMatchMedia(options: {
  matches?: boolean;
  modern?: boolean;
  legacy?: boolean;
  throws?: boolean;
}) {
  const { matches = false, modern = true, legacy = false, throws = false } = options;
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  const addListener = vi.fn();
  const removeListener = vi.fn();

  const query: Record<string, unknown> = { matches };
  if (modern) {
    query.addEventListener = addEventListener;
    query.removeEventListener = removeEventListener;
  }
  if (legacy) {
    query.addListener = addListener;
    query.removeListener = removeListener;
  }

  const matchMedia = vi.fn(() => {
    if (throws) throw new Error('unsupported query');
    return query as unknown as MediaQueryList;
  });
  vi.stubGlobal('matchMedia', matchMedia);

  return { matchMedia, addEventListener, removeEventListener, addListener, removeListener };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
});

describe('resolveTheme', () => {
  it('passes fixed themes straight through, whatever the OS says', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('follows the OS for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('prefersDarkScheme', () => {
  it('reports what the media query matches', () => {
    stubMatchMedia({ matches: true });
    expect(prefersDarkScheme()).toBe(true);

    stubMatchMedia({ matches: false });
    expect(prefersDarkScheme()).toBe(false);
  });

  it('asks for the dark query specifically', () => {
    const { matchMedia } = stubMatchMedia({ matches: true });
    prefersDarkScheme();
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  });

  it('falls back to dark when the host has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersDarkScheme()).toBe(true);
  });

  it('falls back to dark when the query throws', () => {
    stubMatchMedia({ throws: true });
    expect(prefersDarkScheme()).toBe(true);
  });
});

describe('applyThemeToDocument', () => {
  it('paints both the attribute and the native colour scheme', () => {
    applyThemeToDocument('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');

    applyThemeToDocument('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});

describe('watchSystemTheme', () => {
  it('reports flips through the modern listener API and detaches on unsubscribe', () => {
    const { addEventListener, removeEventListener } = stubMatchMedia({ matches: false });
    const onChange = vi.fn();

    const stop = watchSystemTheme(onChange);
    expect(addEventListener).toHaveBeenCalledTimes(1);

    const handler = addEventListener.mock.calls[0][1] as (e: MediaQueryListEvent) => void;
    handler({ matches: true } as MediaQueryListEvent);
    expect(onChange).toHaveBeenCalledWith(true);

    stop();
    expect(removeEventListener).toHaveBeenCalledWith('change', handler);
  });

  it('falls back to the deprecated listener API', () => {
    const { addListener, removeListener } = stubMatchMedia({ modern: false, legacy: true });
    const onChange = vi.fn();

    const stop = watchSystemTheme(onChange);
    expect(addListener).toHaveBeenCalledTimes(1);

    const handler = addListener.mock.calls[0][0] as (e: MediaQueryListEvent) => void;
    handler({ matches: false } as MediaQueryListEvent);
    expect(onChange).toHaveBeenCalledWith(false);

    stop();
    expect(removeListener).toHaveBeenCalledWith(handler);
  });

  it('returns a safe no-op when the host cannot watch', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => watchSystemTheme(vi.fn())()).not.toThrow();

    stubMatchMedia({ throws: true });
    expect(() => watchSystemTheme(vi.fn())()).not.toThrow();

    stubMatchMedia({ modern: false });
    expect(() => watchSystemTheme(vi.fn())()).not.toThrow();
  });
});
