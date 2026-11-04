import { describe, it, expect, afterEach, vi } from 'vitest';
import { prefersReducedMotion } from '../motion';

const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');

function setMatchMedia(impl: unknown) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: impl,
  });
}

afterEach(() => {
  if (original) Object.defineProperty(window, 'matchMedia', original);
  else Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'matchMedia');
});

describe('prefersReducedMotion', () => {
  it('reports the preference when the host has one', () => {
    setMatchMedia(vi.fn(() => ({ matches: true })));
    expect(prefersReducedMotion()).toBe(true);

    setMatchMedia(vi.fn(() => ({ matches: false })));
    expect(prefersReducedMotion()).toBe(false);
  });

  it('asks about reduced motion specifically', () => {
    const matchMedia = vi.fn(() => ({ matches: false }));
    setMatchMedia(matchMedia);
    prefersReducedMotion();
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('says nothing was asked for when the host has no matchMedia at all', () => {
    setMatchMedia(undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('survives an engine that throws on an unknown query', () => {
    setMatchMedia(
      vi.fn(() => {
        throw new Error('unsupported media query');
      }),
    );
    expect(prefersReducedMotion()).toBe(false);
  });
});
