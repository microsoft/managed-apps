import { describe, it, expect } from 'vitest';
import { isSyncedBackend } from '../commentBackend';

describe('isSyncedBackend', () => {
  it('treats the GitHub store label as synced', () => {
    expect(isSyncedBackend('GitHub (synced)')).toBe(true);
  });

  it('treats the local fallback label as not synced', () => {
    expect(isSyncedBackend('Local (this device)')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSyncedBackend('github')).toBe(true);
  });

  it('handles an empty label', () => {
    expect(isSyncedBackend('')).toBe(false);
  });
});
