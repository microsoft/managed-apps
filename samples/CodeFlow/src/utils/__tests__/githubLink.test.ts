import { describe, it, expect } from 'vitest';
import { githubLink, githubCommentUrl, prPageUrl, repoPageUrl, branchPageUrl } from '../githubLink';

const COORDS = { owner: 'octo', name: 'repo', number: 42 };

describe('githubLink', () => {
  it('passes safe https links through unchanged', () => {
    expect(githubLink('https://github.com/octo/repo/pull/42#discussion_r7')).toBe(
      'https://github.com/octo/repo/pull/42#discussion_r7',
    );
  });

  it('drops links that are not https', () => {
    expect(githubLink('javascript:alert(1)')).toBeUndefined();
    expect(githubLink('http://github.com/octo/repo')).toBeUndefined();
    expect(githubLink('/relative/path')).toBeUndefined();
  });

  it('passes undefined and empty values through', () => {
    expect(githubLink(undefined)).toBeUndefined();
    expect(githubLink('')).toBe('');
  });
});

describe('prPageUrl', () => {
  it('ignores an unsafe PR URL and rebuilds from coordinates', () => {
    expect(prPageUrl(COORDS, 'javascript:alert(1)')).toBe('https://github.com/octo/repo/pull/42');
  });
});

describe('prPageUrl', () => {
  it('prefers the PR’s own URL', () => {
    expect(prPageUrl(COORDS, 'https://github.example/o/r/pull/7')).toBe(
      'https://github.example/o/r/pull/7',
    );
  });

  it('trims trailing slashes off the PR’s own URL', () => {
    expect(prPageUrl(COORDS, 'https://github.example/o/r/pull/7//')).toBe(
      'https://github.example/o/r/pull/7',
    );
  });

  it('rebuilds from coordinates when the URL is unknown', () => {
    expect(prPageUrl(COORDS)).toBe('https://github.com/octo/repo/pull/42');
  });
});

describe('githubCommentUrl', () => {
  it('uses GitHub’s own permalink when there is one', () => {
    expect(
      githubCommentUrl({
        coords: COORDS,
        prHtmlUrl: 'https://github.com/octo/repo/pull/42',
        commentHtmlUrl: 'https://github.com/octo/repo/pull/42#discussion_r1001',
        commentId: '1',
      }),
    ).toBe('https://github.com/octo/repo/pull/42#discussion_r1001');
  });

  it('rebuilds a review comment anchor from the database id', () => {
    expect(
      githubCommentUrl({
        coords: COORDS,
        prHtmlUrl: 'https://github.com/octo/repo/pull/42',
        commentId: '1001',
      }),
    ).toBe('https://github.com/octo/repo/pull/42#discussion_r1001');
  });

  it('anchors a PR-level conversation comment as an issue comment', () => {
    expect(
      githubCommentUrl({
        coords: COORDS,
        commentId: '2002',
        isIssueComment: true,
      }),
    ).toBe('https://github.com/octo/repo/pull/42#issuecomment-2002');
  });

  it('falls back to the PR page when the id is a node id', () => {
    expect(githubCommentUrl({ coords: COORDS, commentId: 'PRRC_kwDOAbc' })).toBe(
      'https://github.com/octo/repo/pull/42',
    );
  });

  it('falls back to the PR page when nothing identifies the comment', () => {
    expect(githubCommentUrl({ coords: COORDS })).toBe(
      'https://github.com/octo/repo/pull/42',
    );
  });
});

describe('repoPageUrl', () => {
  const coords = { owner: 'octo', name: 'repo', number: 42 };

  it('rebuilds the repository page from coordinates alone', () => {
    expect(repoPageUrl(coords)).toBe('https://github.com/octo/repo');
  });

  // A second GitHub instance would otherwise get links to the first one.
  it('keeps the host the pull request actually came from', () => {
    expect(repoPageUrl(coords, 'https://github.contoso.com/octo/repo/pull/42')).toBe(
      'https://github.contoso.com/octo/repo',
    );
  });
});

describe('branchPageUrl', () => {
  const coords = { owner: 'octo', name: 'repo', number: 42 };

  it('points at the branch', () => {
    expect(branchPageUrl(coords, 'cherry-pick/pr-42-to-release/1.0')).toBe(
      'https://github.com/octo/repo/tree/cherry-pick/pr-42-to-release/1.0',
    );
  });
});