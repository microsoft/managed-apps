import type { AuthorApproval, GitUserRef, PrSummary } from '../types';
import { prKey } from '../utils/storage';
import { appStorage, type Approval } from '../storage';
import { createLogger } from '../lib/logger';

const log = createLogger('author-approval');

export function isPrAuthor(pr: PrSummary | undefined, user: GitUserRef | undefined): boolean {
  return !!user?.login && !!pr?.author?.login &&
    user.login.toLowerCase() === pr.author.login.toLowerCase();
}

function toApproval(record: Approval, pr: PrSummary): AuthorApproval {
  if (record.prKey.toLowerCase() !== prKey(pr.coordinates).toLowerCase() ||
      !isPrAuthor(pr, { login: record.authorLogin }) ||
      !record.commitId ||
      !Number.isFinite(Date.parse(record.submittedAt))) {
    throw new Error('Invalid author approval record');
  }
  return {
    user: { ...pr.author, login: record.authorLogin },
    state: 'APPROVED',
    source: 'codeflow',
    commitId: record.commitId,
    submittedAt: record.submittedAt,
    approvedCommitIds: [record.commitId],
  };
}

export function mergeAuthorApprovals(
  previous: AuthorApproval | null | undefined,
  incoming: AuthorApproval,
): AuthorApproval {
  if (!previous || previous.user.login.toLowerCase() !== incoming.user.login.toLowerCase()) return incoming;
  return {
    ...(Date.parse(previous.submittedAt) > Date.parse(incoming.submittedAt) ? previous : incoming),
    approvedCommitIds: [...new Set([...previous.approvedCommitIds, ...incoming.approvedCommitIds])],
  };
}

/** Null means no approval; undefined means the read failed, so retain known state. */
export async function fetchAuthorApproval(pr: PrSummary): Promise<AuthorApproval | null | undefined> {
  if (!pr.author?.login) return null;
  try {
    const records = await appStorage().approvals.listAll({
      where: [{ field: 'prKey', op: 'eq', value: prKey(pr.coordinates) }],
    });
    return records
      .filter((record) => record.authorLogin.toLowerCase() === pr.author?.login.toLowerCase())
      .reduce<AuthorApproval | null>((approval, record) => {
        try {
          return mergeAuthorApprovals(approval, toApproval(record, pr));
        } catch {
          return approval;
        }
      }, null);
  } catch (error) {
    log.warn('Could not read app-only author approval', error);
    return undefined;
  }
}

/**
 * Record an app-only approval of the PR's head commit by its author.
 *
 * Appends rather than overwrites so concurrent approvals cannot erase commit
 * history. The authorship check here is a guard against mistakes in the UI, not
 * a security boundary: with a shared storage provider, who may write approvals
 * is decided by the backend's permissions.
 */
export async function recordAuthorApproval(pr: PrSummary, body?: string): Promise<AuthorApproval> {
  const { GitHubService } = await import('./githubService');
  const actor = await GitHubService.getAuthenticatedUser();
  if (!actor || !isPrAuthor(pr, actor)) {
    throw new Error('Only the authenticated GitHub author can record an app-only approval.');
  }
  if (!pr.headSha || pr.state !== 'open' || pr.merged) {
    throw new Error('Author approval requires an open pull request with a known head commit.');
  }
  if (body && body.length > 10_000) throw new Error('Approval comments are limited to 10,000 characters.');
  const key = prKey(pr.coordinates);
  const record: Approval = {
    owner: pr.coordinates.owner,
    repo: pr.coordinates.name,
    number: pr.coordinates.number,
    prKey: key,
    authorLogin: actor.login,
    commitId: pr.headSha,
    submittedAt: new Date().toISOString(),
    ...(body ? { body } : {}),
  };
  try {
    const saved = await appStorage().approvals.create(record);
    return toApproval(saved, pr);
  } catch (error) {
    log.error('Could not save app-only author approval', error);
    throw error;
  }
}
