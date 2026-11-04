import { describe, it, expect } from 'vitest';
import { loadSplitRatio, SPLIT_KEY } from '../../../utils/preferences';
import { appStorage } from '../../../storage';

describe('loadSplitRatio', () => {
  it('returns 50 when nothing is stored', () => {
    expect(loadSplitRatio()).toBe(50);
  });

  it('returns stored value when within range', () => {
    appStorage().ui.set(SPLIT_KEY, 65);
    expect(loadSplitRatio()).toBe(65);
  });

  it('returns default when below minimum (20)', () => {
    appStorage().ui.set(SPLIT_KEY, 10);
    expect(loadSplitRatio()).toBe(50);
  });

  it('returns default when above maximum (80)', () => {
    appStorage().ui.set(SPLIT_KEY, 90);
    expect(loadSplitRatio()).toBe(50);
  });

  it('returns default when stored value is not a number', () => {
    appStorage().ui.set(SPLIT_KEY, 'wide');
    expect(loadSplitRatio()).toBe(50);
  });

  it('accepts boundary values', () => {
    appStorage().ui.set(SPLIT_KEY, 20);
    expect(loadSplitRatio()).toBe(20);

    appStorage().ui.set(SPLIT_KEY, 80);
    expect(loadSplitRatio()).toBe(80);
  });
});
