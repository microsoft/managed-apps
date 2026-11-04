import { describe, it, expect, vi, afterEach } from 'vitest';
import { initials, avatarHue, avatarColors, relativeTime, absoluteTime, timeTitle } from '../format';

const ISO = '2024-03-05T14:30:00Z';

describe('relativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(now: string) {
    vi.setSystemTime(new Date(now));
  }

  it('returns an empty string for a missing or unparseable date', () => {
    expect(relativeTime(undefined)).toBe('');
    expect(relativeTime('')).toBe('');
    expect(relativeTime('not a date')).toBe('');
  });

  it('counts seconds, minutes, hours and days', () => {
    vi.useFakeTimers();
    at('2024-03-05T14:30:30Z');
    expect(relativeTime(ISO)).toBe('just now');
    at('2024-03-05T14:35:00Z');
    expect(relativeTime(ISO)).toBe('5m ago');
    at('2024-03-05T16:30:00Z');
    expect(relativeTime(ISO)).toBe('2h ago');
    at('2024-03-08T14:30:00Z');
    expect(relativeTime(ISO)).toBe('3d ago');
  });

  it('falls back to a plain date once it is more than a month old', () => {
    vi.useFakeTimers();
    at('2024-06-05T14:30:00Z');
    expect(relativeTime(ISO)).not.toMatch(/ago/);
  });
});

describe('absoluteTime', () => {
  it('returns an empty string for a missing or unparseable date', () => {
    expect(absoluteTime(undefined)).toBe('');
    expect(absoluteTime('')).toBe('');
    expect(absoluteTime('not a date')).toBe('');
  });

  it('names the year, so a hovered "2h ago" is never ambiguous', () => {
    const d = new Date(ISO);
    const text = absoluteTime(ISO);
    expect(text).toContain(String(d.getFullYear()));
    expect(text).toContain(String(d.getDate()));
  });

  it('includes a time of day, not just the date', () => {
    expect(absoluteTime(ISO)).toMatch(/\d{1,2}[:.]\d{2}/);
  });
});

describe('timeTitle', () => {
  it('is undefined when there is nothing to show, so no empty tooltip renders', () => {
    expect(timeTitle(undefined)).toBeUndefined();
    expect(timeTitle('')).toBeUndefined();
    expect(timeTitle('not a date')).toBeUndefined();
  });

  it('is the absolute time when the date is good', () => {
    expect(timeTitle(ISO)).toBe(absoluteTime(ISO));
  });
});

describe('initials', () => {
  it('returns ? for empty input', () => {
    expect(initials(undefined)).toBe('?');
    expect(initials('')).toBe('?');
  });

  it('uses the first letter of a single-part name', () => {
    expect(initials('octocat')).toBe('OC');
    expect(initials('@octocat')).toBe('OC');
  });

  it('combines first and last part initials', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('mona.lisa.octocat')).toBe('MO');
  });
});

describe('avatarHue', () => {
  it('is deterministic for the same seed', () => {
    expect(avatarHue('octocat')).toBe(avatarHue('octocat'));
  });

  it('stays within the 0-359 hue range', () => {
    for (const seed of ['a', 'octocat', 'Ada Lovelace', 'ZZZZ', '12345', '']) {
      const hue = avatarHue(seed);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('produces different hues for different seeds', () => {
    expect(avatarHue('alice')).not.toBe(avatarHue('bob'));
  });

  it('returns 0 for empty/undefined seeds', () => {
    expect(avatarHue(undefined)).toBe(0);
    expect(avatarHue('')).toBe(0);
  });
});

describe('avatarColors', () => {
  it('returns a deterministic hsl background with white text', () => {
    const a = avatarColors('octocat');
    const b = avatarColors('octocat');
    expect(a).toEqual(b);
    expect(a.color).toBe('#fff');
    expect(a.background).toMatch(/^hsl\(\d+, 55%, 42%\)$/);
  });
});
