import { describe, it, expect } from 'vitest';
import { parsePrInput, parseRepoInput } from '../parsePrInput';

describe('parsePrInput', () => {
  it('parses a full GitHub pull request URL', () => {
    expect(parsePrInput('https://github.com/octo/repo/pull/42')).toEqual({
      owner: 'octo',
      name: 'repo',
      number: 42,
    });
  });

  it('parses a URL with extra path segments and query', () => {
    expect(parsePrInput('https://x.com/a/b/pull/7/files?diff=split')).toEqual({
      owner: 'a',
      name: 'b',
      number: 7,
    });
  });

  it('parses owner/repo#123 shorthand', () => {
    expect(parsePrInput('octo/repo#123')).toEqual({
      owner: 'octo',
      name: 'repo',
      number: 123,
    });
  });

  it('parses owner/repo/123 shorthand', () => {
    expect(parsePrInput('octo/repo/123')).toEqual({
      owner: 'octo',
      name: 'repo',
      number: 123,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parsePrInput('  octo/repo#5  ')).toEqual({
      owner: 'octo',
      name: 'repo',
      number: 5,
    });
  });

  it('returns null for empty or unparseable input', () => {
    expect(parsePrInput('')).toBeNull();
    expect(parsePrInput('   ')).toBeNull();
    expect(parsePrInput('just some text')).toBeNull();
    expect(parsePrInput('octo/repo')).toBeNull();
  });
});

describe('parseRepoInput', () => {
  it('parses a bare owner/repo', () => {
    expect(parseRepoInput('octo/repo')).toEqual({ owner: 'octo', name: 'repo' });
  });

  it('parses a repository URL', () => {
    expect(parseRepoInput('https://github.com/octo/repo')).toEqual({
      owner: 'octo',
      name: 'repo',
    });
  });

  it('strips a trailing .git suffix', () => {
    expect(parseRepoInput('https://x.com/octo/repo.git')).toEqual({
      owner: 'octo',
      name: 'repo',
    });
  });

  it('trims whitespace', () => {
    expect(parseRepoInput('  octo/repo ')).toEqual({ owner: 'octo', name: 'repo' });
  });

  it('returns null for empty or unparseable input', () => {
    expect(parseRepoInput('')).toBeNull();
    expect(parseRepoInput('noslash')).toBeNull();
    expect(parseRepoInput('a/b/c')).toBeNull();
  });
});
