import { describe, it, expect } from 'vitest';
import {
  buildChecksQuery,
  checkRunOutcome,
  parseChecks,
  statusOutcome,
  tally,
  tallyRequired,
  } from '../checksQuery';
import type { PrCheck } from '../../../types';

const COORDS = { owner: 'octo-org', name: 'octo-repo', number: 123 };

/** A trimmed-down copy of a real rollup response from the connector. */
function payload(nodes: unknown[], oid = 'abc1234def5678'): unknown {
  return {
    repository: {
      pullRequest: {
        commits: {
          nodes: [
            {
              commit: {
                oid,
                statusCheckRollup: { contexts: { totalCount: nodes.length, nodes } },
              },
            },
          ],
        },
      },
    },
  };
}

function checkRun(over: Record<string, unknown> = {}): unknown {
  return {
    __typename: 'CheckRun',
    databaseId: 991,
    name: 'Build',
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    isRequired: true,
    detailsUrl: 'https://www.example.com',
    title: 'Build succeeded',
    ...over,
  };
}

describe('buildChecksQuery', () => {
  it('addresses the head commit of the requested pull request', () => {
    const q = buildChecksQuery(COORDS);
    expect(q).toContain('owner: "octo-org"');
    expect(q).toContain('name: "octo-repo"');
    expect(q).toContain('pullRequest(number: 123)');
    expect(q).toContain('commits(last: 1)');
    expect(q).toContain('statusCheckRollup');
  });

  it('asks for both context shapes', () => {
    const q = buildChecksQuery(COORDS);
    expect(q).toContain('... on CheckRun');
    expect(q).toContain('... on StatusContext');
    expect(q).toContain('title isRequired(pullRequestNumber: 123)');
    expect(q).toContain('targetUrl isRequired(pullRequestNumber: 123)');
  });

  it('omits the fields the connector cannot serve', () => {
    // `app { slug }` errors on Azure Pipelines suites and `summary` returns
    // kilobytes of embedded badge images. Both are deliberately absent.
    const q = buildChecksQuery(COORDS);
    expect(q).not.toContain('slug');
    expect(q).not.toContain('summary');
  });

  it('escapes a repository name that would otherwise break out of the query', () => {
    const q = buildChecksQuery({ owner: 'o', name: 'we"ird', number: 2 });
    expect(q).toContain('name: "we\\"ird"');
  });
});

describe('checkRunOutcome', () => {
  it('reads status before conclusion, because an unfinished run has none', () => {
    expect(checkRunOutcome('IN_PROGRESS', null)).toBe('pending');
    expect(checkRunOutcome('QUEUED', null)).toBe('pending');
    expect(checkRunOutcome('WAITING', 'SUCCESS')).toBe('pending');
  });

  it('treats non-judgements as neutral rather than failure', () => {
    expect(checkRunOutcome('COMPLETED', 'NEUTRAL')).toBe('neutral');
    expect(checkRunOutcome('COMPLETED', 'SKIPPED')).toBe('neutral');
    expect(checkRunOutcome('COMPLETED', null)).toBe('neutral');
  });

  it('treats every blocking conclusion as failure', () => {
    for (const c of ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']) {
      expect(checkRunOutcome('COMPLETED', c)).toBe('failure');
    }
  });

  it('passes a successful run', () => {
    expect(checkRunOutcome('COMPLETED', 'SUCCESS')).toBe('success');
  });
});

describe('statusOutcome', () => {
  it('maps the legacy status states', () => {
    expect(statusOutcome('SUCCESS')).toBe('success');
    expect(statusOutcome('PENDING')).toBe('pending');
    expect(statusOutcome('EXPECTED')).toBe('pending');
    expect(statusOutcome('FAILURE')).toBe('failure');
    expect(statusOutcome('ERROR')).toBe('failure');
  });
});

describe('tally', () => {
  const check = (outcome: PrCheck['outcome'], name = 'x'): PrCheck => ({
    id: name,
    name,
    outcome,
    rawState: outcome,
    kind: 'check',
    
    isRequired: true,
  });

  it('counts neutral alongside success, so the denominator stays reachable', () => {
    const result = tally([check('success', 'a'), check('neutral', 'b')]);
    expect(result).toEqual({ passed: 2, failed: 0, pending: 0, total: 2 });
  });

  it('separates failing and running work', () => {
    const result = tally([
      check('success', 'a'),
      check('failure', 'b'),
      check('pending', 'c'),
      check('pending', 'd'),
    ]);
    expect(result).toEqual({ passed: 1, failed: 1, pending: 2, total: 4 });
  });

  it('counts only confirmed required checks for merge advice, including status contexts', () => {
    expect(tallyRequired([
      check('success'),
      check('neutral'),
      { ...check('failure'), kind: 'status' },
      check('pending'),
      { ...check('failure'), isRequired: false },
      { ...check('pending'), kind: 'status', isRequired: false },
      { ...check('failure'), isRequired: undefined },
    ])).toEqual({ passed: 2, failed: 1, pending: 1, total: 4 });
  });
});

describe('parseChecks', () => {
  it('normalizes a mixed run/status payload', () => {
    const summary = parseChecks(
      payload([
        checkRun({ databaseId: 1, name: 'ci/build', conclusion: 'FAILURE', title: undefined }),
        checkRun({ databaseId: 2, name: 'Build' }),
        {
          __typename: 'StatusContext',
          context: 'ai-review',
          state: 'PENDING',
          isRequired: true,
          description: 'Scanning…',
          targetUrl: 'https://github.com/octo-org/x/actions/runs/9',
        },
      ]),
    );

    expect(summary).toBeDefined();
    expect(summary!.sha).toBe('abc1234def5678');
    expect(summary!.total).toBe(3);
    expect(summary!.passed).toBe(1);
    expect(summary!.failed).toBe(1);
    expect(summary!.pending).toBe(1);

    const build = summary!.checks.find((c) => c.name === 'ci/build');
    expect(build).toMatchObject({ id: '1', kind: 'check', outcome: 'failure', isRequired: true });

    const status = summary!.checks.find((c) => c.name === 'ai-review');
    expect(status).toMatchObject({
      kind: 'status',
      isRequired: true,
      outcome: 'pending',
      description: 'Scanning…',
      detailsUrl: 'https://github.com/octo-org/x/actions/runs/9',
    });
  });

  it('surfaces what needs attention first', () => {
    const summary = parseChecks(
      payload([
        checkRun({ databaseId: 1, name: 'Zebra', conclusion: 'SUCCESS' }),
        checkRun({ databaseId: 2, name: 'Apple', conclusion: 'SUCCESS' }),
        checkRun({ databaseId: 3, name: 'Pipeline', status: 'IN_PROGRESS', conclusion: null }),
        checkRun({ databaseId: 4, name: 'Lint', conclusion: 'FAILURE' }),
      ]),
    );
    expect(summary!.checks.map((c) => c.name)).toEqual(['Lint', 'Pipeline', 'Apple', 'Zebra']);
  });

  it.each(['CheckRun', 'StatusContext'])('preserves true, false and unknown requirements for %s', (__typename) => {
    const summary = parseChecks(payload(
      [true, false, undefined, null, 'true', 1].map((isRequired, i) => ({
        __typename,
        databaseId: i,
        name: `Check ${i}`,
        context: `Check ${i}`,
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        state: 'FAILURE',
        isRequired,
      })),
    ));
    expect(summary!.checks.map((check) => check.isRequired)).toEqual([
      true, false, undefined, undefined, undefined, undefined,
    ]);
    expect(summary!.failed).toBe(6);
    expect(tallyRequired(summary!.checks).failed).toBe(1);
  });

  it('puts required checks ahead of optional failures without guessing from names', () => {
    const summary = parseChecks(payload([
      checkRun({ name: 'ci/build', isRequired: false, conclusion: 'FAILURE' }),
      checkRun({ name: 'Required build', isRequired: false, conclusion: 'FAILURE' }),
      checkRun({ name: 'Required passing check' }),
    ]));
    expect(summary!.checks.map((check) => check.name)).toEqual([
      'Required passing check', 'ci/build', 'Required build',
    ]);
    expect(tallyRequired(summary!.checks)).toEqual({ passed: 1, failed: 0, pending: 0, total: 1 });
  });

  it('reports a PR with no checks as an empty summary, not a failure', () => {
    const summary = parseChecks({
      repository: {
        pullRequest: { commits: { nodes: [{ commit: { oid: 'deadbeef', statusCheckRollup: null } }] } },
      },
    });
    expect(summary).toEqual({ checks: [], sha: 'deadbeef', passed: 0, failed: 0, pending: 0, total: 0 });
  });

  it('gives up only when there is no head commit', () => {
    expect(parseChecks(undefined)).toBeUndefined();
    expect(parseChecks({})).toBeUndefined();
    expect(parseChecks({ repository: { pullRequest: { commits: { nodes: [] } } } })).toBeUndefined();
  });

  it('skips rows of an unrecognised type rather than dropping the whole response', () => {
    const summary = parseChecks(payload([{ __typename: 'Something' }, checkRun()]));
    expect(summary!.total).toBe(1);
    expect(summary!.checks[0].name).toBe('Build');
  });

  it('falls back to the name when a check run has no database id', () => {
    const summary = parseChecks(payload([checkRun({ databaseId: null, name: 'Odd' })]));
    expect(summary!.checks[0].id).toBe('Odd');
  });
});
