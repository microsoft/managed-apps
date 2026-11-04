import type { CommentThread } from '../types';
import { commentLineLabel } from './commentRange';

/**
 * How a thread's anchor is written wherever a line reference is shown.
 *
 * The label used to be built inline as `${side}${line}`, which meant a thread
 * with no usable line rendered as "R0" — a coordinate that cannot exist, since
 * files start at line 1. GitHub reports no current `line` for a thread it has
 * marked outdated, so comments from a previous iteration could collapse to R0
 * and reviewers had no way to tell where they had been made.
 *
 * The line itself is recovered upstream from `originalLine` (see
 * services/comments/github/threadParser.ts). These helpers cover what is left: making an absent line
 * *look* absent rather than look like line zero, and saying plainly that an
 * outdated thread's line is where the comment was written, not where that code
 * sits today.
 */

/** Just the fields the anchor needs, so callers can pass partial threads. */
type ThreadAnchorFields = Pick<CommentThread, 'side' | 'line' | 'startLine'> & {
  outdated?: boolean;
};

/** Shown when there is no line to show. An em dash, never "0". */
export const NO_LINE_LABEL = '—';

/** True when the thread has a line that could actually exist in a file. */
export function hasAnchorLine(thread: ThreadAnchorFields): boolean {
  return Number.isFinite(thread.line) && thread.line > 0;
}

/**
 * The short anchor label: `L`/`R` for the side, then the line — "R857".
 *
 * Falls back to an em dash rather than emitting a zero, so an unknown line
 * reads as unknown instead of as a real (impossible) position.
 */
export function threadAnchorLabel(thread: ThreadAnchorFields): string {
  if (!hasAnchorLine(thread)) return NO_LINE_LABEL;
  return `${thread.side === 'left' ? 'L' : 'R'}${commentLineLabel(thread)}`;
}

/**
 * Tooltip for the anchor.
 *
 * Outdated threads get the caveat that matters — the line is historical — since
 * the number alone would otherwise imply the comment still points at that line
 * in the current iteration.
 */
export function threadAnchorTitle(thread: ThreadAnchorFields): string | undefined {
  const sideName = thread.side === 'left' ? 'left' : 'right';
  if (!hasAnchorLine(thread)) {
    return 'Line unknown — GitHub no longer reports a position for this comment';
  }
  if (thread.outdated) {
    return `${thread.startLine === undefined ? 'Line' : 'Lines'} ${commentLineLabel(thread)} on the ${sideName} side when the comment was written · the code has changed since, so it may have moved`;
  }
  return `${thread.startLine === undefined ? 'Line' : 'Lines'} ${commentLineLabel(thread)} on the ${sideName} side`;
}
