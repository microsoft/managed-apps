/**
 * The one gate for links that come from stored data, connectors, or user input. Only absolute
 * `https:` URLs pass; everything else (javascript:, data:, relative paths, typos) returns null.
 */
export function safeUrl(value: string | null | undefined, allowedHosts?: readonly string[]): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (allowedHosts && allowedHosts.length > 0) {
    const host = url.hostname.toLowerCase();
    if (!allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return null;
  }
  return url.toString();
}
