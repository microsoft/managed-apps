import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteGithubComment } from '../commentDeleter';

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../../../../connectors/github', () => ({
  githubClient: { graphql: search },
}));

beforeEach(() => { search.mockReset(); });

describe('deleteGithubComment', () => {
  it.each([
    ['review', 'deletePullRequestReviewComment', 'PRRC_1'],
    ['issue', 'deleteIssueComment', 'IC_1'],
  ] as const)('deletes exactly one %s comment and requires its acknowledgement', async (kind, mutation, id) => {
    search.mockResolvedValue({
      success: true, data: { data: { [mutation]: { clientMutationId: id } } },
    });
    await expect(deleteGithubComment(kind, id)).resolves.toBeUndefined();
    expect(search).toHaveBeenCalledExactlyOnceWith(
      `mutation { ${mutation}(input: { id: "${id}", clientMutationId: "${id}" }) { clientMutationId } }`,
    );
  });

  it('escapes the ID in both input fields', async () => {
    const id = 'IC_"\\\n';
    search.mockResolvedValue({
      success: true, data: { data: { deleteIssueComment: { clientMutationId: id } } },
    });
    await deleteGithubComment('issue', id);
    const query: string = search.mock.calls[0][0];
    expect(query).toContain(`id: ${JSON.stringify(id)}, clientMutationId: ${JSON.stringify(id)}`);
  });

  it('surfaces GraphQL permission failures, including partial payloads', async () => {
    search.mockResolvedValue({
      success: true,
      data: {
        data: { deleteIssueComment: null },
        errors: [{ message: 'Resource not accessible by integration' }],
      },
    });
    await expect(deleteGithubComment('issue', 'IC_1')).rejects.toThrow(
      'Could not delete this comment: Resource not accessible by integration',
    );
  });

  it.each([
    undefined,
    { success: false, error: new Error('offline') },
    { success: true },
    { success: true, data: { data: { deleteIssueComment: null } } },
    { success: true, data: { data: { deleteIssueComment: {} } } },
    { success: true, data: { data: { deleteIssueComment: { clientMutationId: 'wrong' } } } },
    { success: true, data: { data: { deletePullRequestReviewComment: { clientMutationId: 'IC_1' } } } },
  ])('rejects failed or unconfirmed responses %#', async (response) => {
    search.mockResolvedValue(response);
    await expect(deleteGithubComment('issue', 'IC_1')).rejects.toThrow('Could not delete this comment');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('propagates transport rejection without retrying a destructive request', async () => {
    search.mockRejectedValue(new Error('connection lost'));
    await expect(deleteGithubComment('review', 'PRRC_1')).rejects.toThrow('connection lost');
    expect(search).toHaveBeenCalledTimes(1);
  });
});
