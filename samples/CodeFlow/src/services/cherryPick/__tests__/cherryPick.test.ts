import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileChange, PrSummary } from '../../../types';

vi.mock('../../githubService', () => ({
  GitHubService: {
    listPullRequestFiles: vi.fn(),
    compare: vi.fn(),
    getFileContent: vi.fn(),
    getFileBlob: vi.fn(),
    getBranchHead: vi.fn(),
    createBranch: vi.fn(),
    createPullRequest: vi.fn(),
    commitFiles: vi.fn(),
    deleteBranch: vi.fn(),
  },
}));
vi.mock('../../../lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { GitHubService } from '../../githubService';
import { cherryPickPullRequest, previewCherryPick, CherryPickRefused } from '../cherryPick';

const svc = vi.mocked(GitHubService);

const BASE = 'basesha';
const HEAD = 'headsha1234567';
const TARGET = 'release/1.0';

function makePr(over: Partial<PrSummary> = {}): PrSummary {
  return {
    coordinates: { owner: 'octo', name: 'repo', number: 42 },
    title: 'Fix the crash',
    state: 'closed',
    draft: false,
    merged: true,
    author: { login: 'alice' },
    baseRef: 'main',
    baseSha: BASE,
    headRef: 'fix/crash',
    headSha: HEAD,
    htmlUrl: 'https://github.com/octo/repo/pull/42',
    ...over,
  };
}

function file(over: Partial<FileChange> & { filename: string }): FileChange {
  return { status: 'modified', additions: 1, deletions: 0, changes: 1, ...over };
}

function request(over: Record<string, unknown> = {}) {
  return {
    pr: makePr(),
    targetBranch: TARGET,
    newBranch: 'cherry-pick/pr-42-to-release/1.0',
    openPullRequest: false,
    ...over,
  } as Parameters<typeof cherryPickPullRequest>[0];
}

const BINARY = Symbol('binary');
const UNREADABLE = Symbol('unreadable');

/** Declare file contents per ref: `{ [ref]: { [path]: content } }`. */
function contents(map: Record<string, Record<string, string | typeof BINARY | typeof UNREADABLE | undefined>>) {
  svc.getFileContent.mockImplementation(async (_repo: unknown, path: string, ref: string) => {
    const value = map[ref]?.[path];
    return typeof value === 'string' ? value : undefined;
  });
  svc.getFileBlob.mockImplementation(async (_repo: unknown, path: string, ref: string) => {
    const value = map[ref]?.[path];
    if (value === BINARY) return { kind: 'binary' };
    if (value === UNREADABLE) return { kind: 'unavailable' };
    return typeof value === 'string' ? { kind: 'text', text: value } : { kind: 'missing' };
  });
}

/** The single commit's additions, as a path → content map. */
function pushed(): Record<string, string> {
  const input = svc.commitFiles.mock.calls[0]?.[1];
  if (!input) return {};
  return Object.fromEntries(input.additions.map((f) => [f.path, f.content]));
}

function deletedPaths(): string[] {
  return [...(svc.commitFiles.mock.calls[0]?.[1].deletions ?? [])];
}

/** A comparison result carrying `files` as the target's divergence. */
function comparison(files: FileChange[], status = 'ahead') {
  return { baseSha: 'a', headSha: 'b', status, files, commits: [] };
}

const lines = (...l: string[]) => l.join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  svc.listPullRequestFiles.mockResolvedValue([file({ filename: 'src/a.ts' })]);
  svc.compare.mockResolvedValue(comparison([]));
  contents({ [HEAD]: { 'src/a.ts': 'new content' } });
  svc.getBranchHead.mockResolvedValue('targetsha');
  svc.createBranch.mockResolvedValue(undefined);
  svc.createPullRequest.mockResolvedValue(undefined);
  svc.commitFiles.mockResolvedValue('commitsha');
  svc.deleteBranch.mockResolvedValue(undefined);
});

describe('previewCherryPick', () => {
  it('reports files the target has also changed', async () => {
    svc.compare.mockResolvedValue(comparison([file({ filename: 'src/a.ts' })]));

    const preview = await previewCherryPick(makePr(), TARGET);

    expect(preview.overlap).toEqual(['src/a.ts']);
    expect(preview.warning).toContain('merged');
    expect(preview.divergence.known).toBe(true);
  });

  it('says nothing when the target has not moved', async () => {
    const preview = await previewCherryPick(makePr(), TARGET);
    expect(preview.overlap).toEqual([]);
    expect(preview.warning).toBeUndefined();
  });

  it('treats a failed comparison as divergence unknown, not as no divergence', async () => {
    svc.compare.mockRejectedValue(new Error('unrelated histories'));
    const preview = await previewCherryPick(makePr(), TARGET);
    expect(preview.divergence.known).toBe(false);
  });

  it.each(['diverged', 'behind'])(
    'does not trust a %s comparison, which GitHub measures from the merge base',
    async (status) => {
      svc.compare.mockResolvedValue(comparison([], status));
      const preview = await previewCherryPick(makePr(), TARGET);
      expect(preview.divergence.known).toBe(false);
    },
  );

  it('compares against the target’s commit, since the connector 404s on a branch name with a slash', async () => {
    await previewCherryPick(makePr(), TARGET);
    expect(svc.compare).toHaveBeenCalledWith({ owner: 'octo', name: 'repo' }, BASE, 'targetsha');
  });

  it('treats a maxed-out comparison as possibly truncated', async () => {
    const many = Array.from({ length: 300 }, (_, i) => file({ filename: `f${i}.ts` }));
    svc.compare.mockResolvedValue(comparison(many));
    const preview = await previewCherryPick(makePr(), TARGET);
    expect(preview.divergence.known).toBe(false);
  });
});

describe('cherryPickPullRequest', () => {
  it('uses the recorded commit of a merged PR without resolving its deleted source branch', async () => {
    const pr = makePr({ headRef: 'deleted/fix', merged: true, state: 'closed' });
    svc.getBranchHead.mockImplementation(async (_repo, branch) => {
      if (branch === pr.headRef) throw new Error('Source branch was deleted');
      return 'targetsha';
    });

    const result = await cherryPickPullRequest(request({ pr, openPullRequest: true }));

    expect(svc.listPullRequestFiles).toHaveBeenCalledWith(pr.coordinates);
    expect(svc.getFileBlob).toHaveBeenCalledWith(
      { owner: 'octo', name: 'repo' }, 'src/a.ts', HEAD,
    );
    expect(svc.getBranchHead).toHaveBeenCalled();
    for (const [, branch] of svc.getBranchHead.mock.calls) expect(branch).toBe(TARGET);
    expect(pushed()).toEqual({ 'src/a.ts': 'new content' });
    expect(result.pullRequestOpened).toBe(true);
  });

  it('writes the pull request’s version when the target never touched the file', async () => {
    await cherryPickPullRequest(request());

    expect(pushed()).toEqual({ 'src/a.ts': 'new content' });
    // Nothing diverged, so there was no need to read the other two versions.
    expect(svc.getFileBlob).toHaveBeenCalledTimes(1);
    expect(svc.getFileContent).not.toHaveBeenCalled();
  });

  it('keeps a hotfix the target has that the pull request never saw', async () => {
    // The whole point of the feature: both sides changed the file, in
    // different places. A straight copy would throw the hotfix away.
    svc.compare.mockResolvedValue(comparison([file({ filename: 'src/a.ts' })]));
    contents({
      [BASE]: { 'src/a.ts': lines('one', 'two', 'three', 'four') },
      [TARGET]: { 'src/a.ts': lines('one', 'two', 'three', 'HOTFIX') },
      [HEAD]: { 'src/a.ts': lines('ONE', 'two', 'three', 'four') },
    });

    const result = await cherryPickPullRequest(request());

    expect(pushed()['src/a.ts']).toBe(lines('ONE', 'two', 'three', 'HOTFIX'));
    expect(result.merged).toEqual(['src/a.ts']);
  });

  it('refuses, and writes nothing, when the two sides conflict', async () => {
    svc.compare.mockResolvedValue(comparison([file({ filename: 'src/a.ts' })]));
    contents({
      [BASE]: { 'src/a.ts': lines('a', 'b', 'c') },
      [TARGET]: { 'src/a.ts': lines('a', 'OURS', 'c') },
      [HEAD]: { 'src/a.ts': lines('a', 'THEIRS', 'c') },
    });

    await expect(cherryPickPullRequest(request())).rejects.toBeInstanceOf(CherryPickRefused);
    expect(svc.createBranch).not.toHaveBeenCalled();
    expect(svc.commitFiles).not.toHaveBeenCalled();
  });

  it('names the conflicting file in the refusal', async () => {
    svc.compare.mockResolvedValue(comparison([file({ filename: 'src/a.ts' })]));
    contents({
      [BASE]: { 'src/a.ts': lines('a', 'b') },
      [TARGET]: { 'src/a.ts': lines('a', 'OURS') },
      [HEAD]: { 'src/a.ts': lines('a', 'THEIRS') },
    });

    await expect(cherryPickPullRequest(request())).rejects.toThrow(/src\/a\.ts/);
  });

  it('refuses rather than guessing when the target’s version cannot be read', async () => {
    // A failed read must not be mistaken for "the file isn't there", which
    // would merge against nothing and overwrite the target wholesale.
    svc.compare.mockResolvedValue(comparison([file({ filename: 'src/a.ts' })]));
    contents({
      [BASE]: { 'src/a.ts': 'old' },
      [TARGET]: { 'src/a.ts': UNREADABLE },
      [HEAD]: { 'src/a.ts': 'new' },
    });

    await expect(cherryPickPullRequest(request())).rejects.toThrow(/could not be read/);
    expect(svc.createBranch).not.toHaveBeenCalled();
  });

  it('refuses a change to a file the target does not have', async () => {
    // git calls this a modify/delete conflict. Writing the pull request's copy
    // would bring the whole file — not just this change — onto the target.
    svc.compare.mockResolvedValue(comparison([], 'behind'));
    contents({
      [BASE]: { 'src/a.ts': 'old' },
      [TARGET]: {},
      [HEAD]: { 'src/a.ts': 'new' },
    });

    await expect(cherryPickPullRequest(request())).rejects.toThrow(/does not exist on release\/1\.0/);
    expect(svc.createBranch).not.toHaveBeenCalled();
  });

  it('merges instead of copying when the target branched off before the pull request’s base', async () => {
    // A release branch cut earlier compares as `diverged`, and GitHub lists only
    // what changed since the merge base. The base's own later change to line 1
    // is not part of this pull request and must not be carried to the release.
    svc.compare.mockResolvedValue(comparison([], 'diverged'));
    contents({
      [BASE]: { 'src/a.ts': lines('v2 line 1', 'b', 'c') },
      [TARGET]: { 'src/a.ts': lines('v1 line 1', 'b', 'c') },
      [HEAD]: { 'src/a.ts': lines('v2 line 1', 'b', 'FIX') },
    });

    await cherryPickPullRequest(request());

    expect(pushed()['src/a.ts']).toBe(lines('v1 line 1', 'b', 'FIX'));
  });

  it('accepts a missing target file when the pull request is the one adding it', async () => {
    svc.listPullRequestFiles.mockResolvedValue([
      file({ filename: 'src/new.ts', status: 'added' }),
    ]);
    svc.compare.mockResolvedValue(comparison([file({ filename: 'src/new.ts' })]));
    contents({ [HEAD]: { 'src/new.ts': 'brand new' } });

    await cherryPickPullRequest(request());

    expect(pushed()).toEqual({ 'src/new.ts': 'brand new' });
  });

  it('does not rewrite a file the target already matches', async () => {
    svc.listPullRequestFiles.mockResolvedValue([
      file({ filename: 'src/a.ts' }),
      file({ filename: 'src/b.ts' }),
    ]);
    svc.compare.mockResolvedValue(comparison([file({ filename: 'src/a.ts' })]));
    contents({
      [BASE]: { 'src/a.ts': 'old', 'src/b.ts': 'b-old' },
      [TARGET]: { 'src/a.ts': 'already picked' },
      [HEAD]: { 'src/a.ts': 'already picked', 'src/b.ts': 'b-new' },
    });

    const result = await cherryPickPullRequest(request());

    expect(result.unchanged).toEqual(['src/a.ts']);
    expect(pushed()).toEqual({ 'src/b.ts': 'b-new' });
  });

  it('refuses when the target already has everything', async () => {
    svc.compare.mockResolvedValue(comparison([file({ filename: 'src/a.ts' })]));
    contents({
      [BASE]: { 'src/a.ts': 'old' },
      [TARGET]: { 'src/a.ts': 'new content' },
      [HEAD]: { 'src/a.ts': 'new content' },
    });

    await expect(cherryPickPullRequest(request())).rejects.toThrow(/already has every change/);
    expect(svc.createBranch).not.toHaveBeenCalled();
  });

  it('refuses a binary file rather than corrupting it', async () => {
    contents({ [HEAD]: { 'src/a.ts': BINARY } });

    await expect(cherryPickPullRequest(request())).rejects.toThrow(/binary/);
    expect(svc.createBranch).not.toHaveBeenCalled();
    expect(svc.commitFiles).not.toHaveBeenCalled();
  });

  it('refuses text with a NUL byte as binary', async () => {
    contents({ [HEAD]: { 'src/a.ts': 'bin\u0000ary' } });

    await expect(cherryPickPullRequest(request())).rejects.toThrow(/binary/);
    expect(svc.createBranch).not.toHaveBeenCalled();
  });

  it('merges files the target changed even when the comparison was truncated', async () => {
    // `known: false` must fall back to reading all three versions rather than
    // assuming the fast path.
    const many = Array.from({ length: 300 }, (_, i) => file({ filename: `f${i}.ts` }));
    svc.compare.mockResolvedValue(comparison(many));
    contents({
      [BASE]: { 'src/a.ts': lines('a', 'b', 'c') },
      [TARGET]: { 'src/a.ts': lines('a', 'b', 'TARGET') },
      [HEAD]: { 'src/a.ts': lines('HEAD', 'b', 'c') },
    });

    await cherryPickPullRequest(request());

    expect(pushed()['src/a.ts']).toBe(lines('HEAD', 'b', 'TARGET'));
  });

  describe('deletions', () => {
    beforeEach(() => {
      svc.listPullRequestFiles.mockResolvedValue([
        file({ filename: 'src/gone.ts', status: 'removed' }),
      ]);
    });

    it('deletes a file the target has not touched', async () => {
      await cherryPickPullRequest(request());
      expect(deletedPaths()).toEqual(['src/gone.ts']);
    });

    it('refuses to delete a file the target has changed', async () => {
      svc.compare.mockResolvedValue(comparison([file({ filename: 'src/gone.ts' })]));
      contents({
        [BASE]: { 'src/gone.ts': 'original' },
        [TARGET]: { 'src/gone.ts': 'changed on the release branch' },
      });

      await expect(cherryPickPullRequest(request())).rejects.toThrow(/has changed it/);
      expect(deletedPaths()).toEqual([]);
      expect(svc.createBranch).not.toHaveBeenCalled();
    });

    it('deletes when the target’s copy still matches the base', async () => {
      svc.compare.mockResolvedValue(comparison([file({ filename: 'src/gone.ts' })]));
      contents({
        [BASE]: { 'src/gone.ts': 'same' },
        [TARGET]: { 'src/gone.ts': 'same' },
      });

      await cherryPickPullRequest(request());
      expect(deletedPaths()).toEqual(['src/gone.ts']);
    });

    it('has nothing to do when the target already removed it', async () => {
      svc.compare.mockResolvedValue(
        comparison([file({ filename: 'src/gone.ts', status: 'removed' })]),
      );

      await expect(cherryPickPullRequest(request())).rejects.toThrow(/already has every change/);
      expect(deletedPaths()).toEqual([]);
    });
  });

  it('opens the follow-up pull request when asked', async () => {
    await cherryPickPullRequest(request({ openPullRequest: true }));

    expect(svc.createPullRequest).toHaveBeenCalledWith(
      { owner: 'octo', name: 'repo' },
      expect.objectContaining({ head: 'cherry-pick/pr-42-to-release/1.0', base: TARGET }),
    );
  });

  it('does not open one otherwise', async () => {
    const result = await cherryPickPullRequest(request());
    expect(svc.createPullRequest).not.toHaveBeenCalled();
    expect(result.pullRequestOpened).toBe(false);
  });

  it('rejects a bad branch name before touching anything', async () => {
    await expect(cherryPickPullRequest(request({ newBranch: 'has spaces' }))).rejects.toThrow(
      /spaces/,
    );
    expect(svc.getFileBlob).not.toHaveBeenCalled();
    expect(svc.createBranch).not.toHaveBeenCalled();
  });

  it('refuses to cherry-pick onto the pull request’s own branch', async () => {
    await expect(cherryPickPullRequest(request({ targetBranch: 'fix/crash' }))).rejects.toThrow(
      /own branch/,
    );
  });

  it('writes every change as one commit on top of the new branch’s head', async () => {
    svc.listPullRequestFiles.mockResolvedValue([
      file({ filename: 'src/a.ts' }),
      file({ filename: 'src/gone.ts', status: 'removed' }),
    ]);

    const result = await cherryPickPullRequest(request());

    expect(svc.createBranch).toHaveBeenCalledWith(
      { owner: 'octo', name: 'repo' },
      'cherry-pick/pr-42-to-release/1.0',
      'targetsha',
    );
    expect(svc.commitFiles).toHaveBeenCalledTimes(1);
    expect(svc.commitFiles).toHaveBeenCalledWith(
      { owner: 'octo', name: 'repo' },
      expect.objectContaining({
        branch: 'cherry-pick/pr-42-to-release/1.0',
        expectedHeadOid: 'targetsha',
        headline: 'Fix the crash',
        body: 'Cherry-picked from #42 (headsha).',
        additions: [{ path: 'src/a.ts', content: 'new content' }],
        deletions: ['src/gone.ts'],
      }),
    );
    expect(result.written).toEqual(['src/a.ts']);
    expect(result.deleted).toEqual(['src/gone.ts']);
  });

  it('deletes the new branch again when the commit fails, so nothing is left behind', async () => {
    svc.commitFiles.mockRejectedValue(new Error('Failed to commit: Expected branch to point to "x"'));

    await expect(cherryPickPullRequest(request())).rejects.toThrow(/Nothing was left behind/);
    expect(svc.deleteBranch).toHaveBeenCalledWith(
      { owner: 'octo', name: 'repo' },
      'cherry-pick/pr-42-to-release/1.0',
    );
    expect(svc.createPullRequest).not.toHaveBeenCalled();
  });

  it('names the branch when the commit and the cleanup both fail', async () => {
    svc.commitFiles.mockRejectedValue(new Error('boom'));
    svc.deleteBranch.mockRejectedValue(new Error('forbidden'));

    await expect(cherryPickPullRequest(request())).rejects.toThrow(
      /cherry-pick\/pr-42-to-release\/1\.0.*delete it/,
    );
  });

  it('creates the branch only after every file has been resolved', async () => {
    const order: string[] = [];
    svc.getFileBlob.mockImplementation(async () => {
      order.push('read');
      return { kind: 'text', text: 'new content' };
    });
    svc.createBranch.mockImplementation(async () => {
      order.push('branch');
    });

    await cherryPickPullRequest(request());

    expect(order.indexOf('branch')).toBe(order.length - 1);
  });
});
