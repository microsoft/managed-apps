/**
 * Deep links into the app.
 *
 * A deep link names a PR with discrete query params, plus an optional file or
 * comment target:
 *
 *   ?org={owner}&repo={repo}&pull={number}
 *   ?org={owner}&repo={repo}&pull={number}&file={path}
 *   ?org={owner}&repo={repo}&pull={number}&comment={commentId}
 *
 * A compact single-param form (`?dl=pr:{owner}/{repo}#{number}/...`) is also
 * accepted when reading; links the app creates always use the params above.
 *
 * The app player forwards non-reserved query params through to the app
 * iframe, so `window.location.search` carries these identically in local dev and
 * in the deployed app. That means reading a deep link is a plain
 * `URLSearchParams` lookup.
 */

import { config } from '../config';

/** Path the managed-apps Vite plugin serves the dev app config from. */
const DEV_CONFIG_PATH = '__vite_managedapps_plugin__/ms.config.json';

/** Query params a deep link is made of. */
export const DEEP_LINK_PARAMS = {
  owner: 'org',
  repo: 'repo',
  number: 'pull',
  file: 'file',
  comment: 'comment',
} as const;

/** Legacy single-param form. Still read, never written. */
export const DEEP_LINK_PARAM = 'dl';

export interface DeepLinkTarget {
  owner: string;
  repo: string;
  number: number;
  /** Filename to open in the diff viewer. */
  file?: string;
  /** Comment or thread id to scroll to. Matched against thread ids and comment ids. */
  commentId?: string;
}

/** Minimal shape of `window.location` the helpers need, so tests can pass a stub. */
export interface LocationLike {
  hostname: string;
  origin: string;
  pathname?: string;
  search: string;
  hash: string;
}

/** The parts of a URL {@link deepLinkUrl} rewrites. */
export interface UrlParts {
  pathname: string;
  search: string;
  hash: string;
}

function currentLocation(): LocationLike {
  return window.location;
}

function isLocalDev(loc: LocationLike): boolean {
  return loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
}

/**
 * Percent-encode a param value but leave `/` intact — slashes are legal in a
 * query string and keep file paths readable in a shared link.
 */
function encodeParam(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, '/');
}

/** Serialize a target into deep-link query params (`org=…&repo=…&pull=…`). */
export function deepLinkQuery(t: DeepLinkTarget): string {
  const parts = [
    `${DEEP_LINK_PARAMS.owner}=${encodeParam(t.owner)}`,
    `${DEEP_LINK_PARAMS.repo}=${encodeParam(t.repo)}`,
    `${DEEP_LINK_PARAMS.number}=${t.number}`,
  ];
  if (t.file) parts.push(`${DEEP_LINK_PARAMS.file}=${encodeParam(t.file)}`);
  if (t.commentId) parts.push(`${DEEP_LINK_PARAMS.comment}=${encodeParam(t.commentId)}`);
  return parts.join('&');
}

function trimmed(params: URLSearchParams, key: string): string | undefined {
  return params.get(key)?.trim() || undefined;
}

/** Read a target from discrete deep-link params. Null when the PR is incomplete. */
export function parseDeepLinkParams(params: URLSearchParams): DeepLinkTarget | null {
  const owner = trimmed(params, DEEP_LINK_PARAMS.owner);
  const repo = trimmed(params, DEEP_LINK_PARAMS.repo);
  const rawNumber = trimmed(params, DEEP_LINK_PARAMS.number);
  if (!owner || !repo || !rawNumber) return null;

  const number = Number(rawNumber);
  if (!Number.isSafeInteger(number) || number <= 0) return null;

  const target: DeepLinkTarget = { owner, repo, number };
  const file = trimmed(params, DEEP_LINK_PARAMS.file);
  if (file) target.file = file;
  const commentId = trimmed(params, DEEP_LINK_PARAMS.comment);
  if (commentId) target.commentId = commentId;
  return target;
}

/** Serialize a target into the legacy `dl` value (before URL encoding). */
export function serializeDeepLink(t: DeepLinkTarget): string {
  let dl = `pr:${t.owner}/${t.repo}#${t.number}`;
  if (t.file) dl += `/file:${t.file}`;
  if (t.commentId) dl += `/comment:${t.commentId}`;
  return dl;
}

/** Parse a legacy `dl` value. Returns null when it isn't a well-formed deep link. */
export function parseDeepLink(dl: string): DeepLinkTarget | null {
  const match = /^pr:([^/]+)\/([^#]+)#(\d+)(.*)$/.exec(dl.trim());
  if (!match) return null;

  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;

  const target: DeepLinkTarget = { owner: match[1], repo: match[2], number };

  // Peel the comment segment off the tail first so a file path containing
  // "/comment:" can't swallow it (file paths are matched greedily otherwise).
  let rest = match[4];
  const commentAt = rest.lastIndexOf('/comment:');
  if (commentAt >= 0) {
    const id = rest.slice(commentAt + '/comment:'.length);
    if (id) target.commentId = id;
    rest = rest.slice(0, commentAt);
  }
  if (rest.startsWith('/file:')) {
    const file = rest.slice('/file:'.length);
    if (file) target.file = file;
  }

  return target;
}

/** Read either link format out of one query string. */
function readFromQuery(query: string): DeepLinkTarget | null {
  if (!query) return null;
  const params = new URLSearchParams(query);

  const current = parseDeepLinkParams(params);
  if (current) return current;

  const legacy = params.get(DEEP_LINK_PARAM);
  return legacy ? parseDeepLink(legacy) : null;
}

/**
 * Read a deep link from the current URL. Checks the query string first (how the
 * player delivers it) and falls back to the hash fragment for hand-written links.
 */
export function readDeepLink(loc: LocationLike = currentLocation()): DeepLinkTarget | null {
  return (
    readFromQuery(loc.search.replace(/^\?/, '')) ?? readFromQuery(loc.hash.replace(/^#/, ''))
  );
}

/**
 * URL that opens the app in the player: the dev player pointed at the local Vite
 * server during development, otherwise the deployed app's URL from configuration
 * (`VITE_APP_URL`), falling back to the current page.
 */
export function playerAppUrl(loc: LocationLike = currentLocation()): string {
  if (isLocalDev(loc)) {
    const url = new URL('/apps/dev', config.devPlayerUrl);
    url.searchParams.set('ms_appUrl', `${loc.origin}/`);
    url.searchParams.set('ms_appConfigUrl', `${loc.origin}/${DEV_CONFIG_PATH}`);
    return url.toString();
  }
  return config.appUrl || `${loc.origin}${loc.pathname ?? '/'}`;
}

/** Build a shareable link that opens the app in the player on the given target. */
export function buildDeepLink(
  target: DeepLinkTarget,
  loc: LocationLike = currentLocation(),
): string {
  const base = playerAppUrl(loc);
  return `${base}${base.includes('?') ? '&' : '?'}${deepLinkQuery(target)}`;
}

/**
 * Rewrite a URL so its deep-link params name `target`, preserving any unrelated
 * params. Passing `null` strips the deep link entirely.
 *
 * The hash is cleared when it holds a deep link of its own: `readDeepLink` falls
 * back to the hash, so a stale one there would outlive the rewrite.
 */
export function deepLinkUrl(parts: UrlParts, target: DeepLinkTarget | null): string {
  const params = new URLSearchParams(parts.search.replace(/^\?/, ''));
  for (const key of Object.values(DEEP_LINK_PARAMS)) params.delete(key);
  params.delete(DEEP_LINK_PARAM);

  if (target) {
    params.set(DEEP_LINK_PARAMS.owner, target.owner);
    params.set(DEEP_LINK_PARAMS.repo, target.repo);
    params.set(DEEP_LINK_PARAMS.number, String(target.number));
    if (target.file) params.set(DEEP_LINK_PARAMS.file, target.file);
    if (target.commentId) params.set(DEEP_LINK_PARAMS.comment, target.commentId);
  }

  // Match `encodeParam` and leave slashes readable in file paths.
  const query = params.toString().replace(/%2F/g, '/');
  const hash = readFromQuery(parts.hash.replace(/^#/, '')) ? '' : parts.hash;
  return `${parts.pathname}${query ? `?${query}` : ''}${hash}`;
}

/**
 * Point the address bar at `target` without adding a history entry, so a refresh
 * reopens the PR the reviewer is actually on.
 *
 * Only helps when the app owns the address bar. Inside the player it is a
 * cross-origin iframe, so a top-level refresh replays the player's original URL
 * and {@link src/utils/openPrMemory.ts} is what carries the reviewer back.
 */
export function updateUrlTarget(target: DeepLinkTarget | null): void {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') return;

  const { pathname, search, hash } = window.location;
  const next = deepLinkUrl({ pathname, search, hash }, target);
  if (next === `${pathname}${search}${hash}`) return;

  try {
    window.history.replaceState(window.history.state, '', next);
  } catch {
    // Sandboxed iframes can forbid history writes; the session record still
    // carries the reviewer back to the right PR.
  }
}

/**
 * When the app is opened directly (outside the player) with deep-link params, it
 * has no connector context, so bounce to the player carrying the deep link.
 * Returns true when a redirect was started.
 */
export function redirectToPlayerIfTopLevel(): boolean {
  if (typeof window === 'undefined') return false;
  // Inside the player the app is iframed; only a direct hit needs the bounce.
  if (window.self !== window.top) return false;

  const target = readDeepLink();
  if (!target) return false;

  window.location.href = buildDeepLink(target);
  return true;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API is blocked in some iframe sandboxes; fall back to execCommand.
    return execCommandCopy(text);
  }
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for HTML. PR titles are author-controlled and end up in Outlook, Teams or Word. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Copies a hyperlink to the clipboard with both HTML (linked text) and plain-text
 * representations.  Pasting into a rich editor yields a clickable link; pasting
 * into a plain-text field yields the URL.
 *
 * Falls back to copying the URL when rich clipboard writes are unavailable.
 */
export async function copyRichLink(url: string, label: string): Promise<boolean> {
  try {
    const html = `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([url], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    return true;
  } catch {
    // ClipboardItem may be blocked (iframe sandbox or older browser); fall back.
    return copyToClipboard(url);
  }
}

function execCommandCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
