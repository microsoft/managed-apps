import { config } from '../config';

export interface ShareLocation {
  /** This frame's own URL parts. */
  origin: string;
  pathname: string;
  /** Origins of embedding pages, outermost last (Chromium exposes this). */
  ancestorOrigins?: ArrayLike<string>;
  /** Referrer of this frame; inside a host it is usually the host page's origin. */
  referrer?: string;
  /** True when the app runs inside another page (e.g. the Copilot Managed Runtime player). */
  framed: boolean;
}

export interface ShareOptions {
  /** App id from the host, when known. */
  appId?: string;
  /** VITE_PUBLIC_APP_URL: the deployed app's public URL. Wins when set. */
  publicAppUrl?: string;
  location: ShareLocation;
}

function httpsOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** The origin of the page hosting this app, when it can be detected and is https. */
export function hostOrigin(location: ShareLocation): string | undefined {
  if (!location.framed) return undefined;
  const ancestors = location.ancestorOrigins;
  const top = ancestors && ancestors.length > 0 ? ancestors[ancestors.length - 1] : undefined;
  const origin = httpsOrigin(top) ?? httpsOrigin(location.referrer);
  return origin && origin !== location.origin ? origin : undefined;
}

/**
 * A link that opens `route` (e.g. "/sessions/2026-10-08") for someone else:
 * 1. `VITE_PUBLIC_APP_URL?page=<route>` when configured;
 * 2. the host page's `/apps/<appId>?page=<route>` when the app runs inside the host;
 * 3. this page's own URL with the route in the hash (local dev, or a directly served build).
 */
export function buildShareUrl(route: string, options: ShareOptions): string {
  if (options.publicAppUrl) {
    const url = new URL(options.publicAppUrl);
    url.searchParams.set('page', route);
    return url.toString();
  }
  const host = hostOrigin(options.location);
  if (host && options.appId) {
    return `${host}/apps/${encodeURIComponent(options.appId)}?page=${encodeURIComponent(route)}`;
  }
  return `${options.location.origin}${options.location.pathname}#${route}`;
}

function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access to window.top throws, which also means we're framed.
    return true;
  }
}

export function currentShareLocation(): ShareLocation {
  return {
    origin: window.location.origin,
    pathname: window.location.pathname,
    ancestorOrigins: window.location.ancestorOrigins,
    referrer: document.referrer,
    framed: isFramed(),
  };
}

/** Share link for `route` in the current environment. */
export function shareUrlFor(route: string, appId: string | undefined): string {
  return buildShareUrl(route, { appId, publicAppUrl: config.publicAppUrl, location: currentShareLocation() });
}

