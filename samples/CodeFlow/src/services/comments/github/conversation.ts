/**
 * Reading a pull request's conversation through GraphQL.
 *
 * One query covers both connections a pull request's comments live in:
 * `reviewThreads` (diff comments, already grouped into threads with their
 * resolution state and line metadata) and `comments` (PR-level "Description"
 * comments). Both are paged together until each runs out.
 *
 * GitHub returns comment bodies exactly as written, so hidden markers
 * (see anchorMarker.ts and issueReplyMarker.ts) survive the round trip.
 */
import { asRecord, gqlString, runGraphQl } from '../../graphQl';
import type { PrCoords } from './helpers';

/** GitHub's maximum page size for a GraphQL connection. */
export const PAGE_SIZE = 100;

/** Safety valve against a runaway cursor loop. */
const MAX_PAGES = 20;

/**
 * `undefined` means "this connection is finished"; `null` means "ask for the
 * first page"; a string is a cursor.
 */
export type Cursor = string | null | undefined;

function connectionArgs(cursor: Cursor, size = PAGE_SIZE): string {
  return cursor ? `(first: ${size}, after: ${gqlString(cursor)})` : `(first: ${size})`;
}

const COMMENT_FIELDS = 'id databaseId body url createdAt updatedAt author { login avatarUrl }';

/** Fragment selecting a pull request by owner, name and number. */
export function pullRequestSelector(coords: PrCoords): string {
  return (
    `repository(owner: ${gqlString(coords.owner)}, name: ${gqlString(coords.repo)}) ` +
    `{ pullRequest(number: ${Math.trunc(coords.pullNumber)})`
  );
}

/** Build one query covering whichever connections still have pages left. */
export function buildConversationQuery(coords: PrCoords, threads: Cursor, issueComments: Cursor): string {
  const sections: string[] = [];
  if (threads !== undefined) {
    sections.push(
      `reviewThreads${connectionArgs(threads)} { pageInfo { hasNextPage endCursor } ` +
        // `line` is null once a thread goes outdated; `originalLine` is the line
        // it was written against, and is the only one left at that point.
        'nodes { id isResolved isOutdated path diffSide startDiffSide line originalLine startLine originalStartLine ' +
        `comments(first: ${PAGE_SIZE}) { nodes { ${COMMENT_FIELDS} replyTo { id } } } } }`,
    );
  }
  if (issueComments !== undefined) {
    sections.push(
      `comments${connectionArgs(issueComments)} { pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } }`,
    );
  }
  return `query { ${pullRequestSelector(coords)} { ${sections.join(' ')} } } }`;
}

/** The cursor for the next page, or `undefined` when this connection is done. */
export function nextCursor(connection: Record<string, unknown> | undefined): Cursor {
  const info = asRecord(connection?.pageInfo);
  if (!info || info.hasNextPage !== true) return undefined;
  return typeof info.endCursor === 'string' ? info.endCursor : undefined;
}

function nodesOf(connection: Record<string, unknown> | undefined): Record<string, unknown>[] {
  const nodes = connection?.nodes;
  return Array.isArray(nodes) ? nodes.map(asRecord).filter((n): n is Record<string, unknown> => !!n) : [];
}

/** Every review thread and PR-level comment, as GraphQL nodes. */
export interface PullRequestConversation {
  reviewThreads: Record<string, unknown>[];
  issueComments: Record<string, unknown>[];
}

/**
 * Read the whole conversation of a pull request.
 *
 * Throws when GitHub can't be read (transport failure, permission, a GraphQL
 * error), so the caller can tell "couldn't read" from "no comments yet".
 */
export async function fetchConversation(coords: PrCoords): Promise<PullRequestConversation> {
  const out: PullRequestConversation = { reviewThreads: [], issueComments: [] };
  let threads: Cursor = null;
  let issues: Cursor = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (threads === undefined && issues === undefined) break;
    const data = await runGraphQl(
      buildConversationQuery(coords, threads, issues),
      'Could not read comments from GitHub',
      { strict: true },
    );
    const pr = asRecord(asRecord(asRecord(data)?.repository)?.pullRequest);
    if (!pr) throw new Error('Could not read comments from GitHub: the pull request was not found.');

    if (threads !== undefined) {
      const connection = asRecord(pr.reviewThreads);
      out.reviewThreads.push(...nodesOf(connection));
      threads = nextCursor(connection);
    }
    if (issues !== undefined) {
      const connection = asRecord(pr.comments);
      out.issueComments.push(...nodesOf(connection));
      issues = nextCursor(connection);
    }
  }
  return out;
}

/** Query for a pull request's node id (the subject of review and comment mutations). */
export function buildPullRequestIdQuery(coords: PrCoords): string {
  return `query { ${pullRequestSelector(coords)} { id } } }`;
}

const prNodeIds = new Map<string, string>();

/** The pull request's GraphQL node id, read once per pull request. */
export async function pullRequestNodeId(coords: PrCoords, known?: string): Promise<string> {
  if (known) return known;
  const key = `${coords.owner}/${coords.repo}#${coords.pullNumber}`.toLowerCase();
  const cached = prNodeIds.get(key);
  if (cached) return cached;
  const data = await runGraphQl(buildPullRequestIdQuery(coords), 'Could not find this pull request on GitHub', {
    strict: true,
  });
  const id = asRecord(asRecord(asRecord(data)?.repository)?.pullRequest)?.id;
  if (typeof id !== 'string' || !id) throw new Error('Could not find this pull request on GitHub.');
  prNodeIds.set(key, id);
  return id;
}

/** Test seam: forget cached pull request ids. */
export function resetPullRequestIdCache(): void {
  prNodeIds.clear();
}
