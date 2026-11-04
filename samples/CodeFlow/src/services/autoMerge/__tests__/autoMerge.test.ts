import { describe, it, expect, vi, beforeEach } from 'vitest';

const graphql = vi.fn();

vi.mock('../../../connectors/github', () => ({
  githubClient: {
    graphql: (...args: unknown[]) => graphql(...args),
  },
}));

const warn = vi.fn();
const info = vi.fn();
vi.mock('../../../lib/logger', () => ({ createLogger: () => ({ warn, info }) }));

const { disableAutoMerge, enableAutoMerge, fetchAutoMerge } = await import('../index');

const COORDS = { owner: 'octo-org', name: 'octo-repo', number: 123 };

/** The connector hands back the raw GraphQL envelope, so the payload nests twice. */
function envelope(data: unknown, errors?: unknown[]) {
  return { success: true, data: errors ? { data, errors } : { data } };
}

function status(pr: unknown) {
  return envelope({ repository: { pullRequest: pr } });
}

function armed(method = 'SQUASH', login = 'alice') {
  return { mergeMethod: method, enabledBy: { login } };
}

/** The GraphQL document sent on the nth call. */
function sentQuery(call = 0): string {
  return graphql.mock.calls[call][0] as string;
}

beforeEach(() => {
  graphql.mockReset();
  warn.mockReset();
  info.mockReset();
});

describe('fetchAutoMerge', () => {
  it('reads an armed auto-merge', async () => {
    graphql.mockResolvedValue(
      status({ id: 'PR_abc', viewerCanEnableAutoMerge: false, autoMergeRequest: armed() }),
    );

    expect(await fetchAutoMerge(COORDS)).toMatchObject({
      enabled: true,
      method: 'squash',
      enabledBy: 'alice',
    });
  });

  it('reports "off but available" rather than treating it as a failure', async () => {
    graphql.mockResolvedValue(
      status({ id: 'PR_abc', viewerCanEnableAutoMerge: true, autoMergeRequest: null }),
    );

    expect(await fetchAutoMerge(COORDS)).toMatchObject({ enabled: false, viewerCanEnable: true });
  });

  it('answers "don’t know" instead of throwing, so a diff still renders', async () => {
    graphql.mockResolvedValue({ success: false, error: new Error('403') });

    expect(await fetchAutoMerge(COORDS)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('swallows a GraphQL error the same way', async () => {
    graphql.mockResolvedValue(
      envelope(undefined, [{ message: 'Field unavailable on this instance' }]),
    );

    expect(await fetchAutoMerge(COORDS)).toBeUndefined();
  });
});

describe('enableAutoMerge', () => {
  it('arms it in one round trip when the summary carries the node id', async () => {
    graphql.mockResolvedValue(
      envelope({
        enablePullRequestAutoMerge: { pullRequest: { id: 'PR_abc', autoMergeRequest: armed() } },
      }),
    );

    const result = await enableAutoMerge(COORDS, 'squash', 'PR_abc');

    expect(graphql).toHaveBeenCalledTimes(1);
    expect(sentQuery()).toContain('enablePullRequestAutoMerge');
    expect(sentQuery()).toContain('mergeMethod: SQUASH');
    expect(result).toMatchObject({ enabled: true, method: 'squash' });
  });

  it('looks the node id up first when the summary predates that field', async () => {
    graphql.mockResolvedValueOnce(status({ id: 'PR_looked_up' })).mockResolvedValueOnce(
      envelope({
        enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: armed('MERGE') } },
      }),
    );

    await enableAutoMerge(COORDS, 'merge');

    expect(graphql).toHaveBeenCalledTimes(2);
    expect(sentQuery(1)).toContain('"PR_looked_up"');
  });

  it('refuses when the pull request cannot be found at all', async () => {
    graphql.mockResolvedValue(status(null));

    await expect(enableAutoMerge(COORDS, 'merge')).rejects.toThrow(/could not find/i);
  });

  it('surfaces GitHub’s own refusal, which is the only thing that explains it', async () => {
    graphql.mockResolvedValue(
      envelope(undefined, [{ message: 'Pull request is in clean status' }]),
    );

    await expect(enableAutoMerge(COORDS, 'merge', 'PR_abc')).rejects.toThrow(
      /Pull request is in clean status/,
    );
  });

  it('does not claim success when GitHub answered with auto-merge still off', async () => {
    graphql.mockResolvedValue(
      envelope({ enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } } }),
    );

    await expect(enableAutoMerge(COORDS, 'merge', 'PR_abc')).rejects.toThrow(/did not turn/i);
  });

  it('surfaces a refusal in the shape GitHub really sends: a null field plus errors', async () => {
    graphql.mockResolvedValue(
      envelope({ enablePullRequestAutoMerge: null }, [
        { type: 'UNPROCESSABLE', message: 'Auto merge is not allowed for this repository' },
      ]),
    );

    await expect(enableAutoMerge(COORDS, 'squash', 'PR_abc')).rejects.toThrow(
      /Auto merge is not allowed for this repository/,
    );
  });

  it('reports the state it asked for when the mutation returned no payload', async () => {
    graphql.mockResolvedValue(envelope({ enablePullRequestAutoMerge: null }));

    expect(await enableAutoMerge(COORDS, 'rebase', 'PR_abc')).toEqual({
      enabled: true,
      method: 'rebase',
    });
  });
});

describe('disableAutoMerge', () => {
  it('disarms it, and says so', async () => {
    graphql.mockResolvedValue(
      envelope({
        disablePullRequestAutoMerge: { pullRequest: { id: 'PR_abc', autoMergeRequest: null } },
      }),
    );

    const result = await disableAutoMerge(COORDS, 'PR_abc');

    expect(sentQuery()).toContain('disablePullRequestAutoMerge');
    expect(result).toMatchObject({ enabled: false });
  });

  it('treats an empty payload as success, since the end state is what was asked for', async () => {
    graphql.mockResolvedValue(envelope({ disablePullRequestAutoMerge: null }));

    expect(await disableAutoMerge(COORDS, 'PR_abc')).toEqual({ enabled: false });
  });

  it('refuses to report success while GitHub still reports it armed', async () => {
    graphql.mockResolvedValue(
      envelope({ disablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: armed() } } }),
    );

    await expect(disableAutoMerge(COORDS, 'PR_abc')).rejects.toThrow(/still reports/i);
  });

  it('surfaces a transport failure rather than pretending it worked', async () => {
    graphql.mockResolvedValue({ success: false, error: new Error('502 Bad Gateway') });

    await expect(disableAutoMerge(COORDS, 'PR_abc')).rejects.toThrow(/502 Bad Gateway/);
  });
});
