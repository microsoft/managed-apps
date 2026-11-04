import { describe, it, expect } from 'vitest';
import { checkLink } from '../checkLinks';
import type { PrCheck, PrCoordinates } from '../../../types';

const COORDS: PrCoordinates = { owner: 'octo-org', name: 'octo-repo', number: 123 };

function check(over: Partial<PrCheck> = {}): PrCheck {
  return {
    id: '42',
    name: 'Build',
    outcome: 'success',
    rawState: 'SUCCESS',
    kind: 'check',
    ...over,
  };
}

describe('checkLink', () => {
  it('points a check run at its own page on GitHub', () => {
    expect(checkLink(check(), COORDS)).toBe(
      'https://github.com/octo-org/octo-repo/pull/123/checks' +
        '?check_run_id=42',
    );
  });

  it('prefers the PR URL we already hold over rebuilding one', () => {
    expect(checkLink(check(), COORDS, 'https://github.com/o/r/pull/7')).toBe(
      'https://github.com/o/r/pull/7/checks?check_run_id=42',
    );
  });

  it('tolerates a trailing slash on the PR URL', () => {
    expect(checkLink(check(), COORDS, 'https://github.com/o/r/pull/7/')).toContain(
      '/pull/7/checks?check_run_id=42',
    );
  });

  it('falls back to the checks tab when the row has no usable id', () => {
    expect(checkLink(check({ id: 'Build' }), COORDS)).toBe(
      'https://github.com/octo-org/octo-repo/pull/123/checks',
    );
  });

  it('ignores a check run detailsUrl, which may be a placeholder', () => {
    const link = checkLink(check({ detailsUrl: 'https://www.example.com' }), COORDS);
    expect(link).not.toContain('www.example.com');
  });

  it('sends a legacy status to the target its reporter set', () => {
    const status = check({
      kind: 'status',
      id: 'ai-review',
      detailsUrl: 'https://github.com/octo-org/x/actions/runs/9',
    });
    expect(checkLink(status, COORDS)).toBe('https://github.com/octo-org/x/actions/runs/9');
  });

  it('refuses an unsafe status target', () => {
    expect(checkLink(check({ kind: 'status', detailsUrl: 'javascript:alert(1)' }), COORDS)).toBeUndefined();
  });

  it('has nowhere to send a status with no target', () => {
    expect(checkLink(check({ kind: 'status', detailsUrl: undefined }), COORDS)).toBeUndefined();
  });
});
