import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../connectors/github', () => ({
  githubClient: { graphql: vi.fn() },
}));
vi.mock('@microsoft/managed-apps/auth', () => ({ getUser: vi.fn() }));

import { githubClient } from '../../connectors/github';
import { GitHubService } from '../githubService';

const repo = { owner: 'o', name: 'r' };
const graphql = vi.mocked(githubClient.graphql);

function blob(object: unknown) {
  return { success: true, data: { data: { repository: { object } } } };
}

beforeEach(() => vi.resetAllMocks());

describe('GitHubService.getFileContent', () => {
  it.each(['SELECT amount\n', ''])('returns the blob text including empty files: %j', async (text) => {
    graphql.mockResolvedValue(blob({ text, isBinary: false, isTruncated: false, byteSize: text.length }));
    expect(await GitHubService.getFileContent(repo, 'a.sql', 'sha')).toBe(text);
    expect(graphql.mock.calls[0][0]).toContain('expression: "sha:a.sql"');
  });

  it('treats a binary blob as unavailable', async () => {
    graphql.mockResolvedValue(blob({ text: null, isBinary: true, byteSize: 10 }));
    expect(await GitHubService.getFileContent(repo, 'logo.png', 'sha')).toBeUndefined();
    expect(await GitHubService.getFileBlob(repo, 'logo.png', 'sha')).toEqual({ kind: 'binary' });
  });

  it('treats a truncated blob as unavailable rather than returning partial text', async () => {
    graphql.mockResolvedValue(blob({ text: 'partial', isBinary: false, isTruncated: true, byteSize: 1e8 }));
    expect(await GitHubService.getFileBlob(repo, 'big.txt', 'sha')).toEqual({ kind: 'unavailable' });
  });

  it('reports a missing file', async () => {
    graphql.mockResolvedValue(blob(null));
    expect(await GitHubService.getFileBlob(repo, 'gone.txt', 'sha')).toEqual({ kind: 'missing' });
  });

  it('returns unavailable, not an error message or an empty file, when GraphQL fails', async () => {
    graphql.mockRejectedValue(new Error('access denied'));
    expect(await GitHubService.getFileContent(repo, 'a.sql', 'sha')).toBeUndefined();
  });

  it('returns unavailable when GraphQL answers with errors', async () => {
    graphql.mockResolvedValue({ success: true, data: { errors: [{ message: 'Could not resolve' }] } });
    expect(await GitHubService.getFileBlob(repo, 'a.sql', 'sha')).toEqual({ kind: 'unavailable' });
  });
});
