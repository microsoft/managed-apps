/**
 * Links that leave the app for the PR's page on GitHub.
 *
 * Every URL is passed through {@link safeUrl}, so a malformed or non-https value
 * coming back from the API is never rendered as a link.
 */

import type { PrCoordinates } from '../types';
import { config } from '../config';
import { safeUrl } from '../lib/safeUrl';

export function githubLink(url: string): string;
export function githubLink(url: string | undefined): string | undefined;
/** A vetted external link, or `undefined` when the URL isn't safe to render. */
export function githubLink(url: string | undefined): string | undefined {
  if (!url) return url;
  return safeUrl(url) ? url : undefined;
}

/** The PR's page — its own URL when known, rebuilt from coordinates if not. */
export function prPageUrl(coords: PrCoordinates, prHtmlUrl?: string): string {
  if (prHtmlUrl && safeUrl(prHtmlUrl)) return prHtmlUrl.replace(/\/+$/, '');
  return `${config.githubHost}/${coords.owner}/${coords.name}/pull/${coords.number}`;
}

/**
 * The repository's own page, derived from whatever we know about the PR. Taking
 * the origin from the pull request's URL means the link points at the host the
 * PR actually came from.
 */
export function repoPageUrl(coords: PrCoordinates, prHtmlUrl?: string): string {
  const page = prPageUrl(coords, prHtmlUrl);
  const at = page.lastIndexOf('/pull/');
  return at === -1 ? `${config.githubHost}/${coords.owner}/${coords.name}` : page.slice(0, at);
}

/** A branch's tree view on GitHub. */
export function branchPageUrl(
  coords: PrCoordinates,
  branch: string,
  prHtmlUrl?: string,
): string {
  return `${repoPageUrl(coords, prHtmlUrl)}/tree/${branch}`;
}

/** Everything known about where a comment lives on GitHub. */
export interface GitHubCommentTarget {
  coords: PrCoordinates;
  /** The PR's own URL, when the API gave us one. */
  prHtmlUrl?: string;
  /** GitHub's own permalink for the comment, when the read path carried one. */
  commentHtmlUrl?: string;
  /** The comment's database id, used to rebuild the anchor without a permalink. */
  commentId?: string;
  /** PR-level conversation comments anchor as `#issuecomment-…`, not `#discussion_r…`. */
  isIssueComment?: boolean;
}

/**
 * The comment's address on GitHub itself, as opposed to the app's deep link.
 *
 * GitHub's own `html_url` is preferred whenever the read path carried one.
 * Failing that the anchor is rebuilt from the comment's database id: review
 * comments anchor as `#discussion_r{id}` and PR-level conversation comments as
 * `#issuecomment-{id}`. A GraphQL node id (`PRRC_…`) has no anchor to rebuild,
 * so the link degrades to the pull request page.
 */
export function githubCommentUrl(target: GitHubCommentTarget): string {
  const permalink = githubLink(target.commentHtmlUrl);
  if (permalink) return permalink;

  const base = prPageUrl(target.coords, target.prHtmlUrl);
  const anchor =
    target.commentId && /^\d+$/.test(target.commentId)
      ? `#${target.isIssueComment ? 'issuecomment-' : 'discussion_r'}${target.commentId}`
      : '';
  return `${base}${anchor}`;
}
