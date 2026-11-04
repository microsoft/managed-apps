import { describe, it, expect } from 'vitest';
import {
  findMentionQuery,
  filterCandidates,
  applyMention,
  mergeUsers,
} from '../mentions';
import type { GitUserRef } from '../../../types';

const u = (login: string, name?: string, avatarUrl?: string): GitUserRef => ({
  login,
  name,
  avatarUrl,
});

describe('findMentionQuery', () => {
  it('detects a mention at the caret after @', () => {
    const text = 'hey @oct';
    expect(findMentionQuery(text, text.length)).toEqual({
      start: 4,
      end: 8,
      query: 'oct',
    });
  });

  it('detects an empty query right after typing @', () => {
    const text = 'ping @';
    expect(findMentionQuery(text, text.length)).toEqual({
      start: 5,
      end: 6,
      query: '',
    });
  });

  it('triggers at the very start of the text', () => {
    expect(findMentionQuery('@ali', 4)).toEqual({ start: 0, end: 4, query: 'ali' });
  });

  it('does not trigger inside an email address', () => {
    const text = 'mail me at user@example';
    expect(findMentionQuery(text, text.length)).toBeNull();
  });

  it('stops at whitespace between @ and caret', () => {
    const text = '@alice bob';
    expect(findMentionQuery(text, text.length)).toBeNull();
  });

  it('returns null when there is no @ before the caret', () => {
    expect(findMentionQuery('just text', 4)).toBeNull();
  });

  it('handles a mention mid-string with the caret inside the token', () => {
    const text = 'a @bob c';
    // caret right after "@bo"
    expect(findMentionQuery(text, 5)).toEqual({ start: 2, end: 5, query: 'bo' });
  });
});

describe('filterCandidates', () => {
  const people = [
    u('octocat', 'The Octocat'),
    u('octodog'),
    u('alice'),
    u('bob-smith', 'Bob Smith'),
  ];

  it('returns all candidates (up to the limit) for an empty query', () => {
    expect(filterCandidates(people, '').map((p) => p.login)).toEqual([
      'alice',
      'bob-smith',
      'octocat',
      'octodog',
    ]);
  });

  it('prioritizes prefix matches over substring matches', () => {
    const list = [u('mikeocto'), u('octocat')];
    expect(filterCandidates(list, 'octo').map((p) => p.login)).toEqual([
      'octocat',
      'mikeocto',
    ]);
  });

  it('matches on display name too', () => {
    expect(filterCandidates(people, 'smith').map((p) => p.login)).toEqual([
      'bob-smith',
    ]);
  });

  it('respects the limit', () => {
    expect(filterCandidates(people, '', 2)).toHaveLength(2);
  });
});

describe('applyMention', () => {
  it('replaces the token with @login and a trailing space', () => {
    const text = 'hey @oct';
    const range = findMentionQuery(text, text.length)!;
    expect(applyMention(text, range, 'octocat')).toEqual({
      text: 'hey @octocat ',
      caret: 13,
    });
  });

  it('preserves text after the caret', () => {
    const text = 'a @bo c';
    const range = findMentionQuery(text, 5)!;
    const result = applyMention(text, range, 'bob-smith');
    expect(result.text).toBe('a @bob-smith  c');
    expect(result.caret).toBe(13);
  });
});

describe('mergeUsers', () => {
  it('dedupes by login case-insensitively', () => {
    const merged = mergeUsers([u('Octocat')], [u('octocat')]);
    expect(merged).toHaveLength(1);
  });

  it('prefers the record carrying an avatar', () => {
    const merged = mergeUsers([u('octocat')], [u('octocat', undefined, 'a.png')]);
    expect(merged[0].avatarUrl).toBe('a.png');
  });

  it('drops entries that are not valid GitHub handles', () => {
    const merged = mergeUsers([u('valid-user')], [u('Not A Handle'), u('has@symbol')]);
    expect(merged.map((m) => m.login)).toEqual(['valid-user']);
  });

  it('sorts by login', () => {
    const merged = mergeUsers([u('zed'), u('amy')], []);
    expect(merged.map((m) => m.login)).toEqual(['amy', 'zed']);
  });
});
