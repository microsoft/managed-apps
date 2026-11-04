/**
 * Pure classification logic for the dashboard's review sections.
 *
 * Given the reviewer's locally-tracked "in progress" PRs and the results of the
 * dashboard's open-PR searches, decide which section each entry belongs to:
 *  - `action`  → the reviewer hasn't submitted a review yet.
 *  - `waiting` → the reviewer has reviewed it and it's still open.
 *
 * Bucketing is derived entirely from search results the dashboard already
 * fetches, so it costs no extra requests. Earlier revisions fetched each PR's
 * metadata and review list individually (two connector calls
 * per tracked PR, up to 60 requests per load), which reliably tripped GitHub's
 * rate limiter before the page finished rendering.
 *
 * Entries for PRs that have since been merged or closed are retired elsewhere:
 * `usePrLoader` drops one the moment it's opened, and `getInProgressReviews`
 * ages out anything that's been tracked too long.
 *
 * All functions here are side-effect free and clock-free so they can be
 * unit-tested without touching the network, storage, or the current time.
 */
import type { PrListItem } from '../types';
import type { InProgressReview } from './storage';

export type InProgressBucket = 'action' | 'waiting';

/** A fully-classified in-progress entry, ready to render. */
export interface EnrichedInProgress {
  entry: InProgressReview;
  bucket: InProgressBucket;
  /** Short human explanation, only for the `action` bucket. */
  reason?: string;
  /** Live search data for this PR, when one of the searches returned it. */
  live?: PrListItem;
}

export function prKeyOf(e: { owner: string; name: string; number: number }): string {
  return `${e.owner}/${e.name}#${e.number}`;
}

/** Index a list of search results by `owner/name#number` for O(1) lookup. */
export function indexByPrKey(items: PrListItem[]): Map<string, PrListItem> {
  return new Map(items.map((i) => [prKeyOf(i.coordinates), i]));
}

export interface ClassifyContext {
  /** Open PRs the signed-in user has already submitted a review on. */
  reviewed: Map<string, PrListItem>;
  /** Open PRs where a review has been requested from the signed-in user. */
  requested: Map<string, PrListItem>;
  /** Open PRs authored by the signed-in user. */
  authored: Map<string, PrListItem>;
}

/**
 * Decide which section an in-progress PR belongs to using only search results.
 *
 * A PR absent from every search still shows as needing action rather than
 * disappearing: the searches are capped and qualifier-scoped, so absence is not
 * proof a PR is finished, and dropping a review the user is mid-way through is
 * far worse than showing a row a little too long.
 */
export function classifyInProgress(
  entry: InProgressReview,
  ctx: ClassifyContext,
): EnrichedInProgress {
  const key = prKeyOf(entry);
  const live = ctx.reviewed.get(key) ?? ctx.requested.get(key) ?? ctx.authored.get(key);

  if (ctx.reviewed.has(key)) {
    return { entry, live, bucket: 'waiting' };
  }

  return { entry, live, bucket: 'action', reason: 'Not reviewed yet' };
}

/** Classify every tracked entry, preserving order. */
export function classifyAll(
  entries: InProgressReview[],
  ctx: ClassifyContext,
): EnrichedInProgress[] {
  return entries.map((entry) => classifyInProgress(entry, ctx));
}

/** Build a list item for an in-progress entry, preferring live search data. */
export function enrichedToItem(e: EnrichedInProgress): PrListItem {
  if (e.live) return e.live;
  return {
    coordinates: { owner: e.entry.owner, name: e.entry.name, number: e.entry.number },
    title: e.entry.title ?? `PR #${e.entry.number}`,
  };
}

/**
 * A stable, order-independent signature of a PR list, used to decide when
 * derived state must be recomputed. Storage returns a fresh array on every
 * render, so identity can't be used as a dependency.
 */
export function prListSignature(
  entries: { owner: string; name: string; number: number }[],
): string {
  return entries.map(prKeyOf).sort().join('|');
}
