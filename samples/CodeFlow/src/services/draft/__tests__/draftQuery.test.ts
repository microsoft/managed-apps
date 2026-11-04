import { describe, it, expect } from 'vitest';
import {
  buildNodeIdQuery,
  buildPublishMutation,
  graphQlErrorMessage,
  parseNodeIdLookup,
  parsePublishResult,
} from '../draftQuery';

const COORDS = { owner: 'octo-org', name: 'octo-repo', number: 123 };

describe('buildPublishMutation', () => {
  it('names the mutation GitHub actually exposes for this', () => {
    // REST cannot clear the draft flag at all, so if this name ever drifts the
    // feature is simply gone — worth pinning.
    expect(buildPublishMutation('PR_abc')).toContain('markPullRequestReadyForReview');
  });

  it('passes the node id as the input, and asks back for the new draft state', () => {
    const mutation = buildPublishMutation('PR_abc');
    expect(mutation).toContain('pullRequestId: "PR_abc"');
    expect(mutation).toContain('isDraft');
  });

  it('quotes a node id containing a quote instead of letting it end the string', () => {
    // A rewritten query returns nothing; a rewritten *mutation* writes.
    const mutation = buildPublishMutation('PR_a"b');
    expect(mutation).toContain('"PR_a\\"b"');
  });
});

describe('buildNodeIdQuery', () => {
  it('addresses the pull request by owner, name and number', () => {
    const query = buildNodeIdQuery(COORDS);
    expect(query).toContain('owner: "octo-org"');
    expect(query).toContain('name: "octo-repo"');
    expect(query).toContain('pullRequest(number: 123)');
  });

  it('selects the draft state as well as the id', () => {
    // Both, because a lookup that reports `isDraft: false` means the publish is
    // already done and the mutation should be skipped.
    expect(buildNodeIdQuery(COORDS)).toContain('id isDraft');
  });

  it('escapes a repository name with a quote in it', () => {
    expect(buildNodeIdQuery({ ...COORDS, name: 'we"ird' })).toContain('"we\\"ird"');
  });
});

describe('graphQlErrorMessage', () => {
  it('returns the first message, because GraphQL answers 200 with errors', () => {
    const envelope = { errors: [{ message: 'Resource not accessible' }, { message: 'second' }] };
    expect(graphQlErrorMessage(envelope)).toBe('Resource not accessible');
  });

  it('skips an entry with no usable message and keeps looking', () => {
    const envelope = { errors: [{ message: '' }, { code: 'X' }, { message: 'the real one' }] };
    expect(graphQlErrorMessage(envelope)).toBe('the real one');
  });

  it('still reports a failure when every entry is unreadable', () => {
    expect(graphQlErrorMessage({ errors: [{ code: 'X' }] })).toBe('GitHub rejected the request.');
  });

  it('is silent when there is nothing wrong', () => {
    expect(graphQlErrorMessage({ data: {} })).toBeUndefined();
    expect(graphQlErrorMessage({ errors: [] })).toBeUndefined();
    expect(graphQlErrorMessage(undefined)).toBeUndefined();
    expect(graphQlErrorMessage('nonsense')).toBeUndefined();
  });
});

describe('parseNodeIdLookup', () => {
  it('reads the id and draft state', () => {
    const payload = { repository: { pullRequest: { id: 'PR_abc', isDraft: true } } };
    expect(parseNodeIdLookup(payload)).toEqual({ nodeId: 'PR_abc', isDraft: true });
  });

  it('returns nothing for a pull request GitHub could not find', () => {
    expect(parseNodeIdLookup({ repository: { pullRequest: null } })).toEqual({});
    expect(parseNodeIdLookup({ repository: null })).toEqual({});
    expect(parseNodeIdLookup(undefined)).toEqual({});
  });

  it('treats an empty id as no id rather than a valid one', () => {
    const payload = { repository: { pullRequest: { id: '', isDraft: false } } };
    expect(parseNodeIdLookup(payload)).toEqual({ nodeId: undefined, isDraft: false });
  });

  it('leaves isDraft undefined when it is not a boolean', () => {
    const payload = { repository: { pullRequest: { id: 'PR_abc', isDraft: 'yes' } } };
    expect(parseNodeIdLookup(payload).isDraft).toBeUndefined();
  });
});

describe('parsePublishResult', () => {
  it('reports the draft state the mutation left behind', () => {
    const payload = { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } };
    expect(parsePublishResult(payload)).toEqual({ isDraft: false });
  });

  it('distinguishes "no payload" from "payload without a draft state"', () => {
    // The caller only rejects on an explicit `true`, so these must not collapse.
    expect(parsePublishResult({ markPullRequestReadyForReview: null })).toBeUndefined();
    expect(
      parsePublishResult({ markPullRequestReadyForReview: { pullRequest: {} } }),
    ).toEqual({ isDraft: undefined });
  });
});
