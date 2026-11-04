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

const { publishDraft } = await import('../index');

const COORDS = { owner: 'octo-org', name: 'octo-repo', number: 123 };

/** The connector hands back the raw GraphQL envelope, so the payload nests twice. */
function envelope(data: unknown, errors?: unknown[]) {
  return { success: true, data: errors ? { data, errors } : { data } };
}

function published(isDraft = false) {
  return envelope({ markPullRequestReadyForReview: { pullRequest: { id: 'PR_abc', isDraft } } });
}

function lookup(id: string | null, isDraft = true) {
  return envelope({ repository: { pullRequest: id === null ? null : { id, isDraft } } });
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

describe('publishDraft', () => {
  it('publishes in one round trip when the summary already carries the node id', async () => {
    graphql.mockResolvedValue(published());

    await publishDraft(COORDS, 'PR_abc');

    expect(graphql).toHaveBeenCalledTimes(1);
    expect(sentQuery()).toContain('markPullRequestReadyForReview');
    expect(sentQuery()).toContain('"PR_abc"');
  });

  it('looks the node id up first when the summary predates that field', async () => {
    graphql.mockResolvedValueOnce(lookup('PR_looked_up')).mockResolvedValueOnce(
      published(),
    );

    await publishDraft(COORDS);

    expect(graphql).toHaveBeenCalledTimes(2);
    expect(sentQuery(0)).toContain('pullRequest(number: 123)');
    expect(sentQuery(1)).toContain('"PR_looked_up"');
  });

  it('does nothing when the lookup shows someone already published it', async () => {
    // Resolving rather than throwing: the end state the caller wanted is the
    // end state that exists, and an error here would be a lie about it.
    graphql.mockResolvedValueOnce(lookup('PR_abc', false));

    await expect(publishDraft(COORDS)).resolves.toBeUndefined();

    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it('gives up when the pull request cannot be found at all', async () => {
    graphql.mockResolvedValueOnce(lookup(null));
    await expect(publishDraft(COORDS)).rejects.toThrow('Could not find this pull request');
  });

  it('surfaces a GraphQL refusal, which arrives as a 200 with an errors array', async () => {
    graphql.mockResolvedValue(
      envelope(undefined, [{ message: 'Resource not accessible by integration' }]),
    );

    await expect(publishDraft(COORDS, 'PR_abc')).rejects.toThrow(
      /Resource not accessible by integration/,
    );
  });

  it('surfaces a refusal in the shape GitHub really sends: a null field plus errors', async () => {
    graphql.mockResolvedValue(
      envelope({ markPullRequestReadyForReview: null }, [
        { type: 'FORBIDDEN', message: 'Resource not accessible by integration' },
      ]),
    );

    await expect(publishDraft(COORDS, 'PR_abc')).rejects.toThrow(
      /Resource not accessible by integration/,
    );
  });

  it('surfaces a transport failure with the connector message attached', async () => {
    graphql.mockResolvedValue({ success: false, error: new Error('502 Bad Gateway') });

    await expect(publishDraft(COORDS, 'PR_abc')).rejects.toThrow(/502 Bad Gateway/);
    expect(warn).toHaveBeenCalled();
  });

  it('still fails cleanly when the connector reports no error object', async () => {
    // `IOperationResult.error` is not always an `Error`, so `.message` is not
    // safe to reach for — this must not throw a TypeError of its own.
    graphql.mockResolvedValue({ success: false });

    await expect(publishDraft(COORDS, 'PR_abc')).rejects.toThrow(
      'Could not publish this pull request.',
    );
  });

  it('refuses to claim success when GitHub says it is still a draft', async () => {
    graphql.mockResolvedValue(published(true));

    await expect(publishDraft(COORDS, 'PR_abc')).rejects.toThrow(/still reports/);
  });

  it('accepts a mutation payload that omits the draft state', async () => {
    // Only an explicit `true` means failure; a thinner payload is not an error.
    graphql.mockResolvedValue(
      envelope({ markPullRequestReadyForReview: { pullRequest: { id: 'PR_abc' } } }),
    );

    await expect(publishDraft(COORDS, 'PR_abc')).resolves.toBeUndefined();
  });
});
