/**
 * The one way this app talks GraphQL to GitHub.
 *
 * Everything beyond the handful of REST operations the connector exposes goes
 * through here: reading and writing review comments and reviews, changed files,
 * file contents, branches, cherry-pick commits, publishing a draft and
 * enabling auto-merge. All of it uses the connector's `SearchGithubWithQuery`,
 * whose name undersells it — it forwards an arbitrary document, mutations
 * included. It takes no variables, so values are inlined as literals (see
 * {@link gqlString}).
 *
 * The unwrapping is fiddly enough to be worth having in exactly one place: the
 * connector wraps GitHub's reply in its own envelope, so the payload a caller
 * wants sits two levels down, and a GraphQL failure arrives as a `200 OK` with
 * an `errors` array rather than as a transport error.
 */

import type { IOperationResult } from '@microsoft/managed-apps/data';
import { githubClient } from '../connectors/github';
import { createLogger } from '../lib/logger';
import { graphQlErrorMessage, graphQlPayload } from './graphQlEnvelope';

export { graphQlErrorMessage, graphQlPayload } from './graphQlEnvelope';

const log = createLogger('graphql');

/** Options for {@link runGraphQl}. */
export interface RunGraphQlOptions {
  /**
   * Treat any `errors` entry as a failure, even when some data came back.
   * Use it for writes: a mutation that reports an error has not done what was asked.
   */
  strict?: boolean;
}

/**
 * Run one GraphQL document and return its `data` payload.
 *
 * `what` is the caller's own phrasing of the failure ("Could not publish this
 * pull request"), used as the prefix of any error thrown, so the person who
 * pressed the button reads about the thing they pressed rather than about
 * GraphQL.
 *
 * Throws on a transport failure or on a GraphQL error that left nothing to
 * read (or on any GraphQL error with `strict`), so callers only ever see a
 * payload they can parse.
 */
export async function runGraphQl(query: string, what: string, options: RunGraphQlOptions = {}): Promise<unknown> {
  const result = await githubClient.graphql(query);
  if (!result || !result.success) {
    log.warn('graphql call failed', result?.error);
    const detail = result?.error instanceof Error ? result.error.message : undefined;
    throw new Error(detail ? `${what}: ${detail}` : `${what}.`);
  }

  const envelope = (result as unknown as IOperationResult<unknown>).data;
  const payload = graphQlPayload(envelope);

  // Outside strict mode a GraphQL error is only fatal when it left us with
  // nothing to read: a query can succeed and still report a `NOT_FOUND` on
  // some field we selected but don't use.
  const message = graphQlErrorMessage(envelope);
  if (message && (options.strict || !payload)) throw new Error(`${what}: ${message}`);
  if (!payload) throw new Error(`${what}.`);
  return payload;
}

/** Run a mutation; any GraphQL error is a failure. */
export function runGraphQlMutation(mutation: string, what: string): Promise<unknown> {
  return runGraphQl(mutation, what, { strict: true });
}

/** GraphQL string literals share JSON's escaping rules. */
export function gqlString(value: string): string {
  return JSON.stringify(value);
}

/** Narrow an unknown value to a plain object. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
