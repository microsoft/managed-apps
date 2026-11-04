import { describe, expect, it } from 'vitest';
import { openingSplashTarget } from '../splashTarget';
import type { PrCoordinates } from '../../../types';

const coords: PrCoordinates = { owner: 'octo-org', name: 'octo-repo', number: 123 };

describe('openingSplashTarget', () => {
  it('names the PR while a dashboard-initiated load runs', () => {
    expect(openingSplashTarget('loading', coords, false)).toEqual({
      owner: 'octo-org',
      repo: 'octo-repo',
      number: 123,
    });
  });

  it('stays out of the way on the dashboard', () => {
    expect(openingSplashTarget('idle', undefined, false)).toBeNull();
  });

  it('stays out of the way once the PR is ready', () => {
    expect(openingSplashTarget('ready', coords, true)).toBeNull();
  });

  it('stays out of the way when the load failed', () => {
    expect(openingSplashTarget('error', undefined, false)).toBeNull();
  });

  it('does not interrupt a reviewer when polling reloads the open PR', () => {
    expect(openingSplashTarget('loading', coords, true)).toBeNull();
  });
});
