import type { Reviewer } from '../../types';

/** Filter out the PR author and bot reviewers from the display list. */
export function filterReviewers(
  reviewers: Reviewer[],
  prAuthorLogin?: string,
): Reviewer[] {
  return reviewers.filter((r) => {
    const login = r.user.login?.toLowerCase() ?? '';
    if (prAuthorLogin && login === prAuthorLogin.toLowerCase()) return false;
    if (login.startsWith('copilot-pull-req')) return false;
    if (login.includes('[bot]')) return false;
    return true;
  });
}
