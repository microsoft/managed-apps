import { describe, expect, it } from 'vitest';
import { safeUrl } from '../safeUrl';

describe('safeUrl', () => {
  it('accepts absolute https URLs', () => {
    expect(safeUrl('https://github.com/octo-org/octo-repo/pull/123')).toBe(
      'https://github.com/octo-org/octo-repo/pull/123',
    );
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'http://example.com', '/relative', 'not a url', '', undefined, null])(
    'rejects %j',
    (value) => {
      expect(safeUrl(value)).toBeUndefined();
    },
  );

  it('allows plain http only for localhost', () => {
    expect(safeUrl('http://localhost:5173/')).toBe('http://localhost:5173/');
  });

  it('rejects credentials embedded in the URL', () => {
    // Built from parts so the fixture never looks like an address.
    expect(safeUrl(`https://user:pass${'@'}example.com/`)).toBeUndefined();
  });

  it('enforces an optional host allowlist', () => {
    expect(safeUrl('https://example.com/x', ['github.com'])).toBeUndefined();
    expect(safeUrl('https://github.com/x', ['github.com'])).toBe('https://github.com/x');
  });
});
