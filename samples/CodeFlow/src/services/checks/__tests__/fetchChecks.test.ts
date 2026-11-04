import { describe, it, expect, vi, beforeEach } from 'vitest';

const graphql = vi.fn();

vi.mock('../../../connectors/github', () => ({
  githubClient: {
    graphql: (...args: unknown[]) => graphql(...args),
  },
}));

const warn = vi.fn();
vi.mock('../../../lib/logger', () => ({ createLogger: () => ({ warn }) }));

const { fetchChecks } = await import('../index');

const COORDS = { owner: 'octo-org', name: 'Repo', number: 7 };

/** The connector returns the raw GraphQL envelope, so the payload nests twice. */
function envelope(repository: unknown) {
  return { success: true, data: { data: { repository } } };
}

const ONE_CHECK = {
  pullRequest: {
    commits: {
      nodes: [
        {
          commit: {
            oid: 'sha1',
            statusCheckRollup: {
              contexts: {
                totalCount: 1,
                nodes: [
                  {
                    __typename: 'CheckRun',
                    databaseId: 5,
                    name: 'Build',
                    status: 'COMPLETED',
                    conclusion: 'SUCCESS',
                    isRequired: true,
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
};

beforeEach(() => {
  graphql.mockReset();
  warn.mockReset();
});

describe('fetchChecks', () => {
  it('unwraps the doubly-nested connector response', async () => {
    graphql.mockResolvedValue(envelope(ONE_CHECK));
    const summary = await fetchChecks(COORDS);
    expect(summary).toMatchObject({ sha: 'sha1', total: 1, passed: 1 });
    expect(summary!.checks[0].isRequired).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('asks for the requested pull request', async () => {
    graphql.mockResolvedValue(envelope(ONE_CHECK));
    await fetchChecks(COORDS);
    const [query] = graphql.mock.calls[0] as [string];
    expect(query).toContain('pullRequest(number: 7)');
    expect(query.match(/isRequired\(pullRequestNumber: 7\)/g)).toHaveLength(2);
  });

  it('hides the pill rather than breaking the page when the query fails', async () => {
    graphql.mockResolvedValue({ success: false, error: 'nope' });
    expect(await fetchChecks(COORDS)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('swallows a thrown connector error', async () => {
    graphql.mockRejectedValue(new Error('offline'));
    expect(await fetchChecks(COORDS)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('tolerates an empty response body', async () => {
    graphql.mockResolvedValue({ success: true, data: undefined });
    expect(await fetchChecks(COORDS)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('rejects partial GraphQL errors rather than implying omitted checks passed', async () => {
    graphql.mockResolvedValue({
      success: true,
      data: { data: { repository: ONE_CHECK }, errors: [{ message: 'Cannot resolve isRequired' }] },
    });
    expect(await fetchChecks(COORDS)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('query returned GraphQL errors');
  });

  it('logs missing requirement metadata and keeps it unknown, not optional', async () => {
    const repository = structuredClone(ONE_CHECK);
    Reflect.deleteProperty(repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0], 'isRequired');
    graphql.mockResolvedValue(envelope(repository));
    const summary = await fetchChecks(COORDS);
    expect(summary!.checks[0].isRequired).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('query returned incomplete check requirements');
  });
});
