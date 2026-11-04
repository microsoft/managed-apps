/**
 * Reading a pull request's checks.
 *
 * GitHub keeps check results in two places — the Checks API and the
 * older commit-status API — and a PR often uses both at once: CI pipelines
 * typically report check runs, while some external services report status
 * contexts. `statusCheckRollup` is the only route that
 * returns them interleaved in one round trip, already deduplicated to the
 * latest run per context, so the pill costs exactly one request. Each context's
 * PR-specific `isRequired` distinguishes merge requirements from optional CI.
 *
 * Two fields are deliberately absent from the query:
 *
 * - `checkSuite { app { slug } }` would be the honest way to identify the
 *   provider, but the connector's grant can't resolve the app behind an Azure
 *   Pipelines suite and GraphQL answers with a partial result plus one
 *   `NOT_FOUND` error per row.
 * - `summary` is unbounded markdown. Some checks return tens of kilobytes of
 *   base64-encoded badge images there, which would dwarf the rest of the
 *   response. `title` is the one-liner we actually show.
 */

import type { ChecksSummary, CheckOutcome, PrCheck, PrCoordinates } from '../../types';

/**
 * How many contexts to read. GitHub caps a page at 100 and no PR observed here
 * comes close; a PR that exceeded it would show its first 100 rather than fail.
 */
const CONTEXT_PAGE = 100;

/** Build the rollup query for a pull request's head commit. */
export function buildChecksQuery(coords: PrCoordinates): string {
  // Owner and name are interpolated as JSON strings rather than pasted raw:
  // they originate in a user-typed PR reference, and a stray quote would
  // otherwise rewrite the query instead of failing to match.
  return (
    `query { repository(owner: ${JSON.stringify(coords.owner)}, ` +
    `name: ${JSON.stringify(coords.name)}) { ` +
    `pullRequest(number: ${coords.number}) { ` +
    'commits(last: 1) { nodes { commit { oid statusCheckRollup { ' +
    `contexts(first: ${CONTEXT_PAGE}) { totalCount nodes { __typename ` +
    '... on CheckRun { databaseId name status conclusion detailsUrl title ' +
    `isRequired(pullRequestNumber: ${coords.number}) } ` +
    '... on StatusContext { context state description targetUrl ' +
    `isRequired(pullRequestNumber: ${coords.number}) } ` +
    '} } } } } } } } }'
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Collapse a check run's status/conclusion pair into a single outcome.
 *
 * A run that hasn't completed has no conclusion yet, whatever it will
 * eventually say, so status is read first.
 */
export function checkRunOutcome(status: unknown, conclusion: unknown): CheckOutcome {
  if (str(status)?.toUpperCase() !== 'COMPLETED') return 'pending';
  switch (str(conclusion)?.toUpperCase()) {
    case 'SUCCESS':
      return 'success';
    // Neither of these blocks a merge: the check ran and declined to judge.
    case 'NEUTRAL':
    case 'SKIPPED':
      return 'neutral';
    case undefined:
      // Completed without saying how. Nothing to act on, so don't raise alarm.
      return 'neutral';
    default:
      // FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STARTUP_FAILURE, STALE.
      return 'failure';
  }
}

/** Collapse a legacy commit status's state into a single outcome. */
export function statusOutcome(state: unknown): CheckOutcome {
  switch (str(state)?.toUpperCase()) {
    case 'SUCCESS':
      return 'success';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      // FAILURE, ERROR.
      return 'failure';
  }
}

function normalizeContext(node: unknown): PrCheck | undefined {
  const row = asRecord(node);
  if (!row) return undefined;

  if (row.__typename === 'CheckRun') {
    const name = str(row.name) ?? '(unnamed check)';
    return {
      // The database id is what the GitHub checks page keys on; fall back to the
      // name only so a malformed row still renders as a non-clickable entry.
      id: row.databaseId == null ? name : String(row.databaseId),
      name,
      outcome: checkRunOutcome(row.status, row.conclusion),
      rawState: str(row.conclusion) ?? str(row.status) ?? 'UNKNOWN',
      description: str(row.title),
      kind: 'check',
      isRequired: typeof row.isRequired === 'boolean' ? row.isRequired : undefined,
      detailsUrl: str(row.detailsUrl),
    };
  }

  if (row.__typename === 'StatusContext') {
    const name = str(row.context) ?? '(unnamed status)';
    return {
      id: name,
      name,
      outcome: statusOutcome(row.state),
      rawState: str(row.state) ?? 'UNKNOWN',
      description: str(row.description),
      kind: 'status',
      isRequired: typeof row.isRequired === 'boolean' ? row.isRequired : undefined,
      detailsUrl: str(row.targetUrl),
    };
  }

  return undefined;
}

/** Count outcomes, accepting skipped/neutral results alongside success. */
export function tally(
  checks: PrCheck[],
): Pick<ChecksSummary, 'passed' | 'failed' | 'pending' | 'total'> {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const check of checks) {
    if (check.outcome === 'failure') failed += 1;
    else if (check.outcome === 'pending') pending += 1;
    // Success and neutral both count as passing: a skipped or neutral check
    // isn't blocking the merge, and counting it against the total would leave
    // the pill permanently short of its denominator with nothing to fix.
    else passed += 1;
  }
  return { passed, failed, pending, total: checks.length };
}

/** Unknown requirements must never be guessed from a check's name or outcome. */
export function tallyRequired(checks: PrCheck[]): ReturnType<typeof tally> {
  return tally(checks.filter((check) => check.isRequired === true));
}

/** Rank for display: what needs attention first, what's already fine last. */
const ORDER: Record<CheckOutcome, number> = { failure: 0, pending: 1, success: 2, neutral: 2 };

/**
 * Normalize a rollup response into a summary.
 *
 * Returns `undefined` only when the response has no head commit at all — an
 * unreadable or empty PR. A commit with no checks configured is a real answer
 * and comes back as an empty summary, so the UI can say "no checks" rather
 * than showing an error.
 */
export function parseChecks(data: unknown): ChecksSummary | undefined {
  const nodes = asRecord(
    asRecord(asRecord(asRecord(data)?.repository)?.pullRequest)?.commits,
  )?.nodes;
  const commit = Array.isArray(nodes) ? asRecord(asRecord(nodes[0])?.commit) : undefined;
  if (!commit) return undefined;

  const contexts = asRecord(asRecord(commit.statusCheckRollup)?.contexts)?.nodes;

  const checks: PrCheck[] = [];
  if (Array.isArray(contexts)) {
    for (const node of contexts) {
      const check = normalizeContext(node);
      if (check) checks.push(check);
    }
  }

  checks.sort((a, b) =>
    Number(b.isRequired === true) - Number(a.isRequired === true) ||
    ORDER[a.outcome] - ORDER[b.outcome] ||
    a.name.localeCompare(b.name),
  );

  return { checks, sha: str(commit.oid) ?? '', ...tally(checks) };
}
