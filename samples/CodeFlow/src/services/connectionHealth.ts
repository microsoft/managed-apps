import { describeError } from './errors';

/**
 * Detecting — and explaining — a GitHub connection that has quietly stopped
 * authenticating.
 *
 * The Power Platform connector relays our requests to GitHub with the
 * reviewer's OAuth token attached. When that authorization lapses the
 * connector keeps relaying them, just without a credential, and GitHub answers
 * as though we were an anonymous caller arriving from the gateway's shared
 * egress IP: 60 core requests an hour and 10 searches a minute, pooled across
 * every anonymous caller on that address. One reviewer drains that alone, in
 * seconds, and it reads exactly like being singled out for throttling.
 *
 * The platform is no help in spotting this: it still reports the connection as
 * `Connected` and `isConsented` long after GitHub has stopped accepting it. So
 * the only trustworthy signal is GitHub's own wording, which happens to
 * distinguish the two cases precisely:
 *
 *   anonymous      "API rate limit exceeded for 20.83.220.230."
 *   authenticated  "API rate limit exceeded for user ID 12345."
 *
 * A limit keyed to an IP address can only mean no credential was presented.
 * The same goes for a 401 saying "Must authenticate to access this API." — an
 * expired-but-present token would say "Bad credentials" instead.
 */

/** An error carrying the HTTP status the connector reported, where known. */
export class GitHubApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

/**
 * `unauthenticated` — the connection is sending no usable credential, so
 * reconnecting is the only fix. `rate-limited` — the credential works but its
 * quota is spent, which time alone resolves.
 */
export type ConnectionFaultKind = 'unauthenticated' | 'rate-limited';

export interface ConnectionFault {
  kind: ConnectionFaultKind;
  /** GitHub's own message, kept for display and diagnostics. */
  message: string;
  /** When the fault was observed, for cooldown arithmetic. */
  at: number;
}

/** "…exceeded for 20.83.220.230" — keyed to an IP, so nobody was signed in. */
const IP_RATE_LIMIT = /rate limit exceeded for (?:\d{1,3}\.){3}\d{1,3}/i;
/** Any other phrasing of the same 403 means the token was accepted first. */
const ANY_RATE_LIMIT = /rate limit exceeded/i;
/** GitHub's 401 when a request arrives with no credential at all. */
const MUST_AUTHENTICATE = /must authenticate to access this api/i;
/** GitHub's 401 when a credential is present but rejected. */
const BAD_CREDENTIALS = /bad credentials/i;

/**
 * Whether an error is the connection failing to authenticate, its quota being
 * spent, or something unrelated (`undefined`).
 */
export function classifyConnectionFault(err: unknown): ConnectionFaultKind | undefined {
  const message = describeError(err);
  if (MUST_AUTHENTICATE.test(message) || BAD_CREDENTIALS.test(message)) {
    return 'unauthenticated';
  }
  // Order matters: an IP-keyed limit is an authentication problem wearing a
  // rate-limit's clothes, and must be caught before the generic test below.
  if (IP_RATE_LIMIT.test(message)) return 'unauthenticated';
  if (ANY_RATE_LIMIT.test(message)) return 'rate-limited';
  return undefined;
}

/**
 * How long to stop calling GitHub after a fault.
 *
 * Neither fault clears by being retried — an unauthenticated connection needs
 * a human, and a spent quota needs a clock — so every request made during this
 * window is pure waste, and in the anonymous case actively harmful: each one
 * takes a slot from a 60-per-hour pool shared with every other anonymous
 * caller on the gateway. A minute is long enough to collapse a retry storm
 * into a single call, short enough that a reviewer who fixes their connection
 * isn't left staring at a stale error.
 */
export const FAULT_COOLDOWN_MS = 60_000;

let current: ConnectionFault | undefined;

/** Record a fault if the error looks like one. Returns the kind it matched. */
export function noteConnectionFault(err: unknown, now = Date.now()): ConnectionFaultKind | undefined {
  const kind = classifyConnectionFault(err);
  if (!kind) return undefined;
  current = { kind, message: describeError(err), at: now };
  return kind;
}

/** Forget the fault — call after any successful request, or on manual retry. */
export function clearConnectionFault(): void {
  current = undefined;
}

/** The active fault, or `undefined` once its cooldown has elapsed. */
export function getConnectionFault(now = Date.now()): ConnectionFault | undefined {
  if (!current) return undefined;
  if (now - current.at >= FAULT_COOLDOWN_MS) {
    current = undefined;
    return undefined;
  }
  return current;
}

/**
 * Whether calls should fail fast instead of going to the network.
 *
 * Only an unauthenticated connection trips the breaker. A spent quota is worth
 * surfacing but not worth blocking on: the reviewer may hold several tokens'
 * worth of headroom across resources, and the reset is usually seconds away.
 */
export function isCircuitOpen(now = Date.now()): boolean {
  return getConnectionFault(now)?.kind === 'unauthenticated';
}

/** The error to reject with while the breaker is open. */
export function circuitError(fault: ConnectionFault): GitHubApiError {
  return new GitHubApiError(fault.message, 401);
}

/*
 * There is deliberately no "repair this yourself" link here.
 *
 * The reviewer does own the broken connection — OAuth connections cannot be
 * shared (`allowSharing: false`), so the connector mints one per reviewer. But
 * owning it is not the same as being able to reach it: the only management
 * surface is make.powerapps.com, which requires a role in the *environment the
 * app is deployed to*. For a reviewer invited to an app in someone's personal
 * developer environment, that role will never exist.
 *
 * The host has the machinery to fix this without any of that — a consent flow
 * it already used to create the connection in the first place — but it is out
 * of reach from app code:
 *
 *   - `challenge/consent` and `data/ensureConnectionsReady` are host channel
 *     methods registered on the *worker* channel; apps talk over the `sdk`
 *     channel, which is only given `data/getAppConnections`.
 *   - The host's own auto-repair (`recreateConnection`) fires only on a 404
 *     with a specific header — a *deleted* connection — never on a 401 or 403.
 *   - The host decides a connection is healthy with
 *     `statuses[0].status !== 'error'`. A credential that has quietly stopped
 *     working still reports `Connected`, so the host never re-prompts.
 *
 * Which leaves telling someone who can act. Hence the banner's only real
 * affordance is to open the feedback dialog.
 */
