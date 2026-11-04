import type { GitUserRef, PrListItem } from '../types';

/** A loosely-typed GitHub `/search/issues` result item. */
type SearchItem = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function normalizeUser(v: unknown): GitUserRef | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const u = v as Record<string, unknown>;
  const login = str(u.login);
  if (!login) return undefined;
  return {
    login,
    name: str(u.name),
    avatarUrl: str(u.avatar_url) ?? str(u.avatarUrl),
    htmlUrl: str(u.html_url) ?? str(u.htmlUrl),
  };
}

/**
 * Extract `{owner, name}` from a repository reference. Handles both the API
 * form (`.../repos/{owner}/{repo}`) and the HTML form
 * (`.../{owner}/{repo}/pull/{n}`).
 */
function repoFrom(item: SearchItem): { owner: string; name: string } | undefined {
  const repoUrl = str(item.repository_url);
  if (repoUrl) {
    const m = /\/repos\/([^/]+)\/([^/]+)(?:$|[/?#])/.exec(repoUrl);
    if (m) return { owner: m[1], name: m[2] };
  }
  const htmlUrl = str(item.html_url);
  if (htmlUrl) {
    const m = /\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(htmlUrl);
    if (m) return { owner: m[1], name: m[2] };
  }
  return undefined;
}

/**
 * Convert a single `/search/issues` item into a {@link PrListItem}. Returns
 * `null` for entries that are not pull requests or lack the coordinates needed
 * to open them (owner/repo/number).
 */
export function parseSearchItem(raw: unknown): PrListItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as SearchItem;

  // `/search/issues` returns both issues and PRs; PRs carry a `pull_request`
  // object. Fall back to a /pull/ html_url when the field is absent.
  const isPr =
    (item.pull_request && typeof item.pull_request === 'object') ||
    /\/pull\/\d+/.test(str(item.html_url) ?? '');
  if (!isPr) return null;

  const number = num(item.number);
  const repo = repoFrom(item);
  if (number === undefined || !repo) return null;

  const state = item.state === 'closed' ? 'closed' : 'open';

  return {
    coordinates: { owner: repo.owner, name: repo.name, number },
    title: str(item.title) ?? `PR #${number}`,
    state,
    draft: Boolean(item.draft),
    author: normalizeUser(item.user),
    createdAt: str(item.created_at),
    updatedAt: str(item.updated_at),
    htmlUrl: str(item.html_url),
    commentsCount: num(item.comments),
  };
}

/**
 * Read the array of result items from a connector `SearchIssues` response.
 * The connector wraps GitHub's `{ items: [...] }` as `{ body: [...] }`, but we
 * also accept the raw `items` array or a bare array for resilience.
 */
export function extractSearchItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.body)) return obj.body;
    if (Array.isArray(obj.items)) return obj.items;
  }
  return [];
}

/** Parse a full `SearchIssues` response payload into PR list items. */
export function parseSearchResponse(data: unknown): PrListItem[] {
  return extractSearchItems(data)
    .map(parseSearchItem)
    .filter((x): x is PrListItem => x !== null);
}
