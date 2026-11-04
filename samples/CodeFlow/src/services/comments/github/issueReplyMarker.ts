/**
 * Threading for the PR-level "Description" conversation.
 *
 * The Description section is made of GitHub *issue* comments, and GitHub gives
 * issue comments no threading at all: there is no `in_reply_to`, and trying to
 * reply to one through the review-comment API fails with
 * `PullRequestReviewComment.in_reply_to (invalid)` because the id belongs to a
 * different comment space entirely.
 *
 * So a reply is posted as another issue comment carrying a marker that names the
 * comment it answers. On read the marker groups the reply back under its parent,
 * which keeps the conversation threaded in the app. The marker is an HTML
 * comment — invisible on GitHub — followed by a plain-English attribution line,
 * so the reply still reads as a reply to anyone looking at the PR on GitHub.
 */

const MARKER_RE = /<!--\s*codeflow:reply-to\s+id=([^\s>]+)\s*-->/;

/** Matches the whole preamble block so it can be removed before display. */
const BLOCK_RE =
  /^\s*<!--\s*codeflow:reply-to\s+id=[^\s>]+\s*-->[\s\S]*?<!--\s*\/codeflow:reply-to\s*-->[^\S\r\n]*\r?\n?\r?\n?/;

/** Wrap a reply body so the comment it answers can be recovered on read. */
export function encodeIssueReplyBody(
  body: string,
  parentId: string,
  parentAuthor?: string,
): string {
  const attribution = parentAuthor
    ? `> _In reply to **@${parentAuthor}**_`
    : '> _In reply to an earlier comment_';

  return [
    `<!-- codeflow:reply-to id=${parentId} -->`,
    attribution,
    '<!-- /codeflow:reply-to -->',
    '',
    body,
  ].join('\n');
}

/** Read the parent comment id back out of a body, or null when there isn't one. */
export function decodeIssueReplyParent(body: string): string | null {
  const m = MARKER_RE.exec(body);
  return m ? m[1] : null;
}

/** Strip the marker preamble so only the user's own text is displayed. */
export function stripIssueReply(body: string): string {
  return body.replace(BLOCK_RE, '');
}
