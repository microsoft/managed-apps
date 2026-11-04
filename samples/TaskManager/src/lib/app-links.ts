import { appConfig } from "@/config";

/**
 * Base URL for links that should open this app (copied links, Teams messages).
 * Uses VITE_APP_URL when set — the app usually runs inside a player frame whose
 * own address isn't shareable — otherwise the current page address.
 */
export function appBaseUrl(): string {
  if (appConfig.links.appUrl) return appConfig.links.appUrl;
  return `${window.location.origin}${window.location.pathname}`;
}

/** A link into this app with the given query parameters (e.g. `{ tab: "board", workItem: "42" }`). */
export function appLink(params: Record<string, string>): string {
  const url = new URL(appBaseUrl());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
