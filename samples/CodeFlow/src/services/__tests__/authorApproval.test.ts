import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrSummary } from '../../types';
import { GitHubService } from '../githubService';
import { fetchAuthorApproval, recordAuthorApproval } from '../authorApproval';
import { appStorage, type Approval } from '../../storage';

vi.mock('../githubService', () => ({
  GitHubService: { getAuthenticatedUser: vi.fn() },
}));

const pr: PrSummary = {
  coordinates: { owner: 'o', name: 'r', number: 1 },
  title: 'PR', author: { login: 'Alice' }, state: 'open', draft: false, merged: false,
  baseRef: 'main', baseSha: 'base', headRef: 'feature', headSha: 'head',
};

function approval(commitId = 'head', submittedAt = '2026-10-02T12:00:00.000Z', extra: Partial<Approval> = {}): Approval {
  return { owner: 'o', repo: 'r', number: 1, prKey: 'o/r#1', authorLogin: 'alice', commitId, submittedAt, ...extra };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(GitHubService.getAuthenticatedUser).mockResolvedValue({ login: 'alice' });
});

describe('recordAuthorApproval', () => {
  it('stores an approval bound to the loaded head and connector identity', async () => {
    const saved = await recordAuthorApproval(pr, 'Ready');
    const records = await appStorage().approvals.listAll();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ prKey: 'o/r#1', authorLogin: 'alice', commitId: 'head', body: 'Ready' });
    expect(Number.isFinite(Date.parse(records[0].submittedAt))).toBe(true);
    expect(saved).toMatchObject({
      source: 'codeflow', state: 'APPROVED', user: { login: 'alice' },
      commitId: 'head', approvedCommitIds: ['head'],
    });
  });

  it.each([undefined, { login: 'someone-else' }])('refuses unresolved or non-author connector identity: %j', async (actor) => {
    vi.mocked(GitHubService.getAuthenticatedUser).mockResolvedValue(actor);
    await expect(recordAuthorApproval(pr)).rejects.toThrow('authenticated GitHub author');
    expect(await appStorage().approvals.listAll()).toHaveLength(0);
  });

  it.each([{ state: 'closed' as const }, { merged: true }, { headSha: '' }])('rejects a finished or unknown revision: %j', async (extra) => {
    await expect(recordAuthorApproval({ ...pr, ...extra })).rejects.toThrow('open pull request');
  });

  it('rejects oversized bodies before writing', async () => {
    await expect(recordAuthorApproval(pr, 'x'.repeat(10_001))).rejects.toThrow('10,000');
    expect(await appStorage().approvals.listAll()).toHaveLength(0);
  });

  it('surfaces a storage failure rather than reporting success', async () => {
    vi.spyOn(appStorage().approvals, 'create').mockRejectedValue(new Error('Storage is unavailable.'));
    await expect(recordAuthorApproval(pr)).rejects.toThrow('unavailable');
  });

  it('appends approvals so earlier commits stay approved', async () => {
    await recordAuthorApproval({ ...pr, headSha: 'first' });
    await recordAuthorApproval({ ...pr, headSha: 'second' });
    expect((await fetchAuthorApproval(pr))?.approvedCommitIds.sort()).toEqual(['first', 'second']);
  });
});

describe('fetchAuthorApproval', () => {
  it('reads approvals for another viewer without checking that viewer is the author', async () => {
    vi.mocked(GitHubService.getAuthenticatedUser).mockResolvedValue({ login: 'bob' });
    await appStorage().approvals.create(approval());
    expect(await fetchAuthorApproval(pr)).toMatchObject({ user: { login: 'alice' }, source: 'codeflow' });
    expect(GitHubService.getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it('retains exact SHAs and picks the latest approval regardless of order', async () => {
    await appStorage().approvals.create(approval('second', '2026-10-02T13:00:00.000Z'));
    await appStorage().approvals.create(approval('first'));
    await appStorage().approvals.create(approval('first'));
    expect(await fetchAuthorApproval(pr)).toMatchObject({
      commitId: 'second', approvedCommitIds: ['second', 'first'],
    });
  });

  it('distinguishes no records from a failed read', async () => {
    expect(await fetchAuthorApproval(pr)).toBeNull();
    vi.spyOn(appStorage().approvals, 'listAll').mockRejectedValue(new Error('offline'));
    expect(await fetchAuthorApproval(pr)).toBeUndefined();
  });

  it.each([
    { authorLogin: 'bob' }, { prKey: 'o/other#1' }, { submittedAt: 'invalid' },
  ])('does not invent approval from mismatched data: %j', async (extra) => {
    await appStorage().approvals.create(approval('head', undefined, extra));
    expect(await fetchAuthorApproval(pr)).toBeNull();
  });
});
