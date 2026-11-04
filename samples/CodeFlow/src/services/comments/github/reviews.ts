/**
 * Reading a pull request's reviews (votes) through GraphQL.
 */
import { asRecord, gqlString, runGraphQl } from '../../graphQl';
import { nextCursor, PAGE_SIZE, pullRequestSelector, type Cursor } from './conversation';
import type { PrCoords } from './helpers';

/** One review as the app needs it. */
export interface ReviewRecord {
  login: string;
  avatarUrl?: string;
  state: string;
  submittedAt: string;
  commitId?: string;
}

const MAX_PAGES = 20;

export function buildReviewsQuery(coords: PrCoords, cursor: Cursor): string {
  const args = cursor ? `(first: ${PAGE_SIZE}, after: ${gqlString(cursor)})` : `(first: ${PAGE_SIZE})`;
  return (
    `query { ${pullRequestSelector(coords)} { reviews${args} { pageInfo { hasNextPage endCursor } ` +
    'nodes { state submittedAt author { login avatarUrl } commit { oid } } } } } }'
  );
}

/**
 * Every review on the pull request, oldest first, across all pages. Throws when
 * GitHub can't be read, so callers can keep what they already show.
 */
export async function fetchReviews(coords: PrCoords): Promise<ReviewRecord[]> {
  const out: ReviewRecord[] = [];
  let cursor: Cursor = null;
  for (let page = 0; page < MAX_PAGES && cursor !== undefined; page += 1) {
    const data = await runGraphQl(buildReviewsQuery(coords, cursor), 'Could not read reviews', { strict: true });
    const connection = asRecord(asRecord(asRecord(asRecord(data)?.repository)?.pullRequest)?.reviews);
    if (!connection) throw new Error('Could not read reviews: the pull request was not found.');
    for (const node of Array.isArray(connection.nodes) ? connection.nodes : []) {
      const review = asRecord(node);
      const author = asRecord(review?.author);
      if (!review || typeof author?.login !== 'string') continue;
      const oid = asRecord(review.commit)?.oid;
      out.push({
        login: author.login,
        avatarUrl: typeof author.avatarUrl === 'string' ? author.avatarUrl : undefined,
        state: typeof review.state === 'string' ? review.state : 'COMMENTED',
        submittedAt: typeof review.submittedAt === 'string' ? review.submittedAt : '',
        commitId: typeof oid === 'string' && oid ? oid : undefined,
      });
    }
    cursor = nextCursor(connection);
  }
  return out;
}
