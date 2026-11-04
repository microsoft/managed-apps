import {
  githubClient,
  type GitHubCommit as Commit,
  type GitHubDiffEntry as DiffEntry,
  type GitHubMergeBody,
  type GitHubMergeResult as PullRequestMergeResult,
  type GitHubPullRequest as PullRequest,
  type GitHubUser as UserDetailsModel,
  type OperationResult as IOperationResult,
} from '../connectors/github';
import { getUser } from '@microsoft/managed-apps/auth';
import { asRecord, gqlString, runGraphQl, runGraphQlMutation } from './graphQl';
import { parseSearchResponse } from './searchParse';
import { isRewrittenCommit } from '../utils/forcePush';
import type {
  ComparisonResult,
  FileChange,
  FileChangeStatus,
  GitUserRef,
  Iteration,
  MergeMethod,
  MergeOutcome,
  PrCoordinates,
  PrListItem,
  PrSummary,
  RepoRef,
} from '../types';
import { describeError } from './errors';
import {
  GitHubApiError,
  circuitError,
  clearConnectionFault,
  getConnectionFault,
  isCircuitOpen,
  noteConnectionFault,
} from './connectionHealth';

/** The HTTP status the connector reported, when it bothered to include one. */
function statusOf(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/**
 * Unwrap an IOperationResult, throwing a descriptive error on failure.
 *
 * The status is carried through rather than flattened into the message so
 * callers can tell an auth failure from a genuine one without parsing prose.
 */
function unwrap<T>(result: IOperationResult<T>, context: string): T {
  if (!result || !result.success) {
    throw new GitHubApiError(
      `${context}: ${describeError(result?.error)}`,
      statusOf(result?.error),
    );
  }
  return result.data;
}

function shortSha(sha: string | undefined): string {
  return (sha ?? '').slice(0, 7);
}

/**
 * The connector's `GetUser` response, fetched at most once per app session.
 *
 * Several independent callers need the signed-in GitHub identity during boot
 * (the dashboard header, comment attribution, mention completion).
 * Without this the app fired the same request three times on every load, which
 * counts against the same rate limit as everything else. The promise is cached
 * rather than the value so concurrent callers share a single in-flight request.
 */
let cachedUserResult: Promise<IOperationResult<UserDetailsModel> | undefined> | undefined;

function getUserOnce(): Promise<IOperationResult<UserDetailsModel> | undefined> {
  if (!cachedUserResult) {
    cachedUserResult = githubClient.getUser().catch(() => undefined);
  }
  return cachedUserResult;
}

/** Drop the cached identity. Exported for tests and explicit re-authentication. */
export function resetAuthenticatedUserCache(): void {
  cachedUserResult = undefined;
}

/**
 * How long an identical search result is reused before the query is re-issued.
 *
 * Long enough to absorb a component remounting during boot (React's
 * StrictMode deliberately mounts twice in development, and any conditional
 * render higher in the tree can do the same in production), short enough that
 * a reviewer navigating back to the dashboard still sees current data.
 */
const SEARCH_CACHE_TTL_MS = 30_000;

/**
 * How long a *failed* search is remembered.
 *
 * Short, but not zero. Evicting on rejection was the obvious thing to do —
 * one blip shouldn't keep the dashboard broken for the full TTL — except it
 * made failure the one case dedupe didn't cover, so a burst of retries became
 * a burst of network calls at exactly the moment the connection could least
 * afford them. Two seconds collapses that burst into one call while still
 * letting a reviewer's next glance at the page go to the network.
 */
const SEARCH_FAILURE_TTL_MS = 2_000;

interface SearchCacheEntry {
  at: number;
  /** How long this particular entry stays valid — successes live longer. */
  ttl: number;
  promise: Promise<PrListItem[]>;
}

const searchCache = new Map<string, SearchCacheEntry>();

/** Drop all cached searches. Exported for tests and manual refresh. */
export function resetSearchCache(): void {
  searchCache.clear();
  clearConnectionFault();
}

function normalizeUser(u: UserDetailsModel | undefined): GitUserRef | undefined {
  if (!u || !u.login) return undefined;
  return {
    login: u.login,
    name: u.name,
    avatarUrl: u.avatar_url,
    htmlUrl: u.html_url,
  };
}

function normalizeStatus(status: string | undefined): FileChangeStatus {
  switch (status) {
    case 'added':
    case 'removed':
    case 'modified':
    case 'renamed':
    case 'copied':
    case 'changed':
    case 'unchanged':
      return status;
    default:
      return 'modified';
  }
}

function normalizeFile(entry: DiffEntry): FileChange {
  return {
    filename: entry.filename ?? '(unknown)',
    previousFilename: entry.previous_filename,
    status: normalizeStatus(entry.status),
    additions: entry.additions ?? 0,
    deletions: entry.deletions ?? 0,
    changes: entry.changes ?? 0,
    patch: entry.patch,
    sha: entry.sha,
    blobUrl: entry.blob_url,
  };
}

/** First line of a commit message, used as the iteration label. */
function commitTitle(commit: Commit): string {
  const msg = commit.commit?.message ?? '';
  return msg.split('\n', 1)[0] || shortSha(commit.sha);
}

function normalizeCommitToIteration(commit: Commit, index: number): Iteration {
  const sha = commit.sha ?? '';
  const authorDate = commit.commit?.author?.date;
  const committerDate = commit.commit?.committer?.date;
  return {
    index,
    sha,
    shortSha: shortSha(sha),
    label: `Iteration ${index}`,
    message: commitTitle(commit),
    author:
      normalizeUser(commit.author) ??
      (commit.commit?.author?.name
        ? { login: commit.commit.author.name }
        : undefined),
    date: authorDate ?? committerDate,
    isBase: false,
    rewritten: isRewrittenCommit(authorDate, committerDate),
    parents: commit.parents?.map((p) => p.sha).filter((s): s is string => !!s),
  };
}

export interface MergeRequestOptions {
  method: MergeMethod;
  expectedHeadSha?: string;
  commitTitle?: string;
  commitMessage?: string;
}

/**
 * The merge body GitHub will actually read.
 *
 * The connector forwards this object to GitHub untouched, and GitHub's REST API
 * names these fields in snake_case — but the connector's own schema spells three
 * of the four camelCase (`mergeMethod`, `commitTitle`, `commitMessage`). Send
 * only those and GitHub sees no strategy at all, so it falls back to its default
 * of a merge commit: pick "Squash" on a repository that has merge commits turned
 * off and the merge is refused with "Merge commits are not allowed on this
 * repository", naming a strategy nobody chose.
 *
 * So both spellings go over the wire. The snake_case fields are the ones that
 * decide the merge; the camelCase ones keep the request valid should the
 * connector ever start checking bodies against its schema, and GitHub ignores
 * fields it doesn't recognise. `sha` needs no such treatment — the two names
 * agree.
 */
export function buildMergeBody(
  options: MergeRequestOptions,
): GitHubMergeBody {
  return {
    merge_method: options.method,
    mergeMethod: options.method,
    ...(options.expectedHeadSha ? { sha: options.expectedHeadSha } : {}),
    ...(options.commitTitle
      ? { commit_title: options.commitTitle, commitTitle: options.commitTitle }
      : {}),
    ...(options.commitMessage
      ? { commit_message: options.commitMessage, commitMessage: options.commitMessage }
      : {}),
  };
}

/* ------------------------- GraphQL-backed reads ------------------------- */


/** Query for one page of branch names (`refs/heads/*`). */
export function branchesQuery(repo: RepoRef, after: string | null): string {
  return `query { repository(owner: ${gqlString(repo.owner)}, name: ${gqlString(repo.name)}) {
    refs(refPrefix: "refs/heads/", first: 100${after ? `, after: ${gqlString(after)}` : ''}) {
      nodes { name }
      pageInfo { hasNextPage endCursor }
    }
  } }`;
}

/** Read one page of {@link branchesQuery}. */
export function readBranchPage(data: unknown): { names: string[]; hasNextPage: boolean; endCursor?: string } {
  const refs = asRecord(asRecord(asRecord(data)?.repository)?.refs);
  const nodes = Array.isArray(refs?.nodes) ? refs.nodes : [];
  const names = nodes
    .map((node) => asRecord(node)?.name)
    .filter((name): name is string => typeof name === 'string');
  const pageInfo = asRecord(refs?.pageInfo);
  return {
    names,
    hasNextPage: pageInfo?.hasNextPage === true,
    endCursor: typeof pageInfo?.endCursor === 'string' ? pageInfo.endCursor : undefined,
  };
}

/** Query for the commit a branch points at. */
export function branchHeadQuery(repo: RepoRef, branch: string): string {
  return `query { repository(owner: ${gqlString(repo.owner)}, name: ${gqlString(repo.name)}) {
    ref(qualifiedName: ${gqlString(`refs/heads/${branch}`)}) { target { oid } }
  } }`;
}

/** Commit id from {@link branchHeadQuery}; `undefined` when the branch doesn't exist. */
export function readBranchHead(data: unknown): string | undefined {
  const oid = asRecord(asRecord(asRecord(asRecord(data)?.repository)?.ref)?.target)?.oid;
  return typeof oid === 'string' ? oid : undefined;
}

/** Query for a file's text at a commit, branch or tag. */
export function blobQuery(repo: RepoRef, path: string, ref: string): string {
  return `query { repository(owner: ${gqlString(repo.owner)}, name: ${gqlString(repo.name)}) {
    object(expression: ${gqlString(`${ref}:${path}`)}) { ... on Blob { text isBinary isTruncated byteSize } }
  } }`;
}

/** What GraphQL says about a file at a ref. */
export type BlobRead =
  | { kind: 'text'; text: string }
  | { kind: 'binary' }
  | { kind: 'missing' }
  | { kind: 'unavailable' };

/**
 * Read a file through GraphQL. GraphQL has no binary content, so binary (and
 * truncated, very large) files are reported as such rather than as text.
 */
export async function readBlob(repo: RepoRef, path: string, ref: string): Promise<BlobRead> {
  try {
    const data = await runGraphQl(blobQuery(repo, path, ref), 'Could not read file');
    const repository = asRecord(asRecord(data)?.repository);
    if (!repository) return { kind: 'unavailable' };
    const blob = asRecord(repository.object);
    if (!blob) return { kind: 'missing' };
    if (blob.isBinary === true) return { kind: 'binary' };
    if (blob.isTruncated === true || typeof blob.text !== 'string') return { kind: 'unavailable' };
    return { kind: 'text', text: blob.text };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Query for one page of a pull request's changed files. */
export function pullRequestFilesQuery(coords: PrCoordinates, after: string | null): string {
  return `query { repository(owner: ${gqlString(coords.owner)}, name: ${gqlString(coords.name)}) {
    pullRequest(number: ${Math.trunc(coords.number)}) {
      files(first: 100${after ? `, after: ${gqlString(after)}` : ''}) {
        nodes { path additions deletions changeType }
        pageInfo { hasNextPage endCursor }
      }
    }
  } }`;
}

const CHANGE_TYPES: Record<string, FileChangeStatus> = {
  ADDED: 'added',
  DELETED: 'removed',
  RENAMED: 'renamed',
  COPIED: 'copied',
  MODIFIED: 'modified',
  CHANGED: 'changed',
};

/** Read one page of {@link pullRequestFilesQuery}. */
export function readPullRequestFilesPage(data: unknown): { files: FileChange[]; endCursor?: string } {
  const files = asRecord(asRecord(asRecord(asRecord(data)?.repository)?.pullRequest)?.files);
  const nodes = Array.isArray(files?.nodes) ? files.nodes : [];
  const out: FileChange[] = [];
  for (const node of nodes) {
    const row = asRecord(node);
    if (!row || typeof row.path !== 'string') continue;
    const additions = typeof row.additions === 'number' ? row.additions : 0;
    const deletions = typeof row.deletions === 'number' ? row.deletions : 0;
    out.push({
      filename: row.path,
      status: CHANGE_TYPES[String(row.changeType)] ?? 'modified',
      additions,
      deletions,
      changes: additions + deletions,
    });
  }
  const pageInfo = asRecord(files?.pageInfo);
  const endCursor = pageInfo?.hasNextPage === true && typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : undefined;
  return { files: out, endCursor };
}

/**
 * Combine compare's files (which carry patches but are capped at about 300)
 * with the pull request's complete file list. Files compare left out are
 * appended without a patch, so nothing silently disappears from the file list.
 */
export function mergePullRequestFiles(compareFiles: FileChange[], prFiles: FileChange[] | undefined): FileChange[] {
  if (!prFiles || prFiles.length === 0) return compareFiles;
  const known = new Set(compareFiles.map((f) => f.filename));
  return [...compareFiles, ...prFiles.filter((f) => !known.has(f.filename))];
}

/** Base64 of a string's UTF-8 bytes, as `createCommitOnBranch` expects. */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** One commit of whole-file changes, applied on top of `expectedHeadOid`. */
export interface CommitFilesInput {
  branch: string;
  expectedHeadOid: string;
  headline: string;
  body?: string;
  additions: readonly { path: string; content: string }[];
  deletions: readonly string[];
}

/** The `createCommitOnBranch` mutation for {@link CommitFilesInput}. */
export function commitFilesMutation(repo: RepoRef, input: CommitFilesInput): string {
  const additions = input.additions
    .map((f) => `{ path: ${gqlString(f.path)}, contents: ${gqlString(utf8ToBase64(f.content))} }`)
    .join(', ');
  const deletions = input.deletions.map((path) => `{ path: ${gqlString(path)} }`).join(', ');
  const body = input.body ? `, body: ${gqlString(input.body)}` : '';
  return `mutation { createCommitOnBranch(input: {
    branch: { repositoryNameWithOwner: ${gqlString(`${repo.owner}/${repo.name}`)}, branchName: ${gqlString(input.branch)} },
    message: { headline: ${gqlString(input.headline)}${body} },
    fileChanges: { additions: [${additions}], deletions: [${deletions}] },
    expectedHeadOid: ${gqlString(input.expectedHeadOid)}
  }) { commit { oid url } } }`;
}

/** Query for a branch's ref node id, which `deleteRef` needs. */
export function branchRefIdQuery(repo: RepoRef, branch: string): string {
  return `query { repository(owner: ${gqlString(repo.owner)}, name: ${gqlString(repo.name)}) {
    ref(qualifiedName: ${gqlString(`refs/heads/${branch}`)}) { id }
  } }`;
}

/** The `deleteRef` mutation. */
export function deleteRefMutation(refId: string): string {
  return `mutation { deleteRef(input: { refId: ${gqlString(refId)} }) { clientMutationId } }`;
}

export const GitHubService = {
  /** Fetch normalized PR metadata. */
  async getPullRequest(coords: PrCoordinates): Promise<PrSummary> {
    const result = await githubClient.getPullRequest(
      coords.owner,
      coords.name,
      coords.number,
    );
    const pr = unwrap<PullRequest>(result, 'Failed to load pull request');
    return {
      coordinates: coords,
      nodeId: pr.node_id,
      title: pr.title ?? `PR #${coords.number}`,
      body: pr.body,
      state: pr.state === 'closed' ? 'closed' : 'open',
      draft: Boolean(pr.draft),
      merged: Boolean(pr.merged),
      author: normalizeUser(pr.user),
      baseRef: pr.base?.ref ?? 'base',
      baseSha: pr.base?.sha ?? '',
      headRef: pr.head?.ref ?? 'head',
      headSha: pr.head?.sha ?? '',
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      commitsCount: pr.commits,
      htmlUrl: pr.html_url,
      mergeable: pr.mergeable,
      mergeableState: pr.mergeable_state,
    };
  },

  /**
   * Merge a pull request.
   *
   * `expectedHeadSha` is passed through to GitHub's `sha` parameter, which is
   * the whole reason this is safe to offer from a review tool: it makes the
   * merge conditional on the branch still being what was on screen. If someone
   * pushes between the author reading the diff and pressing the button, GitHub
   * refuses rather than merging code nobody has looked at.
   */
  async mergePullRequest(
    coords: PrCoordinates,
    options: MergeRequestOptions,
  ): Promise<MergeOutcome> {
    const result = await githubClient.mergePullRequest(
      buildMergeBody(options),
      coords.owner,
      coords.name,
      coords.number,
    );
    const merge = unwrap<PullRequestMergeResult>(result, 'Failed to merge pull request');
    // A refusal can also arrive as a perfectly successful 200 that simply says
    // no — most often "Head branch was modified", i.e. the sha guard fired.
    if (!merge?.merged) {
      throw new Error(merge?.message || 'GitHub declined to merge the pull request');
    }
    return { merged: true, sha: merge.sha, message: merge.message };
  },

  /** List open (or other state) PRs for a repository, for the picker. */
  async listPullRequests(
    repo: RepoRef,
    state: 'open' | 'closed' | 'all' = 'open',
  ): Promise<PrSummary[]> {
    const result = await githubClient.getPullRequests(
      repo.owner,
      repo.name,
      state,
      undefined,
      undefined,
      undefined,
      undefined,
      100, // per_page — the default of 30 truncates the picker on busy repos
    );
    // GetPullRequests returns loosely-typed records; the shape matches PullRequest.
    const raw = unwrap(result, 'Failed to list pull requests') ?? [];
    const list = raw as unknown as PullRequest[];
    return list.map((pr) => ({
      coordinates: { owner: repo.owner, name: repo.name, number: pr.number ?? 0 },
      title: pr.title ?? `PR #${pr.number}`,
      body: pr.body,
      state: pr.state === 'closed' ? 'closed' : 'open',
      draft: Boolean(pr.draft),
      merged: Boolean(pr.merged),
      author: normalizeUser(pr.user),
      baseRef: pr.base?.ref ?? 'base',
      baseSha: pr.base?.sha ?? '',
      headRef: pr.head?.ref ?? 'head',
      headSha: pr.head?.sha ?? '',
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      htmlUrl: pr.html_url,
    }));
  },

  /**
   * Search pull requests across the instance using GitHub's issue-search
   * qualifiers (e.g. `is:pr is:open review-requested:@me`). Returns lightweight
   * list items suitable for the dashboard. `@me` resolves server-side to the
   * connection's authenticated user.
   */
  /**
   * Search pull requests, reusing an identical recent query rather than
   * re-issuing it.
   *
   * The dashboard's sections are all driven by a handful of searches, and the
   * component that owns them can mount more than once during boot. Deduping
   * here means no call site can accidentally double the request count; pass
   * `force` to bypass it for an explicit user-initiated refresh.
   */
  async searchPullRequests(
    query: string,
    limit = 25,
    opts: { force?: boolean } = {},
  ): Promise<PrListItem[]> {
    const key = `${query}::${limit}`;
    const now = Date.now();

    if (opts.force) {
      // An explicit refresh is the reviewer telling us to try again, which
      // includes trying again after a fault. Give the connection a clean slate
      // rather than making them wait out a cooldown they already reacted to.
      searchCache.delete(key);
      clearConnectionFault();
    } else {
      const hit = searchCache.get(key);
      if (hit && now - hit.at < hit.ttl) return hit.promise;

      // Nothing is retryable while the connection isn't authenticating, and
      // every anonymous request takes a slot from a pool shared with everyone
      // else on the gateway. Fail fast on the fault we already know about.
      const fault = getConnectionFault(now);
      if (fault && isCircuitOpen(now)) return Promise.reject(circuitError(fault));
    }

    const promise = (async () => {
      const result = await githubClient.searchIssues(
        query,
        'updated',
        'desc',
        limit,
      );
      const data = unwrap(result, 'Failed to search pull requests');
      clearConnectionFault();
      return parseSearchResponse(data);
    })();

    searchCache.set(key, { at: now, ttl: SEARCH_CACHE_TTL_MS, promise });
    promise.catch((err: unknown) => {
      noteConnectionFault(err);
      // Demote rather than evict, so the retry wave that follows a failure
      // collapses into one call instead of one call each.
      const entry = searchCache.get(key);
      if (entry?.promise === promise) entry.ttl = SEARCH_FAILURE_TTL_MS;
    });

    return promise;
  },

  /**
   * Identity of the connection's authenticated GitHub user (login + avatar),
   * distinct from {@link getCurrentUser} which returns the managed-apps host
   * identity. Returns `undefined` if it can't be resolved.
   */
  async getAuthenticatedUser(): Promise<GitUserRef | undefined> {
    try {
      const result = await getUserOnce();
      if (!result || !result.success) return undefined;
      return normalizeUser(result.data);
    } catch {
      return undefined;
    }
  },

  /**
   * Compare two refs/SHAs. Returns the changed files (with patches) and the
   * list of commits between them. This is the backbone of both the file list
   * and iteration diffing.
   */
  async compare(
    repo: RepoRef,
    base: string,
    head: string,
  ): Promise<ComparisonResult> {
    const result = await githubClient.compareCommits(
      base,
      head,
      repo.owner,
      repo.name,
    );
    const cmp = unwrap(result, 'Failed to compare commits');
    const files = (cmp.files ?? []).map(normalizeFile);
    const commits = (cmp.commits ?? []).map((c, i) =>
      normalizeCommitToIteration(c, i + 1),
    );
    return {
      baseSha: base,
      headSha: head,
      status: cmp.status,
      aheadBy: cmp.ahead_by,
      behindBy: cmp.behind_by,
      totalCommits: cmp.total_commits,
      files,
      commits,
    };
  },

  /**
   * Build the ordered iteration list for a PR: base (Iteration 0) followed by
   * each commit on the branch. Reuses an existing full-range comparison when
   * provided to avoid a duplicate round-trip.
   */
  async getIterations(
    pr: PrSummary,
    fullRange?: ComparisonResult,
  ): Promise<Iteration[]> {
    const repo: RepoRef = { owner: pr.coordinates.owner, name: pr.coordinates.name };
    const cmp = fullRange ?? (await this.compare(repo, pr.baseSha, pr.headSha));
    const base: Iteration = {
      index: 0,
      sha: pr.baseSha,
      shortSha: shortSha(pr.baseSha),
      label: 'Iteration 0',
      message: `Base (${pr.baseRef})`,
      date: undefined,
      isBase: true,
    };
    return [base, ...cmp.commits];
  },

  /**
   * The complete list of files changed in a pull request (GraphQL `files`,
   * every page). GraphQL carries no patches, so this complements `compare`
   * rather than replacing it — see {@link mergePullRequestFiles}.
   *
   * Returns `undefined` when the list can't be read, so callers fall back to
   * `compare` alone.
   */
  async listPullRequestFiles(coords: PrCoordinates): Promise<FileChange[] | undefined> {
    const files: FileChange[] = [];
    let cursor: string | null = null;
    try {
      for (let page = 0; page < 30; page += 1) {
        const data = await runGraphQl(pullRequestFilesQuery(coords, cursor), 'Could not list changed files', {
          strict: true,
        });
        const result = readPullRequestFilesPage(data);
        files.push(...result.files);
        if (!result.endCursor) break;
        cursor = result.endCursor;
      }
      return files;
    } catch {
      return files.length > 0 ? files : undefined;
    }
  },

  /**
   * The text of a file at a ref (commit SHA or branch), read through GraphQL.
   * Returns `undefined` when the file is missing, binary or can't be read.
   */
  async getFileContent(repo: RepoRef, path: string, ref: string): Promise<string | undefined> {
    const blob = await readBlob(repo, path, ref);
    return blob.kind === 'text' ? blob.text : undefined;
  },

  /** Identity of the signed-in user (from the managed-apps host). */
  async getCurrentUser(): Promise<GitUserRef> {
    const u = await getUser();
    return { login: u.fullName || u.objectId, name: u.fullName };
  },

  /**
   * Stable, unique id for the signed-in reviewer, used to attribute actions such
   * as closing a thread.
   *
   * Preference order matters. GitHub's numeric user id is immutable — it
   * survives a rename, which `login` does not — and it identifies the person all
   * this state is actually about, so it wins. The managed-apps host identity is
   * the fallback, since some hosts return a user with no `objectId` at all.
   *
   * Sources are prefixed so the two id spaces can never collide.
   */
  async getCurrentUserId(): Promise<string | undefined> {
    try {
      const result = await getUserOnce();
      const u = result?.success ? result.data : undefined;
      if (u?.id != null) return `gh:${u.id}`;
      if (u?.login) return `gh:${u.login}`;
    } catch {
      /* fall through to the host identity */
    }

    try {
      const u = await getUser();
      if (u.objectId) return `host:${u.objectId}`;
    } catch {
      /* no identity available */
    }

    return undefined;
  },

  /**
   * List everyone with access to a repository — direct collaborators plus org
   * members who inherit access through a team — so any of them can be
   * @mentioned in a comment, not just people already on the PR. This is the
   * same audience GitHub's web mention picker offers for a repo.
   *
   * The collaborators endpoint pages at 100, so we walk pages until a short
   * page (the end of the list) or a safety cap, returning the full set for
   * instant local prefix-filtering. Without this the picker only ever saw the
   * first 100 collaborators, so anyone further down the list (ordered by user
   * id, not relevance) was impossible to find.
   *
   * Best-effort: on any failure we return whatever was collected so far
   * (possibly `[]`), since a handle can still be typed by hand.
   */
  async listCollaborators(repo: RepoRef, maxPages = 10): Promise<GitUserRef[]> {
    const users: GitUserRef[] = [];
    try {
      for (let page = 1; page <= maxPages; page++) {
        const result = await githubClient.listCollaborators(
          repo.owner,
          repo.name,
          100,
          page,
        );
        if (!result || !result.success) break;
        const raw = (result.data ?? []) as Array<Record<string, unknown>>;
        if (!Array.isArray(raw) || raw.length === 0) break;
        for (const rec of raw) {
          if (!rec || typeof rec !== 'object') continue;
          const login = typeof rec.login === 'string' ? rec.login : undefined;
          if (!login) continue;
          users.push({
            login,
            name: typeof rec.name === 'string' ? rec.name : undefined,
            avatarUrl: typeof rec.avatar_url === 'string' ? rec.avatar_url : undefined,
            htmlUrl: typeof rec.html_url === 'string' ? rec.html_url : undefined,
          });
        }
        // A page shorter than the page size is the last page.
        if (raw.length < 100) break;
      }
    } catch {
      /* best-effort: return whatever we managed to collect */
    }
    return users;
  },

  /**
   * Confirm whether a single login has access to the repository. Used as a live
   * resolver so a fully-typed handle can still be @mentioned when the person is
   * beyond the preloaded collaborator pages. Returns `false` on any error,
   * including the 404 the endpoint returns for a non-collaborator.
   */
  async isCollaborator(repo: RepoRef, login: string): Promise<boolean> {
    const userName = login.trim();
    if (!userName) return false;
    try {
      const result = await githubClient.checkCollaborator(
        repo.owner,
        repo.name,
        userName,
      );
      return Boolean(result && result.success);
    } catch {
      return false;
    }
  },

  /**
   * Every branch in the repository, for the cherry-pick target picker.
   *
   * Paged the same way as {@link listCollaborators} and equally best-effort:
   * the picker lets a name be typed by hand, so a short list is a nuisance
   * rather than a dead end.
   */
  async listBranches(repo: RepoRef, maxPages = 10): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | null = null;
    try {
      for (let page = 0; page < maxPages; page++) {
        const data = await runGraphQl(branchesQuery(repo, cursor), 'Could not list branches');
        const refs = readBranchPage(data);
        names.push(...refs.names);
        if (!refs.hasNextPage || !refs.endCursor) break;
        cursor = refs.endCursor;
      }
    } catch {
      /* best-effort */
    }
    return names;
  },

  /**
   * The commit a branch currently points at. Throws when the branch is unknown.
   * Uses GraphQL: the connector's GetReference operation can't address `heads/<branch>`.
   */
  async getBranchHead(repo: RepoRef, branch: string): Promise<string> {
    const data = await runGraphQl(branchHeadQuery(repo, branch), `Failed to read branch ${branch}`);
    const sha = readBranchHead(data);
    if (!sha) throw new Error(`Branch ${branch} has no commit to branch from.`);
    return sha;
  },

  /** Create a branch at a given commit. Fails loudly when the name is taken. */
  async createBranch(repo: RepoRef, branch: string, sha: string): Promise<void> {
    const result = await githubClient.createReference(
      { ref: `refs/heads/${branch}`, sha },
      repo.owner,
      repo.name,
    );
    unwrap(result, `Failed to create branch ${branch}`);
  },

  /**
   * Commit whole-file additions and deletions to a branch as ONE commit
   * (GraphQL `createCommitOnBranch`). Fails if the branch moved past
   * `expectedHeadOid`. Returns the new commit's SHA.
   */
  async commitFiles(repo: RepoRef, input: CommitFilesInput): Promise<string | undefined> {
    const data = await runGraphQlMutation(commitFilesMutation(repo, input), `Failed to commit to ${input.branch}`);
    const oid = asRecord(asRecord(asRecord(data)?.createCommitOnBranch)?.commit)?.oid;
    return typeof oid === 'string' ? oid : undefined;
  },

  /** Delete a branch (GraphQL `ref { id }` then `deleteRef`). Missing branches are a no-op. */
  async deleteBranch(repo: RepoRef, branch: string): Promise<void> {
    const data = await runGraphQl(branchRefIdQuery(repo, branch), `Failed to find branch ${branch}`, { strict: true });
    const refId = asRecord(asRecord(asRecord(data)?.repository)?.ref)?.id;
    if (typeof refId !== 'string') return;
    await runGraphQlMutation(deleteRefMutation(refId), `Failed to delete branch ${branch}`);
  },

  /** A file at a ref, distinguishing text, binary, missing and unreadable. */
  getFileBlob(repo: RepoRef, path: string, ref: string): Promise<BlobRead> {
    return readBlob(repo, path, ref);
  },

  /** Open a pull request. Returns nothing — the connector reports no body. */
  async createPullRequest(
    repo: RepoRef,
    input: { title: string; head: string; base: string; body?: string },
  ): Promise<void> {
    const result = await githubClient.createPullRequest(
      { title: input.title, head: input.head, base: input.base, body: input.body },
      repo.owner,
      repo.name,
    );
    unwrap(result, 'Failed to open the pull request');
  },
};

export type GitHubServiceType = typeof GitHubService;
