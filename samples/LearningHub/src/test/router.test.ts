import { afterEach, describe, expect, it } from 'vitest';
import { applyDeepLink, href, isKnownPath, parseHash, paths, rememberRoutes, ROUTE_MEMORY_MS } from '../lib/router';
import { makeStorage } from './helpers';

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

afterEach(() => setUrl('/'));

describe('parseHash', () => {
  it('parses every route', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/sessions')).toEqual({ name: 'home' });
    expect(parseHash('#/sessions/2031-03-06')).toEqual({ name: 'session', id: '2031-03-06' });
    expect(parseHash('#/people/user%20one')).toEqual({ name: 'person', id: 'user one' });
    expect(parseHash('#/present?date=2031-03-06&topic=t1')).toEqual({ name: 'present', date: '2031-03-06', topic: 't1', edit: undefined });
    expect(parseHash('#/topics?focus=1')).toEqual({ name: 'topics', focus: true });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
    expect(parseHash('#/admin')).toEqual({ name: 'notfound', path: '/admin' });
    expect(parseHash('#/sessions/a/b')).toEqual({ name: 'notfound', path: '/sessions/a/b' });
  });

  it('round-trips the path builders', () => {
    expect(parseHash(href(paths.session('sample-1')))).toEqual({ name: 'session', id: 'sample-1' });
    expect(parseHash(href(paths.person('a/b')))).toEqual({ name: 'person', id: 'a/b' });
    expect(parseHash(href(paths.presentEdit('x y')))).toMatchObject({ name: 'present', edit: 'x y' });
    expect(isKnownPath(paths.topicsCompose)).toBe(true);
    expect(isKnownPath('//evil.example.com')).toBe(false);
    expect(isKnownPath('/nope')).toBe(false);
  });
});

describe('deep links', () => {
  it('opens a shared ?page= link once, then keeps the last route on reload', () => {
    const { nav } = makeStorage();
    let now = 1_000_000;
    const clock = () => now;

    setUrl('/?page=%2Ftopics');
    applyDeepLink(nav, clock);
    expect(window.location.hash).toBe('#/topics');

    const stop = rememberRoutes(nav, clock);
    setUrl('/?page=%2Ftopics#/settings');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    stop();

    // Reload of the host page: same ?page=, no hash. The last route wins over the handled link.
    setUrl('/?page=%2Ftopics');
    now += 60_000;
    applyDeepLink(nav, clock);
    expect(window.location.hash).toBe('#/settings');

    // Much later, the remembered route has expired.
    setUrl('/?page=%2Ftopics');
    now += ROUTE_MEMORY_MS;
    applyDeepLink(nav, clock);
    expect(window.location.hash).toBe('');
  });

  it('ignores unknown or unsafe ?page= values', () => {
    const { nav } = makeStorage();
    setUrl('/?page=%2F%2Fevil.example.com');
    applyDeepLink(nav);
    expect(window.location.hash).toBe('');
    setUrl('/?page=sessions%2F2031-03-06');
    applyDeepLink(nav);
    expect(window.location.hash).toBe('#/sessions/2031-03-06');
  });

  it('leaves an explicit hash alone', () => {
    const { nav } = makeStorage();
    setUrl('/?page=%2Ftopics#/present');
    applyDeepLink(nav);
    expect(window.location.hash).toBe('#/present');
  });
});
