import { describe, expect, it } from 'vitest';
import { buildShareUrl, hostOrigin, type ShareLocation } from '../lib/shareUrl';
import { safeUrl } from '../lib/safeUrl';

const APP_ID = 'abc';
const SPACED_APP_ID = 'my app';
const direct: ShareLocation = { origin: 'http://localhost:5173', pathname: '/', framed: false };
const hosted: ShareLocation = {
  origin: 'https://app-frame.example.net',
  pathname: '/index.html',
  ancestorOrigins: ['https://host.example.com'],
  framed: true,
};

describe('buildShareUrl', () => {
  it('prefers the configured public URL', () => {
    expect(buildShareUrl('/sessions/2031-03-06', { publicAppUrl: 'https://learn.example.com/hub', location: hosted, appId: APP_ID })).toBe(
      'https://learn.example.com/hub?page=%2Fsessions%2F2031-03-06',
    );
  });

  it('builds a host link when the app runs inside an https host', () => {
    expect(buildShareUrl('/topics', { appId: SPACED_APP_ID, location: hosted })).toBe(
      'https://host.example.com/apps/my%20app?page=%2Ftopics',
    );
  });

  it('falls back to the referrer when ancestorOrigins is unavailable', () => {
    const location = { ...hosted, ancestorOrigins: undefined, referrer: 'https://host.example.com/apps/x?page=1' };
    expect(hostOrigin(location)).toBe('https://host.example.com');
  });

  it('uses this page with a hash route when there is no host', () => {
    expect(buildShareUrl('/people/u1', { location: direct })).toBe('http://localhost:5173/#/people/u1');
    // Framed, but without an app id the host link can't be built.
    expect(buildShareUrl('/topics', { location: hosted })).toBe('https://app-frame.example.net/index.html#/topics');
  });

  it('ignores non-https hosts', () => {
    expect(hostOrigin({ ...hosted, ancestorOrigins: ['http://insecure.example.com'] })).toBeUndefined();
  });
});

describe('safeUrl', () => {
  it('allows only absolute https URLs', () => {
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeUrl('http://example.com')).toBeNull();
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('/relative')).toBeNull();
    expect(safeUrl('https://user:pw@host.test')).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });

  it('enforces an optional host allowlist', () => {
    expect(safeUrl('https://videos.example.com/x', ['example.com'])).toBe('https://videos.example.com/x');
    expect(safeUrl('https://example.org/x', ['example.com'])).toBeNull();
  });
});
