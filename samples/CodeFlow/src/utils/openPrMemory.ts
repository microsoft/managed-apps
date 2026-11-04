/**
 * Remembers which PR the reviewer actually has open, so a refresh returns there
 * rather than to whatever PR the URL happens to name.
 *
 * Inside the player the app is a cross-origin iframe, so rewriting our own
 * address bar (see `updateUrlTarget`) does not survive a top-level refresh — the
 * player replays the URL it was opened with. Following a deep link to PR A and
 * then picking PR B off the dashboard therefore used to snap back to A on every
 * reload. This record is the part that survives: it is kept in app storage's
 * tab-scoped `session` store, which outlives the reload that recreates the iframe.
 *
 * It is deliberately tab-scoped: a fresh tab, or a link opened in a new one,
 * starts from the URL alone.
 */

import { z } from 'zod';
import type { PrCoordinates } from '../types';
import { appStorage } from '../storage';
import { readDeepLink, type DeepLinkTarget } from './deepLink';

const KEY = 'openPr';

const recordSchema = z.object({
  from: z.string(),
  to: z.object({ owner: z.string(), repo: z.string(), number: z.number() }).nullable(),
});

/** A PR named without the file/comment tail of a full deep link. */
interface OpenPr {
  owner: string;
  repo: string;
  number: number;
}

interface OpenPrRecord {
  /**
   * The PR the URL named when this tab started navigating, as a `prKey`, or the
   * empty string when it named none. A different link in the URL later means the
   * reviewer followed a *new* link, which must beat anything recorded here.
   */
  from: string;
  /** Where the reviewer has since got to, or null once back on the dashboard. */
  to: OpenPr | null;
}

function keyOf(pr: OpenPr | DeepLinkTarget | null): string {
  return pr ? `${pr.owner}/${pr.repo}#${pr.number}` : '';
}

/**
 * The deep link the URL carried before we started rewriting it, captured once.
 *
 * Reading `window.location` afresh each time would be wrong: on a top-level tab
 * `updateUrlTarget` mutates the URL as the reviewer navigates, so the anchor
 * would chase its own tail and never register that they had moved on.
 */
let anchor: string | undefined;

function urlAnchor(): string {
  if (anchor === undefined) anchor = keyOf(readDeepLink());
  return anchor;
}

function read(): OpenPrRecord | null {
  try {
    return appStorage().session.get(KEY, recordSchema) ?? null;
  } catch {
    // Unavailable or corrupt storage just means we fall back to the URL.
    return null;
  }
}

/** Record the PR the reviewer has open, or `null` for the dashboard. */
export function rememberOpenPr(coords: PrCoordinates | null): void {
  const record: OpenPrRecord = {
    from: urlAnchor(),
    to: coords ? { owner: coords.owner, repo: coords.name, number: coords.number } : null,
  };
  try {
    appStorage().session.set(KEY, record);
  } catch {
    // Storage full or blocked; the URL remains the source of truth.
  }
}

/**
 * The PR to open on startup: the deep link in the URL, unless this tab has since
 * navigated somewhere else, in which case that wins.
 *
 * The file and comment tail only survives when the URL's own target is still the
 * one being opened — a file path from PR A means nothing in PR B.
 */
export function resolveOpenTarget(
  urlTarget: DeepLinkTarget | null = readDeepLink(),
): DeepLinkTarget | null {
  const anchored = urlAnchor();
  const record = read();
  if (!record || record.from !== anchored) return urlTarget;

  if (!record.to) return null;
  if (keyOf(record.to) === keyOf(urlTarget)) return urlTarget;
  return { owner: record.to.owner, repo: record.to.repo, number: record.to.number };
}

/** Test seam: forget the captured URL anchor and the stored record. */
export function resetOpenPrMemory(): void {
  anchor = undefined;
  try {
    appStorage().session.remove(KEY);
  } catch {
    // Nothing to clear.
  }
}
