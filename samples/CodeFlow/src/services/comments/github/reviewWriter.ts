/**
 * Writing comments and reviews to GitHub through GraphQL mutations.
 *
 * A new diff comment is created the way GitHub's own UI does it: open a pending
 * review, add the thread to it, submit it as a COMMENT. Replies, PR-level
 * comments and review votes are single mutations.
 */
import type { CommentThread, GitUserRef } from '../../../types';
import type { CreateThreadInput } from '../CommentStore';
import { asRecord, gqlString, runGraphQl, runGraphQlMutation } from '../../graphQl';
import { createLogger } from '../../../lib/logger';
import { assertCommentRange } from '../../../utils/commentRange';
import { encodeAnchoredBody, isOutOfDiffError } from './anchorMarker';
import { encodeIssueReplyBody } from './issueReplyMarker';
import { pullRequestNodeId, pullRequestSelector } from './conversation';
import type { PrCoords } from './helpers';

const log = createLogger('comments');

/** Review events GitHub accepts when submitting a review. */
export type ReviewVoteEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------ Mutations ------------------------------ */

export function buildAddPendingReviewMutation(pullRequestId: string, commitOid?: string): string {
  const commit = commitOid ? `, commitOID: ${gqlString(commitOid)}` : '';
  return `mutation { addPullRequestReview(input: { pullRequestId: ${gqlString(pullRequestId)}${commit} }) { pullRequestReview { id } } }`;
}

export function buildPendingReviewsQuery(coords: PrCoords): string {
  return `query { ${pullRequestSelector(coords)} { reviews(first: 20, states: PENDING) { nodes { id viewerDidAuthor } } } } }`;
}

export function buildDeleteReviewMutation(reviewId: string): string {
  return `mutation { deletePullRequestReview(input: { pullRequestReviewId: ${gqlString(reviewId)} }) { pullRequestReview { id } } }`;
}

export interface ThreadPlacement {
  path: string;
  body: string;
  /** Omitted for a file-level thread. */
  line?: number;
  startLine?: number;
  side?: 'LEFT' | 'RIGHT';
  subjectType: 'LINE' | 'FILE';
}

export function buildAddThreadMutation(reviewId: string, placement: ThreadPlacement): string {
  const fields = [
    `pullRequestReviewId: ${gqlString(reviewId)}`,
    `path: ${gqlString(placement.path)}`,
    `body: ${gqlString(placement.body)}`,
  ];
  if (placement.subjectType === 'LINE' && placement.line !== undefined) {
    fields.push(`line: ${Math.trunc(placement.line)}`, `side: ${placement.side ?? 'RIGHT'}`);
    if (placement.startLine !== undefined) {
      fields.push(`startLine: ${Math.trunc(placement.startLine)}`, `startSide: ${placement.side ?? 'RIGHT'}`);
    }
  }
  fields.push(`subjectType: ${placement.subjectType}`);
  return (
    `mutation { addPullRequestReviewThread(input: { ${fields.join(', ')} }) ` +
    '{ thread { id comments(first: 1) { nodes { id databaseId url createdAt } } } } }'
  );
}

export function buildSubmitReviewMutation(reviewId: string, event: ReviewVoteEvent): string {
  return `mutation { submitPullRequestReview(input: { pullRequestReviewId: ${gqlString(reviewId)}, event: ${event} }) { pullRequestReview { id state } } }`;
}

export function buildReplyMutation(threadNodeId: string, body: string): string {
  return (
    `mutation { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: ${gqlString(threadNodeId)}, ` +
    `body: ${gqlString(body)} }) { comment { id databaseId url createdAt } } }`
  );
}

export function buildAddCommentMutation(subjectId: string, body: string): string {
  return (
    `mutation { addComment(input: { subjectId: ${gqlString(subjectId)}, body: ${gqlString(body)} }) ` +
    '{ commentEdge { node { id databaseId url createdAt } } } }'
  );
}

export function buildReviewVoteMutation(
  pullRequestId: string,
  event: ReviewVoteEvent,
  commitOid?: string,
  body?: string,
): string {
  const fields = [`pullRequestId: ${gqlString(pullRequestId)}`, `event: ${event}`];
  if (commitOid) fields.push(`commitOID: ${gqlString(commitOid)}`);
  if (body) fields.push(`body: ${gqlString(body)}`);
  return `mutation { addPullRequestReview(input: { ${fields.join(', ')} }) { pullRequestReview { id state } } }`;
}

/* ------------------------------- Helpers ------------------------------- */

function reviewIdOf(payload: unknown, field: string): string | undefined {
  const id = asRecord(asRecord(asRecord(payload)?.[field])?.pullRequestReview)?.id;
  return typeof id === 'string' && id ? id : undefined;
}

/** Delete this reviewer's own pending review, if there is one. */
async function deleteOwnPendingReview(coords: PrCoords): Promise<void> {
  const data = await runGraphQl(buildPendingReviewsQuery(coords), 'Could not read pending reviews', { strict: true });
  const nodes = asRecord(asRecord(asRecord(asRecord(data)?.repository)?.pullRequest)?.reviews)?.nodes;
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const review = asRecord(node);
    if (review?.viewerDidAuthor === true && typeof review.id === 'string') {
      await runGraphQlMutation(buildDeleteReviewMutation(review.id), 'Could not discard a pending review');
    }
  }
}

/**
 * Open a pending review. GitHub allows one pending review per person per pull
 * request, so a leftover from an earlier failed attempt is discarded and the
 * open retried once.
 */
async function openPendingReview(coords: PrCoords, pullRequestId: string, commitOid?: string): Promise<string> {
  const what = 'Could not start a review';
  let payload: unknown;
  try {
    payload = await runGraphQlMutation(buildAddPendingReviewMutation(pullRequestId, commitOid), what);
  } catch (error) {
    if (!/pending review/i.test(errorMessage(error))) throw error;
    await deleteOwnPendingReview(coords);
    payload = await runGraphQlMutation(buildAddPendingReviewMutation(pullRequestId, commitOid), what);
  }
  const id = reviewIdOf(payload, 'addPullRequestReview');
  if (!id) throw new Error(`${what}: GitHub returned no review.`);
  return id;
}

/** Best-effort cleanup, so a failed comment never leaves a pending review behind. */
async function discardReview(reviewId: string): Promise<void> {
  try {
    await runGraphQlMutation(buildDeleteReviewMutation(reviewId), 'Could not discard the pending review');
  } catch (error) {
    log.warn('failed to discard pending review after an error', error);
  }
}

interface CreatedThread {
  threadId: string;
  commentNodeId?: string;
  commentId?: string;
  url?: string;
}

function parseCreatedThread(payload: unknown): CreatedThread | undefined {
  const thread = asRecord(asRecord(asRecord(payload)?.addPullRequestReviewThread)?.thread);
  if (!thread || typeof thread.id !== 'string') return undefined;
  const nodes = asRecord(thread.comments)?.nodes;
  const first = asRecord(Array.isArray(nodes) ? nodes[0] : undefined);
  return {
    threadId: thread.id,
    commentNodeId: typeof first?.id === 'string' ? first.id : undefined,
    commentId: first?.databaseId != null ? String(first.databaseId) : undefined,
    url: typeof first?.url === 'string' ? first.url : undefined,
  };
}

/* ------------------------------- Writes -------------------------------- */

/**
 * Create a new review thread: open a pending review, add the thread (falling
 * back to a file-level thread with an anchor marker when the line is outside
 * the diff), then submit the review as a COMMENT.
 */
export async function createReviewThread(
  input: CreateThreadInput,
  coords: PrCoords,
  knownPullRequestId?: string,
): Promise<CommentThread> {
  assertCommentRange(input);
  const pullRequestId = await pullRequestNodeId(coords, knownPullRequestId);
  const reviewId = await openPendingReview(coords, pullRequestId, input.commitSha);

  let created: CreatedThread | undefined;
  try {
    const side = input.side === 'left' ? 'LEFT' : 'RIGHT';
    // GitHub refuses line anchors outside the diff. Through GraphQL that usually
    // arrives as a null thread with no error at all (observed live), and
    // sometimes as an error; either way fall back to a file-level comment
    // carrying an anchor marker, which is re-anchored on read.
    let outOfDiff = false;
    try {
      const payload = await runGraphQlMutation(
        buildAddThreadMutation(reviewId, {
          path: input.filename,
          body: input.body,
          line: input.line,
          startLine: input.startLine,
          side,
          subjectType: 'LINE',
        }),
        'Could not add the comment',
      );
      created = parseCreatedThread(payload);
      outOfDiff = !created;
    } catch (error) {
      if (!isOutOfDiffError(errorMessage(error))) throw error;
      outOfDiff = true;
    }
    if (outOfDiff) {
      log.info('line is outside the diff; retrying as a file-level comment');
      const payload = await runGraphQlMutation(
        buildAddThreadMutation(reviewId, {
          path: input.filename,
          body: encodeAnchoredBody(
            input.body,
            { line: input.line, startLine: input.startLine, side: input.side },
            input.lineText,
          ),
          subjectType: 'FILE',
        }),
        'Could not add the comment',
      );
      created = parseCreatedThread(payload);
    }
    if (!created) throw new Error('Could not add the comment: GitHub returned no thread.');

    const submitted = await runGraphQlMutation(
      buildSubmitReviewMutation(reviewId, 'COMMENT'),
      'Could not submit the comment',
    );
    if (!reviewIdOf(submitted, 'submitPullRequestReview')) {
      throw new Error('Could not submit the comment: GitHub returned no review.');
    }
  } catch (error) {
    await discardReview(reviewId);
    throw error;
  }

  const now = new Date().toISOString();
  return {
    id: created.threadId,
    threadNodeId: created.threadId,
    prKey: input.prKey,
    filename: input.filename,
    side: input.side,
    line: input.line,
    startLine: input.startLine,
    status: 'active',
    comments: [
      {
        id: created.commentId ?? created.threadId,
        author: input.author,
        body: input.body,
        createdAt: now,
        local: false,
        ...(created.commentNodeId ? { nodeId: created.commentNodeId } : {}),
        ...(created.url ? { htmlUrl: created.url } : {}),
      },
    ],
    createdAt: now,
    updatedAt: now,
    iterationIndex: input.iterationIndex,
  };
}

/** Reply to an existing review thread (addressed by its `PRRT_…` node id). */
export async function replyToThread(
  threadNodeId: string,
  body: string,
  author: GitUserRef,
  prKey: string,
  listThreadsFn: (prKey: string) => Promise<CommentThread[]>,
  previous?: CommentThread,
): Promise<CommentThread> {
  const payload = await runGraphQlMutation(buildReplyMutation(threadNodeId, body), 'Could not add the reply');
  if (!asRecord(asRecord(asRecord(payload)?.addPullRequestReviewThreadReply)?.comment)) {
    throw new Error('Could not add the reply: GitHub returned no comment.');
  }
  return refetchThread(previous?.id ?? threadNodeId, prKey, author, body, listThreadsFn, previous);
}

/** Post a PR-level ("Description") comment. */
export async function addPullRequestComment(coords: PrCoords, body: string, knownPullRequestId?: string): Promise<void> {
  const pullRequestId = await pullRequestNodeId(coords, knownPullRequestId);
  const payload = await runGraphQlMutation(buildAddCommentMutation(pullRequestId, body), 'Could not add the comment');
  if (!asRecord(asRecord(asRecord(asRecord(payload)?.addComment)?.commentEdge)?.node)) {
    throw new Error('Could not add the comment: GitHub returned no comment.');
  }
}

/**
 * Reply to a PR-level ("Description") comment.
 *
 * GitHub doesn't thread issue comments, so the reply is another PR-level
 * comment carrying a marker naming its parent, which the parser uses to fold it
 * back into the same thread.
 */
export async function replyToIssueComment(
  coords: PrCoords,
  thread: CommentThread,
  body: string,
  author: GitUserRef,
  prKey: string,
  listThreadsFn: (prKey: string) => Promise<CommentThread[]>,
): Promise<CommentThread> {
  await addPullRequestComment(coords, encodeIssueReplyBody(body, thread.id, thread.comments[0]?.author.login));
  return refetchThread(thread.id, prKey, author, body, listThreadsFn, thread);
}

/** Submit a review vote (Approve / Request changes / Comment) on the given commit. */
export async function submitReviewVote(
  coords: PrCoords,
  event: ReviewVoteEvent,
  options: { commitOid?: string; body?: string; pullRequestId?: string } = {},
): Promise<void> {
  const pullRequestId = await pullRequestNodeId(coords, options.pullRequestId);
  const payload = await runGraphQlMutation(
    buildReviewVoteMutation(pullRequestId, event, options.commitOid, options.body),
    'Review failed',
  );
  if (!reviewIdOf(payload, 'addPullRequestReview')) {
    throw new Error('Review failed: GitHub did not confirm the submission.');
  }
}

/** Re-read the thread after a successful write, with a local fallback. */
async function refetchThread(
  threadId: string,
  prKey: string,
  author: GitUserRef,
  body: string,
  listThreadsFn: (prKey: string) => Promise<CommentThread[]>,
  previous?: CommentThread,
): Promise<CommentThread> {
  const threads = await listThreadsFn(prKey).catch(() => [] as CommentThread[]);
  const thread = threads.find((t) => t.id === threadId);
  if (thread) return thread;

  // The write succeeded but the re-read didn't find the thread (for example a
  // brief replication delay). Keep what the caller had, plus the new reply.
  log.warn(`replyToThread fallback: thread ${threadId} not found after a successful reply`);
  const now = new Date().toISOString();
  const reply = { id: `reply-${Date.now()}`, author, body, createdAt: now };
  if (previous) {
    return { ...previous, comments: [...previous.comments, reply], updatedAt: now };
  }
  return {
    id: threadId,
    prKey,
    filename: '',
    side: 'right',
    line: 0,
    status: 'active',
    comments: [reply],
    createdAt: now,
    updatedAt: now,
  };
}
