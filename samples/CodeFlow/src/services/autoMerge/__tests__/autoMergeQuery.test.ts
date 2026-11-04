import { describe, it, expect } from 'vitest';
import {
  buildAutoMergeQuery,
  buildDisableAutoMergeMutation,
  buildEnableAutoMergeMutation,
  fromGraphQlMethod,
  parseAutoMergeMutation,
  parseAutoMergeNodeId,
  parseAutoMergeStatus,
} from '../autoMergeQuery';

const COORDS = { owner: 'octo-org', name: 'octo-repo', number: 123 };

describe('buildAutoMergeQuery', () => {
  it('asks for the pull request by number, in the right repository', () => {
    const q = buildAutoMergeQuery(COORDS);
    expect(q).toContain('owner: "octo-org"');
    expect(q).toContain('name: "octo-repo"');
    expect(q).toContain('pullRequest(number: 123)');
  });

  it('reads the node id too, so a mutation can follow without a second lookup', () => {
    expect(buildAutoMergeQuery(COORDS)).toContain('id viewerCanEnableAutoMerge');
  });

  it('asks GitHub whether the viewer could enable it, rather than guessing', () => {
    expect(buildAutoMergeQuery(COORDS)).toContain('viewerCanEnableAutoMerge');
  });

  it('quotes a repository name containing a quote instead of breaking out of the query', () => {
    const q = buildAutoMergeQuery({ ...COORDS, name: 'we"ird' });
    expect(q).toContain('name: "we\\"ird"');
  });
});

describe('buildEnableAutoMergeMutation', () => {
  it('sends the merge method as a bare GraphQL enum, not a string', () => {
    const m = buildEnableAutoMergeMutation('PR_abc', 'squash');
    expect(m).toContain('mergeMethod: SQUASH');
    expect(m).not.toContain('"SQUASH"');
  });

  it('maps every strategy the app offers', () => {
    expect(buildEnableAutoMergeMutation('PR_abc', 'merge')).toContain('mergeMethod: MERGE');
    expect(buildEnableAutoMergeMutation('PR_abc', 'rebase')).toContain('mergeMethod: REBASE');
  });

  it('quotes the node id, so a stray quote cannot rewrite a mutation', () => {
    expect(buildEnableAutoMergeMutation('PR_"abc', 'merge')).toContain('"PR_\\"abc"');
  });

  it('does not pin the head oid — auto-merge lands commits that do not exist yet', () => {
    expect(buildEnableAutoMergeMutation('PR_abc', 'merge')).not.toContain('expectedHeadOid');
  });

  it('reads the resulting state back, so the button need not re-poll to update', () => {
    expect(buildEnableAutoMergeMutation('PR_abc', 'merge')).toContain('autoMergeRequest');
  });
});

describe('buildDisableAutoMergeMutation', () => {
  it('addresses the pull request by node id', () => {
    const m = buildDisableAutoMergeMutation('PR_abc');
    expect(m).toContain('disablePullRequestAutoMerge');
    expect(m).toContain('pullRequestId: "PR_abc"');
  });
});

describe('fromGraphQlMethod', () => {
  it('reads GitHub’s enum members back into the app’s own spelling', () => {
    expect(fromGraphQlMethod('SQUASH')).toBe('squash');
    expect(fromGraphQlMethod('MERGE')).toBe('merge');
    expect(fromGraphQlMethod('REBASE')).toBe('rebase');
  });

  it('declines to guess at anything it does not recognise', () => {
    expect(fromGraphQlMethod('FAST_FORWARD')).toBeUndefined();
    expect(fromGraphQlMethod(undefined)).toBeUndefined();
    expect(fromGraphQlMethod(7)).toBeUndefined();
  });
});

function statusPayload(pr: unknown) {
  return { repository: { pullRequest: pr } };
}

describe('parseAutoMergeStatus', () => {
  it('reports auto-merge as off when GitHub returns no request', () => {
    const status = parseAutoMergeStatus(
      statusPayload({ id: 'PR_abc', viewerCanEnableAutoMerge: true, autoMergeRequest: null }),
    );
    expect(status).toEqual({
      enabled: false,
      method: undefined,
      enabledBy: undefined,
      viewerCanEnable: true,
    });
  });

  it('reads the strategy and who armed it', () => {
    const status = parseAutoMergeStatus(
      statusPayload({
        id: 'PR_abc',
        viewerCanEnableAutoMerge: false,
        autoMergeRequest: { mergeMethod: 'SQUASH', enabledBy: { login: 'alice' } },
      }),
    );
    expect(status).toMatchObject({ enabled: true, method: 'squash', enabledBy: 'alice' });
  });

  it('still reports it as on when the strategy is one it cannot name', () => {
    const status = parseAutoMergeStatus(
      statusPayload({ autoMergeRequest: { mergeMethod: 'WHAT', enabledBy: null } }),
    );
    expect(status).toMatchObject({ enabled: true, method: undefined, enabledBy: undefined });
  });

  it('leaves the viewer’s permission undefined when GitHub did not say', () => {
    const status = parseAutoMergeStatus(statusPayload({ autoMergeRequest: null }));
    expect(status?.viewerCanEnable).toBeUndefined();
  });

  it('distinguishes an unreadable pull request from one with auto-merge off', () => {
    expect(parseAutoMergeStatus(statusPayload(null))).toBeUndefined();
    expect(parseAutoMergeStatus({})).toBeUndefined();
    expect(parseAutoMergeStatus(undefined)).toBeUndefined();
  });
});

describe('parseAutoMergeNodeId', () => {
  it('recovers the node id from a status lookup', () => {
    expect(parseAutoMergeNodeId(statusPayload({ id: 'PR_abc' }))).toBe('PR_abc');
  });

  it('answers nothing when the pull request could not be read', () => {
    expect(parseAutoMergeNodeId(statusPayload(null))).toBeUndefined();
    expect(parseAutoMergeNodeId(statusPayload({ id: '' }))).toBeUndefined();
  });
});

describe('parseAutoMergeMutation', () => {
  it('reads the enable mutation’s payload', () => {
    const status = parseAutoMergeMutation(
      {
        enablePullRequestAutoMerge: {
          pullRequest: {
            id: 'PR_abc',
            autoMergeRequest: { mergeMethod: 'REBASE', enabledBy: { login: 'bob' } },
          },
        },
      },
      'enablePullRequestAutoMerge',
    );
    expect(status).toMatchObject({ enabled: true, method: 'rebase', enabledBy: 'bob' });
  });

  it('reads the disable mutation’s payload', () => {
    const status = parseAutoMergeMutation(
      { disablePullRequestAutoMerge: { pullRequest: { id: 'PR_abc', autoMergeRequest: null } } },
      'disablePullRequestAutoMerge',
    );
    expect(status).toMatchObject({ enabled: false });
  });

  it('does not read one mutation’s payload out of the other’s field', () => {
    const payload = {
      enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: { mergeMethod: 'MERGE' } } },
    };
    expect(parseAutoMergeMutation(payload, 'disablePullRequestAutoMerge')).toBeUndefined();
  });

  it('answers nothing when the mutation returned no pull request', () => {
    expect(
      parseAutoMergeMutation({ enablePullRequestAutoMerge: null }, 'enablePullRequestAutoMerge'),
    ).toBeUndefined();
  });
});
