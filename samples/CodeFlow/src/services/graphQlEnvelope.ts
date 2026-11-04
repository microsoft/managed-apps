/**
 * Reading what came back from a GraphQL call.
 *
 * Split from {@link ./graphQl} on purpose: everything here is pure string and
 * object work, so it stays importable without dragging in the connector client
 * — which is what lets the query-building modules next door be tested on their
 * own, with no host runtime present.
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * Pull the first error message out of a GraphQL envelope.
 *
 * GraphQL answers `200 OK` with an `errors` array for everything from a
 * permission refusal to a malformed mutation, so this is the only place a
 * failed write announces itself. Partial successes carry both `data` and
 * `errors`; callers check the data first and only fall back to this.
 */
export function graphQlErrorMessage(envelope: unknown): string | undefined {
  const errors = asRecord(envelope)?.errors;
  if (!Array.isArray(errors)) return undefined;
  for (const entry of errors) {
    const message = asRecord(entry)?.message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return errors.length > 0 ? 'GitHub rejected the request.' : undefined;
}

/**
 * The payload inside a connector response.
 *
 * The connector wraps GitHub's reply in its own envelope, so what a caller
 * wants sits one level down under a second `data` key.
 */
export function graphQlPayload(envelope: unknown): unknown {
  return asRecord(envelope)?.data;
}
