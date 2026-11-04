/**
 * The one gate every external link passes through before it is rendered.
 *
 * Only absolute `https:` URLs are allowed (plus `http:` for localhost during
 * development). Anything else — `javascript:`, `data:`, relative paths, garbage —
 * yields `undefined`, so callers render plain text instead of a link.
 */
export function safeUrl(value: string | undefined | null, allowedHosts?: readonly string[]): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return undefined;
  if (url.username || url.password) return undefined;
  if (allowedHosts && allowedHosts.length > 0 && !allowedHosts.includes(url.hostname)) return undefined;
  return url.toString();
}
