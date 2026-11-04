import { describe, it, expect, vi, beforeEach } from 'vitest';

const graphql = vi.fn();

vi.mock('../../../../connectors/github', () => ({
  githubClient: {
    graphql: (...args: unknown[]) => graphql(...args),
  },
}));

const { buildUpdateCommentMutation, parseUpdatedCommentBody, updateCommentBody } = await import(
  '../commentEditor'
);

/** The connector hands back the raw GraphQL envelope, so the payload nests twice. */
function envelope(data: unknown, errors?: unknown[]) {
  return { success: true, data: errors ? { data, errors } : { data } };
}

function reviewReply(body: string) {
  return envelope({
    updatePullRequestReviewComment: { pullRequestReviewComment: { id: 'PRRC_1', body } },
  });
}

/** The GraphQL document sent on the nth call. */
function sentQuery(call = 0): string {
  return graphql.mock.calls[call][0] as string;
}

beforeEach(() => {
  graphql.mockReset();
});

describe('buildUpdateCommentMutation', () => {
  it('addresses a review comment by its own input field', () => {
    const q = buildUpdateCommentMutation('review', 'PRRC_abc', 'hello');
    expect(q).toContain('updatePullRequestReviewComment');
    expect(q).toContain('pullRequestReviewCommentId: "PRRC_abc"');
    expect(q).toContain('body: "hello"');
  });

  it('addresses an issue comment by plain id', () => {
    // GitHub models the two kinds separately and their inputs disagree about
    // what the id is called, which is the whole reason there are two mutations.
    const q = buildUpdateCommentMutation('issue', 'IC_abc', 'hello');
    expect(q).toContain('updateIssueComment');
    expect(q).toContain('id: "IC_abc"');
    expect(q).not.toContain('pullRequestReviewCommentId');
  });

  it('escapes a body containing quotes, backslashes and newlines', () => {
    // A body is typed by a person, so these arrive as a matter of course. On a
    // mutation an unescaped one doesn't just fail — it writes something else.
    const q = buildUpdateCommentMutation('review', 'PRRC_abc', 'say "hi"\nC:\\temp');
    expect(q).toContain('body: "say \\"hi\\"\\nC:\\\\temp"');
  });

  it('escapes an id, so a hostile one cannot close the input early', () => {
    const q = buildUpdateCommentMutation('issue', 'IC_"}) evil {', 'x');
    expect(q).toContain('id: "IC_\\"}) evil {"');
  });
});

describe('parseUpdatedCommentBody', () => {
  it('reads the body back out of each payload shape', () => {
    expect(
      parseUpdatedCommentBody('review', {
        updatePullRequestReviewComment: { pullRequestReviewComment: { body: 'saved' } },
      }),
    ).toBe('saved');
    expect(
      parseUpdatedCommentBody('issue', { updateIssueComment: { issueComment: { body: 'saved' } } }),
    ).toBe('saved');
  });

  it('returns undefined for a missing or mismatched payload', () => {
    expect(parseUpdatedCommentBody('review', undefined)).toBeUndefined();
    expect(parseUpdatedCommentBody('review', {})).toBeUndefined();
    expect(parseUpdatedCommentBody('review', { updatePullRequestReviewComment: null })).toBeUndefined();
    // The wrong reader against the right payload finds nothing, which is what
    // keeps a mixed-up kind from silently reporting success.
    expect(
      parseUpdatedCommentBody('issue', {
        updatePullRequestReviewComment: { pullRequestReviewComment: { body: 'saved' } },
      }),
    ).toBeUndefined();
  });

  it('returns undefined when the body is not a string', () => {
    expect(
      parseUpdatedCommentBody('issue', { updateIssueComment: { issueComment: { body: 42 } } }),
    ).toBeUndefined();
  });
});

describe('updateCommentBody', () => {
  it('sends the mutation and resolves with what GitHub stored', async () => {
    graphql.mockResolvedValue(reviewReply('saved by github'));

    await expect(updateCommentBody('review', 'PRRC_1', 'my text')).resolves.toBe('saved by github');
    expect(sentQuery()).toContain('updatePullRequestReviewComment');
  });

  it('throws with GitHub’s reason when the mutation is refused', async () => {
    // A permission refusal arrives as 200 OK with an errors array, so the
    // envelope is the only place the failure can be noticed.
    graphql.mockResolvedValue(
      envelope({ updatePullRequestReviewComment: null }, [
        { message: 'Resource not accessible by integration' },
      ]),
    );

    await expect(updateCommentBody('review', 'PRRC_1', 'my text')).rejects.toThrow(
      /Resource not accessible by integration/,
    );
  });

  it('throws when the connector call itself fails', async () => {
    graphql.mockResolvedValue({ success: false, error: new Error('offline') });

    await expect(updateCommentBody('issue', 'IC_1', 'x')).rejects.toThrow(/offline/);
  });

  it('throws when the payload comes back empty and unexplained', async () => {
    graphql.mockResolvedValue(envelope({ updateIssueComment: null }));

    await expect(updateCommentBody('issue', 'IC_1', 'x')).rejects.toThrow(
      'Could not save this comment.',
    );
  });
});
