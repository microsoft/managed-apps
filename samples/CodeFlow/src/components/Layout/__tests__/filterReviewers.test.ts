import { describe, it, expect } from 'vitest';
import { filterReviewers } from '../filterReviewers';
import type { Reviewer } from '../../../types';

function reviewer(login: string, state: Reviewer['state'] = 'APPROVED'): Reviewer {
  return { user: { login }, state };
}

describe('filterReviewers', () => {
  it('removes the PR author from the list', () => {
    const reviewers = [reviewer('alice'), reviewer('bob')];
    const result = filterReviewers(reviewers, 'alice');
    expect(result).toHaveLength(1);
    expect(result[0].user.login).toBe('bob');
  });

  it('is case-insensitive for author matching', () => {
    const reviewers = [reviewer('Alice'), reviewer('bob')];
    const result = filterReviewers(reviewers, 'alice');
    expect(result).toHaveLength(1);
    expect(result[0].user.login).toBe('bob');
  });

  it('removes copilot-pull-request-reviewer bot', () => {
    const reviewers = [
      reviewer('chrajase'),
      reviewer('copilot-pull-request-reviewer'),
    ];
    const result = filterReviewers(reviewers);
    expect(result).toHaveLength(1);
    expect(result[0].user.login).toBe('chrajase');
  });

  it('removes accounts with [bot] in the login', () => {
    const reviewers = [reviewer('dependabot[bot]'), reviewer('human')];
    const result = filterReviewers(reviewers);
    expect(result).toHaveLength(1);
    expect(result[0].user.login).toBe('human');
  });

  it('keeps all reviewers when no author and no bots', () => {
    const reviewers = [reviewer('alice'), reviewer('bob')];
    const result = filterReviewers(reviewers);
    expect(result).toHaveLength(2);
  });

  it('handles empty reviewer list', () => {
    const result = filterReviewers([], 'alice');
    expect(result).toHaveLength(0);
  });

  it('handles undefined author login', () => {
    const reviewers = [reviewer('alice')];
    const result = filterReviewers(reviewers, undefined);
    expect(result).toHaveLength(1);
  });
});
