/**
 * Anchoring for comments on lines that aren't part of the diff.
 *
 * GitHub's public API cannot create a line-anchored review comment on a line
 * outside the diff — REST rejects it ("line must be part of the diff"), and the
 * GraphQL `addPullRequestReviewThread` mutation fails silently by returning a
 * null thread. Only GitHub's web UI can do it, via a private session-only
 * endpoint we can't reach from the app.
 *
 * The closest anchor the API *does* support is a file-level comment
 * (`subjectType: FILE`), which GitHub always reports back at line 1. So when a
 * line comment is rejected we fall back to a file-level comment and record the
 * line the user actually clicked in a marker embedded in the body. On read we
 * decode the marker and re-anchor the thread, so the comment behaves like a
 * normal line comment in the app while still reading sensibly on GitHub.
 */
import type { DiffSide } from '../../../types';
import { commentLineLabel, validStartLine } from '../../../utils/commentRange';

/** Reads the line/side back out of a marker. */
const MARKER_RE = /<!--\s*codeflow:anchor\s+line=(\d+)\s+side=(left|right)(?:\s+startLine=(\d+))?\s*-->/;

/** Matches the whole preamble block so it can be removed before display. */
const BLOCK_RE =
  /^\s*<!--\s*codeflow:anchor\s+line=\d+\s+side=(?:left|right)(?:\s+startLine=\d+)?\s*-->[\s\S]*?<!--\s*\/codeflow:anchor\s*-->[^\S\r\n]*\r?\n?\r?\n?/;

export interface OutOfDiffAnchor {
  line: number;
  startLine?: number;
  side: DiffSide;
}

/**
 * Wrap a comment body with an anchor marker plus a human-readable quote of the
 * line, for posting as a file-level comment. The marker is an HTML comment, so
 * GitHub renders it invisibly; the quoted line beneath it is what a reader on
 * GitHub actually sees.
 */
export function encodeAnchoredBody(
  body: string,
  anchor: OutOfDiffAnchor,
  lineText?: string,
): string {
  // Backticks in the source would break out of the inline code span.
  const snippet = lineText?.trim().replace(/`/g, "'");
  const label = `${anchor.startLine === undefined ? 'Line' : 'Lines'} ${commentLineLabel(anchor)}`;
  const quoted = snippet
    ? `> **${label}** · \`${snippet.replace(/\r?\n/g, '`\n> `')}\``
    : `> **${label}**`;
  const range = anchor.startLine === undefined ? '' : ` startLine=${anchor.startLine}`;

  return [
    `<!-- codeflow:anchor line=${anchor.line} side=${anchor.side}${range} -->`,
    quoted,
    '<!-- /codeflow:anchor -->',
    '',
    body,
  ].join('\n');
}

/** Read the anchor back out of a comment body, or null when there isn't one. */
export function decodeAnchor(body: string): OutOfDiffAnchor | null {
  const m = MARKER_RE.exec(body);
  if (!m) return null;
  const line = Number(m[1]);
  if (!Number.isFinite(line) || line <= 0) return null;
  const startLine = validStartLine(m[3], line);
  return { line, side: m[2] as DiffSide, ...(startLine !== undefined ? { startLine } : {}) };
}

/** Strip the marker preamble so only the user's own text is displayed. */
export function stripAnchor(body: string): string {
  return body.replace(BLOCK_RE, '');
}

/**
 * True when an error from `addPullRequestReviewThread` means the target line
 * isn't part of the diff. Covers the REST and GraphQL phrasings we've observed
 * from GitHub.
 */
export function isOutOfDiffError(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('must be part of the diff') ||
    t.includes('not part of the diff') ||
    t.includes("doesn't exist in the pull request diff") ||
    t.includes('does not exist in the pull request diff') ||
    t.includes('could not be resolved') ||
    t.includes("diff hunk can't be blank")
  );
}
