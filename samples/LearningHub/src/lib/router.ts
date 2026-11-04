import { useMemo, useSyncExternalStore } from 'react';
import { z } from 'zod';
import type { KeyValueStore } from '../storage/core';

export type Route =
  | { name: 'home' }
  | { name: 'session'; id: string }
  | { name: 'person'; id: string }
  | { name: 'present'; date?: string; topic?: string; edit?: string }
  | { name: 'topics'; focus: boolean }
  | { name: 'settings' }
  | { name: 'notfound'; path: string };

const REPLACE_EVENT = 'learninghub:replace';

function readHash(): string {
  return window.location.hash || '#/';
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  window.addEventListener(REPLACE_EVENT, listener);
  return () => {
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
    window.removeEventListener(REPLACE_EVENT, listener);
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const query = new URLSearchParams(queryPart);
  const segments = pathPart.split('/').filter(Boolean).map(safeDecode);

  if (segments.length === 0) return { name: 'home' };
  const [first, second] = segments;
  if (first === 'sessions' && second && segments.length === 2) return { name: 'session', id: second };
  if (first === 'sessions' && segments.length === 1) return { name: 'home' };
  if (first === 'people' && second && segments.length === 2) return { name: 'person', id: second };
  if (first === 'present' && segments.length === 1) {
    return {
      name: 'present',
      date: query.get('date') ?? undefined,
      topic: query.get('topic') ?? undefined,
      edit: query.get('edit') ?? undefined,
    };
  }
  if (first === 'topics' && segments.length === 1) return { name: 'topics', focus: query.get('focus') === '1' };
  if (first === 'settings' && segments.length === 1) return { name: 'settings' };
  return { name: 'notfound', path: pathPart };
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, readHash);
}

export function useRoute(): Route {
  const hash = useHash();
  return useMemo(() => parseHash(hash), [hash]);
}

/** Pushes a new history entry. `path` is the part after `#`, e.g. "/topics". */
export function navigate(path: string): void {
  window.location.hash = path;
}

/** Replaces the current entry without adding history (used for dialog state in the URL). */
export function replaceRoute(path: string): void {
  window.history.replaceState(window.history.state, '', `#${path}`);
  window.dispatchEvent(new Event(REPLACE_EVENT));
}

export const paths = {
  home: '/',
  session: (id: string) => `/sessions/${encodeURIComponent(id)}`,
  person: (id: string) => `/people/${encodeURIComponent(id)}`,
  present: '/present',
  presentDate: (key: string) => `/present?date=${encodeURIComponent(key)}`,
  presentTopic: (topicId: string) => `/present?topic=${encodeURIComponent(topicId)}`,
  presentEdit: (itemId: string) => `/present?edit=${encodeURIComponent(itemId)}`,
  topics: '/topics',
  /** Topics page with the request composer focused. */
  topicsCompose: '/topics?focus=1',
  settings: '/settings',
};

export function href(path: string): string {
  return `#${path}`;
}

export function isKnownPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && parseHash(`#${path}`).name !== 'notfound';
}

const ROUTE_KEY = 'lastRoute';
const LINK_KEY = 'handledLink';
const lastRouteSchema = z.object({ path: z.string(), at: z.number() });

/** A remembered route older than this is ignored: opening the app later starts at home. */
export const ROUTE_MEMORY_MS = 30 * 60_000;

function safeGet<V>(store: KeyValueStore, key: string, schema: z.ZodType<V>): V | undefined {
  try {
    return store.get(key, schema);
  } catch {
    return undefined;
  }
}

function safeSet(store: KeyValueStore, key: string, value: unknown): void {
  try {
    store.set(key, value);
  } catch {
    // Storage can be unavailable; a reload then falls back to ?page= or home.
  }
}

/**
 * Picks the starting route. Hosts that embed the app forward their own query params to the app
 * frame (not its hash), so share links carry the route as `?page=<route>`. A host reload builds a
 * fresh frame with no hash, so the current route is remembered in the `nav` store for a while:
 * - a `?page=` not handled yet (opening a shared link): go to it;
 * - otherwise (reload, or the same `?page=` again): restore the recent last route.
 */
export function applyDeepLink(nav: KeyValueStore, now: () => number = Date.now): void {
  const hash = window.location.hash;
  if (hash && hash !== '#' && hash !== '#/') return;

  const raw = new URLSearchParams(window.location.search).get('page');
  const page = raw ? (raw.startsWith('/') ? raw : `/${raw}`) : null;
  const handled = safeGet(nav, LINK_KEY, z.string());
  const last = safeGet(nav, ROUTE_KEY, lastRouteSchema);

  let target: string | null = null;
  if (page && page !== handled) {
    safeSet(nav, LINK_KEY, page);
    target = page;
  } else if (last && now() - last.at < ROUTE_MEMORY_MS) {
    target = last.path;
  }
  if (target && isKnownPath(target) && target !== '/') {
    window.history.replaceState(window.history.state, '', `#${target}`);
  }
}

/** Remembers the current route for reloads; call once at startup. Returns an unsubscribe function. */
export function rememberRoutes(nav: KeyValueStore, now: () => number = Date.now): () => void {
  const save = () => safeSet(nav, ROUTE_KEY, { path: readHash().replace(/^#/, '') || '/', at: now() });
  save();
  return subscribe(save);
}
