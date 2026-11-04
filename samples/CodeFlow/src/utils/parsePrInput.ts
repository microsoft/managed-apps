import type { PrCoordinates } from '../types';

/**
 * Parse a free-text PR reference into coordinates. Accepts:
 *   - a full GitHub URL: `.../{owner}/{repo}/pull/{number}`
 *   - shorthand: `owner/repo#123` or `owner/repo/123`
 * Returns `null` when nothing parseable is found.
 */
export function parsePrInput(value: string): PrCoordinates | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Full GitHub URL: .../{owner}/{repo}/pull/{number}
  const urlMatch = /([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(trimmed);
  if (urlMatch) {
    return { owner: urlMatch[1], name: urlMatch[2], number: Number(urlMatch[3]) };
  }

  // Shorthand: owner/repo#123  or  owner/repo/123
  const shortMatch = /^([^/\s]+)\/([^/#\s]+)[#/](\d+)$/.exec(trimmed);
  if (shortMatch) {
    return { owner: shortMatch[1], name: shortMatch[2], number: Number(shortMatch[3]) };
  }
  return null;
}

/**
 * Parse an `owner/repo` repository reference (no PR number). Accepts a bare
 * `owner/repo` or a repository URL. Returns `null` when not parseable.
 */
export function parseRepoInput(value: string): { owner: string; name: string } | null {
  const trimmed = value.trim().replace(/\.git$/, '');
  if (!trimmed) return null;

  // URL form: .../{owner}/{repo}[/...]
  const urlMatch = /(?:https?:\/\/[^/]+\/)([^/\s]+)\/([^/\s?#]+)/.exec(trimmed);
  if (urlMatch) {
    return { owner: urlMatch[1], name: urlMatch[2] };
  }

  // Bare owner/repo
  const shortMatch = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  if (shortMatch) {
    return { owner: shortMatch[1], name: shortMatch[2] };
  }
  return null;
}
