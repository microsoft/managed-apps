import { describe, it, expect } from 'vitest';
import { deriveCommentId, isNodeId, parsePrKey } from '../helpers';

describe('deriveCommentId', () => {
  it('takes a numeric id', () => {
    expect(deriveCommentId({ id: 2002 })).toBe('2002');
  });

  it('takes databaseId from a GraphQL node', () => {
    expect(deriveCommentId({ databaseId: 1001 })).toBe('1001');
  });

  it('falls back to the id in html_url for review comments', () => {
    expect(
      deriveCommentId({
        html_url: 'https://github.com/o/r/pull/1#discussion_r1001',
      }),
    ).toBe('1001');
  });

  it('reads the issue-comment fragment too', () => {
    expect(
      deriveCommentId({ html_url: 'https://github.com/o/r/pull/1#issuecomment-2002' }),
    ).toBe('2002');
  });

  it('rejects node ids rather than pairing across id spaces', () => {
    // A node id is not a database id. Accepting one would match the wrong
    // comment silently, which is worse than not matching at all.
    expect(deriveCommentId({ id: 'PRRC_kwDOABC123' })).toBeUndefined();
    expect(deriveCommentId({ node_id: 'PRRC_kwDOABC123' })).toBeUndefined();
  });

  it('prefers an explicit id over the url', () => {
    expect(
      deriveCommentId({ id: 1, html_url: 'https://x/pull/1#discussion_r2' }),
    ).toBe('1');
  });

  it('returns undefined when there is nothing to go on', () => {
    expect(deriveCommentId({})).toBeUndefined();
    expect(deriveCommentId({ html_url: 'https://x/pull/1/files' })).toBeUndefined();
  });
});

describe('parsePrKey', () => {
  it('parses a standard prKey', () => {
    expect(parsePrKey('octo-org/codeflow#42')).toEqual({
      owner: 'octo-org',
      repo: 'codeflow',
      pullNumber: 42,
    });
  });

  it('handles repo names with hyphens and dots', () => {
    expect(parsePrKey('my-org/my.repo.v2#100')).toEqual({
      owner: 'my-org',
      repo: 'my.repo.v2',
      pullNumber: 100,
    });
  });

  it('throws on invalid format', () => {
    expect(() => parsePrKey('')).toThrow('Invalid prKey');
    expect(() => parsePrKey('no-hash')).toThrow('Invalid prKey');
    expect(() => parsePrKey('owner/repo')).toThrow('Invalid prKey');
    expect(() => parsePrKey('owner/repo#notanumber')).toThrow('Invalid prKey');
  });
});

describe('isNodeId', () => {
  it('accepts GraphQL node ids and rejects database ids', () => {
    expect(isNodeId('PRRT_kwDOExample0001')).toBe(true);
    expect(isNodeId('1001')).toBe(false);
    expect(isNodeId(1001)).toBe(false);
    expect(isNodeId('')).toBe(false);
  });
});

describe('deriveCommentId with GraphQL urls', () => {
  it('reads the id from a GraphQL `url`', () => {
    expect(deriveCommentId({ id: 'PRRC_x', url: 'https://github.com/o/r/pull/1#discussion_r42' })).toBe('42');
  });
});
