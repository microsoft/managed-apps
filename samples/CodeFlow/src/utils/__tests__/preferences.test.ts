import { describe, it, expect } from 'vitest';
import {
  loadSidebarWidth,
  SIDEBAR_KEY,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  loadSummaryHeight,
  saveSummaryHeight,
  clampSummaryHeight,
  SUMMARY_HEIGHT_KEY,
  DEFAULT_SUMMARY_HEIGHT,
  MIN_SUMMARY_HEIGHT,
  MAX_SUMMARY_HEIGHT,
  MIN_WORKAREA_HEIGHT,
} from '../preferences';
import { z } from 'zod';
import { appStorage } from '../../storage';

describe('loadSidebarWidth', () => {
  it('returns the default when nothing is stored', () => {
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it('returns a valid stored width', () => {
    appStorage().ui.set(SIDEBAR_KEY, 420);
    expect(loadSidebarWidth()).toBe(420);
  });

  it('accepts the min and max bounds', () => {
    appStorage().ui.set(SIDEBAR_KEY, MIN_SIDEBAR_WIDTH);
    expect(loadSidebarWidth()).toBe(MIN_SIDEBAR_WIDTH);
    appStorage().ui.set(SIDEBAR_KEY, MAX_SIDEBAR_WIDTH);
    expect(loadSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH);
  });

  it('falls back to default when the stored value is out of range', () => {
    appStorage().ui.set(SIDEBAR_KEY, MAX_SIDEBAR_WIDTH + 100);
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
    appStorage().ui.set(SIDEBAR_KEY, MIN_SIDEBAR_WIDTH - 50);
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it('falls back to default when the stored value is not a number', () => {
    appStorage().ui.set(SIDEBAR_KEY, 'not-a-number');
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});

describe('clampSummaryHeight', () => {
  it('leaves a height inside the bounds alone', () => {
    expect(clampSummaryHeight(300)).toBe(300);
  });

  it('holds the panel to its minimum and maximum', () => {
    expect(clampSummaryHeight(MIN_SUMMARY_HEIGHT - 80)).toBe(MIN_SUMMARY_HEIGHT);
    expect(clampSummaryHeight(MAX_SUMMARY_HEIGHT + 500)).toBe(MAX_SUMMARY_HEIGHT);
  });

  it('leaves the diff room when the window is the tighter bound', () => {
    expect(clampSummaryHeight(700, 600)).toBe(600 - MIN_WORKAREA_HEIGHT);
  });

  it('still honours the minimum on a window too short for it', () => {
    expect(clampSummaryHeight(500, 100)).toBe(MIN_SUMMARY_HEIGHT);
  });
});

describe('loadSummaryHeight', () => {
  it('returns the default when nothing is stored', () => {
    expect(loadSummaryHeight()).toBe(DEFAULT_SUMMARY_HEIGHT);
  });

  it('returns a valid stored height', () => {
    appStorage().ui.set(SUMMARY_HEIGHT_KEY, 420);
    expect(loadSummaryHeight()).toBe(420);
  });

  it('falls back to default when the stored value is out of range or junk', () => {
    appStorage().ui.set(SUMMARY_HEIGHT_KEY, MAX_SUMMARY_HEIGHT + 100);
    expect(loadSummaryHeight()).toBe(DEFAULT_SUMMARY_HEIGHT);
    appStorage().ui.set(SUMMARY_HEIGHT_KEY, MIN_SUMMARY_HEIGHT - 50);
    expect(loadSummaryHeight()).toBe(DEFAULT_SUMMARY_HEIGHT);
    appStorage().ui.set(SUMMARY_HEIGHT_KEY, 'not-a-number');
    expect(loadSummaryHeight()).toBe(DEFAULT_SUMMARY_HEIGHT);
  });
});

describe('saveSummaryHeight', () => {
  it('rounds and stores a height that loads back unchanged', () => {
    saveSummaryHeight(317.6);
    expect(appStorage().ui.get(SUMMARY_HEIGHT_KEY, z.unknown())).toBe(318);
    expect(loadSummaryHeight()).toBe(318);
  });

  it('never stores a height the loader would then reject', () => {
    saveSummaryHeight(MAX_SUMMARY_HEIGHT + 1000);
    expect(loadSummaryHeight()).toBe(MAX_SUMMARY_HEIGHT);
  });
});
