/**
 * The app's only gateway to the GitHub connector.
 *
 * Everything else in the app talks to the {@link GitHubClient} interface below
 * and never to connector code generation directly, for three reasons:
 *
 * - **Setup:** `generated/` is created on each developer's machine by
 *   `npx ms app add data-source --connector shared_github --as action` and is not
 *   committed. Loading it lazily means `npm test` and `npm run lint` work on a
 *   fresh clone, and the app can show a setup message instead of crashing.
 * - **Testing:** tests replace this module (or call {@link setGitHubClient}) with
 *   a fake, so no test depends on generated code or a live connection.
 * - **Least privilege:** the interface lists exactly the connector operations
 *   the app uses. Review it before adding more.
 *
 * Connector operations used (public GitHub connector, `shared_github`):
 * GetUser, GetPullRequest, GetPullRequests, MergePullRequest, SearchIssues,
 * CompareRepositoryCommits, ListCollaborators, checkCollaborator,
 * CreateReference, CreatePullRequest and SearchGithubWithQuery (GraphQL
 * queries and mutations: comments, reviews, files, branches, commits).
 */

import type { IOperationResult } from '@microsoft/managed-apps/data';

/* ------------------------------ App-owned types ------------------------------ */

export type OperationResult<T> = IOperationResult<T>;

export interface GitHubUser {
  login?: string;
  id?: number;
  name?: string;
  avatar_url?: string;
  html_url?: string;
}

export interface GitHubBranchRef {
  ref?: string;
  sha?: string;
}

export interface GitHubPullRequest {
  number?: number;
  node_id?: string;
  html_url?: string;
  state?: string;
  title?: string;
  body?: string;
  user?: GitHubUser;
  draft?: boolean;
  merged?: boolean;
  mergeable?: boolean;
  mergeable_state?: string;
  base?: GitHubBranchRef;
  head?: GitHubBranchRef;
  created_at?: string;
  updated_at?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
}

export interface GitHubCommitPerson {
  name?: string;
  date?: string;
}

export interface GitHubCommit {
  sha?: string;
  commit?: {
    message?: string;
    author?: GitHubCommitPerson;
    committer?: GitHubCommitPerson;
  };
  author?: GitHubUser;
  parents?: Array<{ sha: string }>;
}

export interface GitHubDiffEntry {
  filename?: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
  sha?: string;
  blob_url?: string;
}

export interface GitHubComparison {
  status?: string;
  ahead_by?: number;
  behind_by?: number;
  total_commits?: number;
  commits?: GitHubCommit[];
  files?: GitHubDiffEntry[];
}

export type GitHubMergeMethod = 'merge' | 'squash' | 'rebase';

/** Merge body; GitHub reads the snake_case fields, the connector schema names the camelCase ones. */
export interface GitHubMergeBody {
  sha?: string;
  mergeMethod?: GitHubMergeMethod;
  commitTitle?: string;
  commitMessage?: string;
  merge_method?: GitHubMergeMethod;
  commit_title?: string;
  commit_message?: string;
}

export interface GitHubMergeResult {
  sha?: string;
  merged?: boolean;
  message?: string;
}

export interface GitHubCreatePullRequestBody {
  title?: string;
  head: string;
  base: string;
  body?: string;
}

export interface GitHubCreateReferenceBody {
  ref: string;
  sha: string;
}

/** List and search operations return loosely typed records. */
export type GitHubRecord = Record<string, unknown>;

export interface GitHubClient {
  getUser(): Promise<OperationResult<GitHubUser>>;
  getPullRequest(owner: string, repo: string, number: number): Promise<OperationResult<GitHubPullRequest>>;
  getPullRequests(
    owner: string,
    repo: string,
    state?: string,
    head?: string,
    base?: string,
    sort?: string,
    direction?: string,
    perPage?: number,
    page?: number,
  ): Promise<OperationResult<GitHubRecord[]>>;
  mergePullRequest(
    body: GitHubMergeBody,
    owner: string,
    repo: string,
    number: number,
  ): Promise<OperationResult<GitHubMergeResult>>;
  searchIssues(
    q: string,
    sort?: string,
    order?: string,
    perPage?: number,
    page?: number,
  ): Promise<OperationResult<unknown>>;
  compareCommits(base: string, head: string, owner: string, repo: string): Promise<OperationResult<GitHubComparison>>;
  listCollaborators(owner: string, repo: string, perPage?: number, page?: number): Promise<OperationResult<GitHubRecord[]>>;
  checkCollaborator(owner: string, repo: string, userName: string): Promise<OperationResult<unknown>>;
  createReference(body: GitHubCreateReferenceBody, owner: string, repo: string): Promise<OperationResult<unknown>>;
  createPullRequest(body: GitHubCreatePullRequestBody, owner: string, repo: string): Promise<OperationResult<unknown>>;
  /** Runs a GraphQL document (queries and mutations) against the GitHub API. */
  graphql(query: string): Promise<OperationResult<unknown>>;
}

/* ----------------------------- Connector binding ----------------------------- */

type GeneratedModule = typeof import('../../generated');
type GeneratedService = GeneratedModule['GitHubService'];

// Resolved at build time; empty until the connector has been added locally.
const generatedModules = import.meta.glob<GeneratedModule>('../../generated/index.ts');

export class GitHubConnectorNotConfiguredError extends Error {
  constructor() {
    super('The GitHub connector has not been added to this app yet. Run the setup steps in the README.');
    this.name = 'GitHubConnectorNotConfiguredError';
  }
}

/** True when connector code has been generated for this app. */
export function isGitHubConnectorConfigured(): boolean {
  return Object.keys(generatedModules).length > 0;
}

let servicePromise: Promise<GeneratedService> | undefined;

function service(): Promise<GeneratedService> {
  const load = Object.values(generatedModules)[0];
  if (!load) return Promise.reject(new GitHubConnectorNotConfiguredError());
  servicePromise ??= load().then((module) => module.GitHubService);
  return servicePromise;
}

// The connector requires an explicit Accept header on several REST operations.
const GITHUB_JSON = 'application/vnd.github+json';

/** The real client, backed by the generated `GitHubService`. */
export const connectorGitHubClient: GitHubClient = {
  async getUser() {
    return (await service()).GetUser();
  },
  async getPullRequest(owner, repo, number) {
    return (await service()).GetPullRequest(owner, repo, number, GITHUB_JSON);
  },
  async getPullRequests(owner, repo, state, head, base, sort, direction, perPage, page) {
    return (await service()).GetPullRequests(owner, repo, state, head, base, sort, direction, perPage, page);
  },
  async mergePullRequest(body, owner, repo, number) {
    return (await service()).MergePullRequest(owner, repo, number, GITHUB_JSON, body);
  },
  async searchIssues(q, sort, order, perPage, page) {
    return (await service()).SearchIssues(q, sort, order, perPage, page);
  },
  async compareCommits(base, head, owner, repo) {
    return (await service()).CompareRepositoryCommits(owner, repo, base, head, GITHUB_JSON);
  },
  async listCollaborators(owner, repo, perPage, page) {
    return (await service()).ListCollaborators(owner, repo, perPage, page);
  },
  async checkCollaborator(owner, repo, userName) {
    return (await service()).checkCollaborator(owner, repo, userName);
  },
  async createReference(body, owner, repo) {
    return (await service()).CreateReference(owner, repo, GITHUB_JSON, body);
  },
  async createPullRequest(body, owner, repo) {
    return (await service()).CreatePullRequest(owner, repo, GITHUB_JSON, body);
  },
  async graphql(query) {
    return (await service()).SearchGithubWithQuery({ query });
  },
};

let active: GitHubClient = connectorGitHubClient;

/**
 * The client every service uses. Delegates to the active implementation, so a
 * test (or a future alternative backend) can swap it with {@link setGitHubClient}.
 */
export const githubClient: GitHubClient = new Proxy({} as GitHubClient, {
  get(_target, property: string) {
    const value = (active as unknown as Record<string, unknown>)[property];
    return typeof value === 'function' ? value.bind(active) : value;
  },
});

/** Replace the active client (tests, demos). Pass `undefined` to restore the connector. */
export function setGitHubClient(client: GitHubClient | undefined): void {
  active = client ?? connectorGitHubClient;
}
