import { describe, it, expect } from 'vitest';
import {
  parseSearchItem,
  extractSearchItems,
  parseSearchResponse,
} from '../searchParse';

const prItem = {
  number: 42,
  title: 'Add feature',
  state: 'open',
  draft: false,
  repository_url: 'https://github.com/api/v3/repos/octo/repo',
  html_url: 'https://github.com/octo/repo/pull/42',
  pull_request: { url: 'https://github.com/api/v3/repos/octo/repo/pulls/42' },
  user: { login: 'alice', avatar_url: 'https://x/a.png', html_url: 'https://x/alice' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  comments: 3,
};

describe('parseSearchItem', () => {
  it('parses a pull request item into coordinates and metadata', () => {
    const item = parseSearchItem(prItem);
    expect(item).not.toBeNull();
    expect(item).toMatchObject({
      coordinates: { owner: 'octo', name: 'repo', number: 42 },
      title: 'Add feature',
      state: 'open',
      draft: false,
      updatedAt: '2024-01-02T00:00:00Z',
      commentsCount: 3,
    });
    expect(item?.author).toMatchObject({ login: 'alice', avatarUrl: 'https://x/a.png' });
  });

  it('derives owner/repo from html_url when repository_url is absent', () => {
    const item = parseSearchItem({
      number: 7,
      title: 'From html url',
      html_url: 'https://github.com/foo/bar/pull/7',
    });
    expect(item?.coordinates).toEqual({ owner: 'foo', name: 'bar', number: 7 });
  });

  it('returns null for non-PR issues (no pull_request, no /pull/ url)', () => {
    const issue = {
      number: 9,
      title: 'Just an issue',
      repository_url: 'https://github.com/api/v3/repos/octo/repo',
      html_url: 'https://github.com/octo/repo/issues/9',
    };
    expect(parseSearchItem(issue)).toBeNull();
  });

  it('returns null when coordinates cannot be resolved', () => {
    expect(parseSearchItem({ title: 'x', pull_request: {} })).toBeNull();
    expect(parseSearchItem(null)).toBeNull();
    expect(parseSearchItem('nope')).toBeNull();
  });

  it('marks closed PRs as closed', () => {
    const item = parseSearchItem({ ...prItem, state: 'closed' });
    expect(item?.state).toBe('closed');
  });
});

describe('extractSearchItems', () => {
  it('reads the connector body wrapper', () => {
    expect(extractSearchItems({ body: [1, 2] })).toEqual([1, 2]);
  });

  it('reads a raw items array', () => {
    expect(extractSearchItems({ items: [3] })).toEqual([3]);
  });

  it('reads a bare array', () => {
    expect(extractSearchItems([4, 5])).toEqual([4, 5]);
  });

  it('returns an empty array for unexpected shapes', () => {
    expect(extractSearchItems(null)).toEqual([]);
    expect(extractSearchItems({})).toEqual([]);
    expect(extractSearchItems('x')).toEqual([]);
  });
});

describe('parseSearchResponse', () => {
  it('parses PR items and filters out non-PRs', () => {
    const data = {
      body: [
        prItem,
        {
          number: 100,
          title: 'issue',
          html_url: 'https://github.com/octo/repo/issues/100',
        },
      ],
    };
    const result = parseSearchResponse(data);
    expect(result).toHaveLength(1);
    expect(result[0].coordinates.number).toBe(42);
  });

  it('handles the raw GitHub {items} shape', () => {
    const result = parseSearchResponse({ items: [prItem] });
    expect(result).toHaveLength(1);
  });

  it('returns an empty array when nothing matches', () => {
    expect(parseSearchResponse({ body: [] })).toEqual([]);
    expect(parseSearchResponse(undefined)).toEqual([]);
  });
});
