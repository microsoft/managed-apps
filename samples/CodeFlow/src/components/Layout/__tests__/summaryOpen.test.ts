import { describe, it, expect } from 'vitest';
import { loadSummaryOpen, SUMMARY_KEY_PREFIX } from '../../../utils/preferences';
import { appStorage } from '../../../storage';

describe('loadSummaryOpen', () => {
  it('returns true when prKey is undefined', () => {
    expect(loadSummaryOpen(undefined)).toBe(true);
  });

  it('returns true when nothing is stored for the PR', () => {
    expect(loadSummaryOpen('owner/repo#1')).toBe(true);
  });

  it('returns false when stored as "false"', () => {
    appStorage().ui.set(SUMMARY_KEY_PREFIX + 'owner/repo#5', false);
    expect(loadSummaryOpen('owner/repo#5')).toBe(false);
  });

  it('returns true when stored as "true"', () => {
    appStorage().ui.set(SUMMARY_KEY_PREFIX + 'owner/repo#5', true);
    expect(loadSummaryOpen('owner/repo#5')).toBe(true);
  });

  it('isolates state per PR key', () => {
    appStorage().ui.set(SUMMARY_KEY_PREFIX + 'owner/repo#1', false);
    expect(loadSummaryOpen('owner/repo#1')).toBe(false);
    expect(loadSummaryOpen('owner/repo#2')).toBe(true);
  });
});
