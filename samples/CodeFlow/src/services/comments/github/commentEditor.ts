/**
 * Rewriting the body of a comment that's already on GitHub.
 *
 * GraphQL-only, and for the same reason publishing a draft is: the connector's
 * generated client has no operation that updates a comment. `UpdatePullRequest`,
 * `UpdateIssueNum` and `UpdateMilestone` are the whole of its update surface,
 * and none of them touch a comment body.
 *
 * So this goes out the same door as the rest of the comment write path: a mutation through the
 * connector's `SearchGithubWithQuery`, which passes the document through
 * unaltered and hands back the raw envelope.
 *
 * The two mutations differ because GitHub models the two comment kinds
 * separately — a review comment hangs off a diff thread, a Description comment
 * off the issue — and their inputs don't even agree on what to call the id.
 */

import type { IOperationResult } from '@microsoft/managed-apps/data';
import { githubClient } from '../../../connectors/github';
import { graphQlErrorMessage } from '../../draft/draftQuery';

/** Which mutation applies, decided by the thread rather than by the id's shape. */
export type CommentKind = 'review' | 'issue';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * Build the mutation that rewrites one comment.
 *
 * Both the id and the body are interpolated as JSON strings. For the body that
 * is not belt and braces: it is typed by a person, so it will contain quotes,
 * backslashes and newlines as a matter of course, and JSON's string escaping is
 * exactly GraphQL's. Pasting it raw would break on the first apostrophe-free
 * quotation mark, and on a mutation a broken document is a document that writes
 * something other than what was asked for.
 */
export function buildUpdateCommentMutation(kind: CommentKind, nodeId: string, body: string): string {
  const id = JSON.stringify(nodeId);
  const text = JSON.stringify(body);
  return kind === 'review'
    ? 'mutation { updatePullRequestReviewComment(input: { pullRequestReviewCommentId: ' +
        `${id}, body: ${text} }) { pullRequestReviewComment { id body } } }`
    : `mutation { updateIssueComment(input: { id: ${id}, body: ${text} }) ` +
        '{ issueComment { id body } } }';
}

/**
 * Read the body GitHub says the comment now has.
 *
 * Returned so the caller can trust the server's copy rather than assuming its
 * own text landed verbatim; `undefined` means the mutation returned no payload,
 * which is a failure the envelope's `errors` will explain.
 */
export function parseUpdatedCommentBody(kind: CommentKind, payload: unknown): string | undefined {
  const root = asRecord(payload);
  const comment =
    kind === 'review'
      ? asRecord(asRecord(root?.updatePullRequestReviewComment)?.pullRequestReviewComment)
      : asRecord(asRecord(root?.updateIssueComment)?.issueComment);
  const body = comment?.body;
  return typeof body === 'string' ? body : undefined;
}

/**
 * Rewrite a comment body and resolve with what GitHub stored.
 *
 * Throws rather than returning a failure: an edit is a write the reviewer
 * explicitly asked for, and the caller rolls the optimistic update back on the
 * throw. GitHub refuses an edit by anyone but the author, and that refusal
 * arrives as a `200 OK` carrying an `errors` array, so the envelope is the only
 * place it can be noticed.
 */
export async function updateCommentBody(
  kind: CommentKind,
  nodeId: string,
  body: string,
): Promise<string> {
  const query = buildUpdateCommentMutation(kind, nodeId, body);
  const result = await githubClient.graphql(query);
  if (!result || !result.success) {
    const detail = result?.error instanceof Error ? result.error.message : undefined;
    throw new Error(detail ? `Could not save this comment: ${detail}` : 'Could not save this comment.');
  }

  // The connector hands back the raw GraphQL envelope, so the payload sits one
  // level down under its own `data` key.
  const envelope = (result as unknown as IOperationResult<unknown>).data;
  const payload = asRecord(envelope)?.data;

  const updated = parseUpdatedCommentBody(kind, payload);
  if (updated === undefined) {
    const message = graphQlErrorMessage(envelope);
    throw new Error(message ? `Could not save this comment: ${message}` : 'Could not save this comment.');
  }
  return updated;
}
