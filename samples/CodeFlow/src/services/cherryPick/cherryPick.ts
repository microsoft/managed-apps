import type { FileChange, FileChangeStatus, PrSummary, RepoRef } from '../../types';
import { GitHubService, type BlobRead } from '../githubService';
import { createLogger } from '../../lib/logger';
import { branchPageUrl } from '../../utils/githubLink';
import { mergeThreeWay } from './threeWayMerge';
import {
  cherryPickCommitMessage,
  cherryPickPrBody,
  cherryPickPrTitle,
  describeOverlap,
  describeRefusal,
  overlappingPaths,
  planCherryPick,
  validateBranchName,
  type CherryPickPlan,
  type SkippedFile,
} from './cherryPickPlan';

const log = createLogger('cherry-pick');

/**
 * Cherry-pick a pull request onto another branch.
 *
 * GitHub has no cherry-pick endpoint and the connector exposes no git plumbing
 * (no create-tree, create-commit or merge), so the commit has to be assembled
 * from file contents. That does *not* mean copying the pull request's files
 * over the target: doing so discards whatever the target branch did to those
 * same files, which is precisely the mistake git exists to prevent.
 *
 * Instead each file is merged the way git would — three-way, against the pull
 * request's base as the common ancestor (see {@link mergeThreeWay}). All three
 * inputs are readable through the connector, so the result is a real merge and
 * a genuine conflict is reported as one.
 *
 * The run is atomic: every file is resolved *before* the branch is created, and
 * any conflict refuses the whole cherry-pick. The changes are then written as a
 * single `createCommitOnBranch` commit; if that fails, the freshly created
 * branch is deleted again so no empty branch is left behind.
 */

/** How many files are resolved at once. */
const FETCH_CONCURRENCY = 5;

/**
 * GitHub caps a comparison's file list at 300. At that length the list may be
 * truncated, and a truncated list cannot prove a file is untouched.
 */
const COMPARE_FILE_CAP = 300;

/** What the target branch has done since the pull request branched off. */
export interface TargetDivergence {
  /**
   * Whether {@link changed} is complete. When false the comparison failed or
   * was truncated, and every file must be checked the slow, exact way.
   */
  known: boolean;
  changed: Map<string, FileChangeStatus>;
}

/** What a cherry-pick would do, worked out before anything is written. */
export interface CherryPickPreview {
  /** The changed files as the pull request reports them. */
  files: FileChange[];
  plan: CherryPickPlan;
  /** Files this cherry-pick touches that have also moved on the target. */
  overlap: string[];
  /** The overlap phrased for the confirmation panel, when there is any. */
  warning?: string;
  divergence: TargetDivergence;
}

/** The request the button hands to {@link cherryPickPullRequest}. */
export interface CherryPickRequest {
  pr: PrSummary;
  targetBranch: string;
  newBranch: string;
  /** Open a pull request from the new branch into the target as well. */
  openPullRequest: boolean;
  /** A preview already computed for this target, to save re-reading the files. */
  preview?: CherryPickPreview;
}

/** What actually happened. */
export interface CherryPickResult {
  branch: string;
  branchUrl: string;
  written: string[];
  deleted: string[];
  /** Files that needed no change because the target already matched. */
  unchanged: string[];
  /** Files merged with divergent changes already on the target branch. */
  merged: string[];
  pullRequestOpened: boolean;
}

/** Raised when the cherry-pick cannot be completed cleanly. Nothing was written. */
export class CherryPickRefused extends Error {
  readonly problems: SkippedFile[];
  constructor(problems: SkippedFile[]) {
    super(describeRefusal(problems));
    this.name = 'CherryPickRefused';
    this.problems = problems;
  }
}

function repoOf(pr: PrSummary): RepoRef {
  return { owner: pr.coordinates.owner, name: pr.coordinates.name };
}

/** The PR's changed files, from GraphQL when it answers and `compare` when it doesn't. */
async function readChangedFiles(pr: PrSummary): Promise<FileChange[]> {
  const fromPr = await GitHubService.listPullRequestFiles(pr.coordinates);
  if (fromPr && fromPr.length > 0) return fromPr;
  const cmp = await GitHubService.compare(repoOf(pr), pr.baseSha, pr.headSha);
  return cmp.files;
}

/**
 * Find what the target branch changed since the pull request's base.
 *
 * Used only to *skip* work: a path missing from a complete comparison provably
 * has the same content on the target as at the base, so the pull request's
 * version is already the merge result.
 *
 * GitHub compares from the two refs' merge base, not from the first ref. That
 * only answers "what did the target change since the base" when the base is an
 * ancestor of the target (`ahead` or `identical`). A release branch cut before
 * the pull request's base (`diverged`), or a target the base has moved past
 * (`behind`), can differ from the base in files the comparison never lists —
 * taking the fast path there would copy changes that are not part of this pull
 * request onto the target. So anything else, like a failed or possibly
 * truncated comparison, sets `known` to false and every file is merged the
 * exact way instead.
 */
async function readDivergence(pr: PrSummary, targetBranch: string): Promise<TargetDivergence> {
  try {
    // Compared against the branch's commit, not its name: the connector routes
    // `compare/{base}...{head}` by path, so a name with a slash (`release/1.0`)
    // is a 404 there.
    const targetSha = await GitHubService.getBranchHead(repoOf(pr), targetBranch);
    const diverged = await GitHubService.compare(repoOf(pr), pr.baseSha, targetSha);
    const changed = new Map(diverged.files.map((f) => [f.filename, f.status]));
    const descends = diverged.status === 'ahead' || diverged.status === 'identical';
    return { known: descends && diverged.files.length < COMPARE_FILE_CAP, changed };
  } catch {
    // Unrelated histories, a deleted branch, a transient failure — none of them
    // are evidence that nothing moved.
    return { known: false, changed: new Map() };
  }
}

/** Whether the target may have changed `path` since the pull request branched. */
function mayHaveMoved(divergence: TargetDivergence, path: string): boolean {
  return !divergence.known || divergence.changed.has(path);
}

/** Work out what a cherry-pick onto `targetBranch` would do, without doing it. */
export async function previewCherryPick(
  pr: PrSummary,
  targetBranch: string,
): Promise<CherryPickPreview> {
  const files = await readChangedFiles(pr);
  const plan = planCherryPick(files);
  const divergence = await readDivergence(pr, targetBranch);
  const overlap = overlappingPaths(plan, [...divergence.changed.keys()]);

  return {
    files,
    plan,
    overlap,
    warning: describeOverlap(overlap, targetBranch),
    divergence,
  };
}

async function readAt(repo: RepoRef, path: string, ref: string): Promise<string | undefined> {
  return GitHubService.getFileContent(repo, path, ref).catch(() => undefined);
}

/**
 * The file's content at the pull request's base.
 *
 * A file the pull request creates has no ancestor, and a rename is treated as a
 * creation at the new path — its old path is handled separately, as a deletion.
 */
async function readBaseContent(
  repo: RepoRef,
  pr: PrSummary,
  path: string,
  status: FileChangeStatus | undefined,
): Promise<string | undefined> {
  if (status === 'added' || status === 'renamed' || status === 'copied') return '';
  return readAt(repo, path, pr.baseSha);
}

/** A file on the target branch: its text, positively absent, or unknown. */
type TargetRead = { kind: 'text'; text: string } | { kind: 'missing' } | { kind: 'unreadable' };

/**
 * Read a file on the target branch.
 *
 * Absence and a failed read must not be confused: treating a failed read as
 * "absent" would merge against a blank file and reintroduce exactly the
 * overwriting this module exists to prevent. GraphQL answers a path that isn't
 * there with a null object, which is a positive statement, so only that counts
 * as missing.
 */
async function readTarget(repo: RepoRef, path: string, targetBranch: string): Promise<TargetRead> {
  const blob = await GitHubService.getFileBlob(repo, path, targetBranch).catch(
    (): BlobRead => ({ kind: 'unavailable' }),
  );
  if (blob.kind === 'text') return blob;
  if (blob.kind === 'missing') return { kind: 'missing' };
  return { kind: 'unreadable' };
}

interface ResolvedWrite {
  path: string;
  content: string;
  /** True when the target had diverged and the change had to be merged in. */
  merged: boolean;
  /** True when the target already matches, so there is nothing to write. */
  unchanged: boolean;
}

/** Decide the content one written path should end up with on the new branch. */
async function resolveWrite(
  repo: RepoRef,
  pr: PrSummary,
  targetBranch: string,
  path: string,
  status: FileChangeStatus | undefined,
  divergence: TargetDivergence,
): Promise<ResolvedWrite | SkippedFile> {
  const blob = await GitHubService.getFileBlob(repo, path, pr.headSha).catch(
    (): BlobRead => ({ kind: 'unavailable' }),
  );
  if (blob.kind === 'binary') {
    return { path, reason: 'it is a binary file, which this cherry-pick can’t carry' };
  }
  if (blob.kind !== 'text') {
    return { path, reason: 'its content could not be read from this pull request' };
  }
  const theirs = blob.text;
  // A NUL byte means a binary slipped through as text; writing it back would
  // corrupt the file silently.
  if (theirs.includes('\u0000')) {
    return { path, reason: 'it is a binary file, which this cherry-pick can’t carry' };
  }

  // The fast path: the target provably has not touched this file, so the pull
  // request's version *is* the merge result.
  if (!mayHaveMoved(divergence, path)) {
    return { path, content: theirs, merged: false, unchanged: false };
  }

  const [base, target] = await Promise.all([
    readBaseContent(repo, pr, path, status),
    readTarget(repo, path, targetBranch),
  ]);
  if (base == null) {
    return { path, reason: 'its original version could not be read' };
  }
  if (target.kind === 'unreadable') {
    return { path, reason: `its version on ${targetBranch} could not be read` };
  }
  // A file the pull request changes but the target doesn't have: git calls
  // this a modify/delete conflict. (A file the pull request adds has an empty
  // base, so an absent target is exactly what is expected there.)
  if (target.kind === 'missing' && base !== '') {
    return { path, reason: `it does not exist on ${targetBranch}` };
  }
  const ours = target.kind === 'text' ? target.text : '';

  if (ours === theirs) return { path, content: ours, merged: false, unchanged: true };
  if (ours === base) return { path, content: theirs, merged: false, unchanged: false };

  const merge = mergeThreeWay(base, ours, theirs);
  if (merge.status === 'unmergeable') {
    return { path, reason: 'it is too large to merge here' };
  }
  if (merge.status === 'conflict') {
    const n = merge.conflicts;
    return {
      path,
      reason: `it conflicts with ${targetBranch} in ${n} place${n === 1 ? '' : 's'}`,
    };
  }
  return { path, content: merge.content, merged: true, unchanged: false };
}

function isProblem<T extends object>(value: T | SkippedFile): value is SkippedFile {
  return 'reason' in value;
}

interface ResolvedDelete {
  path: string;
  /** The target does not have this file, so there is nothing to remove. */
  alreadyGone: boolean;
}

/**
 * Check that a deletion is safe.
 *
 * Deleting a file the target has meanwhile modified throws that work away; git
 * calls this a delete/modify conflict and stops, and so do we.
 */
async function resolveDelete(
  repo: RepoRef,
  pr: PrSummary,
  targetBranch: string,
  path: string,
  divergence: TargetDivergence,
): Promise<ResolvedDelete | SkippedFile> {
  if (!mayHaveMoved(divergence, path)) return { path, alreadyGone: false };
  if (divergence.known && divergence.changed.get(path) === 'removed') {
    return { path, alreadyGone: true };
  }

  const [base, target] = await Promise.all([
    readAt(repo, path, pr.baseSha),
    readTarget(repo, path, targetBranch),
  ]);
  if (target.kind === 'missing') return { path, alreadyGone: true };
  if (target.kind === 'unreadable') {
    return { path, reason: `its version on ${targetBranch} could not be read` };
  }
  if (base == null) {
    return { path, reason: 'its original version could not be read' };
  }
  if (base === target.text) return { path, alreadyGone: false };
  return {
    path,
    reason: `this pull request deletes it, but ${targetBranch} has changed it`,
  };
}

/** Run `work` over `items` a few at a time, preserving order. */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  }
  return out;
}

/**
 * Write every change as one commit on the freshly created branch. If that
 * fails, delete the branch again so a failed run leaves nothing behind.
 */
async function commitChanges(
  repo: RepoRef,
  pr: PrSummary,
  branch: string,
  expectedHeadOid: string,
  additions: readonly { path: string; content: string }[],
  deletions: readonly string[],
): Promise<void> {
  const [headline, ...rest] = cherryPickCommitMessage(pr).split('\n');
  try {
    await GitHubService.commitFiles(repo, {
      branch,
      expectedHeadOid,
      headline,
      body: rest.join('\n').trim() || undefined,
      additions,
      deletions,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await GitHubService.deleteBranch(repo, branch);
    } catch (cleanupError) {
      throw new Error(
        `The changes could not be written to ${branch} (${reason}). The branch was created but could not be removed — delete it and try again.`,
        { cause: cleanupError },
      );
    }
    throw new Error(`The changes could not be written (${reason}). Nothing was left behind.`, { cause: error });
  }
}

/**
 * Run the cherry-pick.
 *
 * Rejects with a message meant to be shown verbatim. A {@link CherryPickRefused}
 * means nothing at all was written. A failed commit deletes the branch it had
 * just created; only if that cleanup also fails is the branch named so it can
 * be removed by hand.
 */
export async function cherryPickPullRequest(
  request: CherryPickRequest,
): Promise<CherryPickResult> {
  const { pr, targetBranch, newBranch, openPullRequest } = request;

  const nameError = validateBranchName(newBranch);
  if (nameError) throw new Error(nameError);
  if (!targetBranch.trim()) throw new Error('Choose a branch to cherry-pick onto.');
  if (targetBranch === pr.headRef) {
    throw new Error('That is this pull request’s own branch.');
  }

  const preview = request.preview ?? (await previewCherryPick(pr, targetBranch));
  const { plan, divergence } = preview;
  if (plan.writes.length === 0 && plan.deletes.length === 0) {
    throw new Error('This pull request changes no files, so there is nothing to cherry-pick.');
  }

  const repo = repoOf(pr);
  const statuses = new Map(preview.files.map((f) => [f.filename, f.status]));

  // Resolve everything before writing anything, so a conflict costs nothing
  // more than the time it took to find out.
  const writeResults = await inBatches(plan.writes, FETCH_CONCURRENCY, (path) =>
    resolveWrite(repo, pr, targetBranch, path, statuses.get(path), divergence),
  );
  const deleteResults = await inBatches(plan.deletes, FETCH_CONCURRENCY, (path) =>
    resolveDelete(repo, pr, targetBranch, path, divergence),
  );

  const problems: SkippedFile[] = [
    ...plan.skipped,
    ...writeResults.filter(isProblem),
    ...deleteResults.filter(isProblem),
  ];
  if (problems.length > 0) throw new CherryPickRefused(problems);

  const resolved = writeResults.filter((r): r is ResolvedWrite => !isProblem(r));
  const toWrite = resolved.filter((r) => !r.unchanged);
  const toDelete = deleteResults
    .filter((r): r is ResolvedDelete => !isProblem(r))
    .filter((r) => !r.alreadyGone)
    .map((r) => r.path);

  if (toWrite.length === 0 && toDelete.length === 0) {
    throw new Error(
      `${targetBranch} already has every change from this pull request, so there is nothing to cherry-pick.`,
    );
  }

  const targetSha = await GitHubService.getBranchHead(repo, targetBranch);
  await GitHubService.createBranch(repo, newBranch, targetSha);

  await commitChanges(
    repo,
    pr,
    newBranch,
    targetSha,
    toWrite.map((r) => ({ path: r.path, content: r.content })),
    toDelete,
  );

  let pullRequestOpened = false;
  if (openPullRequest) {
    await GitHubService.createPullRequest(repo, {
      title: cherryPickPrTitle(pr),
      head: newBranch,
      base: targetBranch,
      body: cherryPickPrBody(pr, targetBranch),
    });
    pullRequestOpened = true;
  }

  const merged = resolved.filter((r) => r.merged).map((r) => r.path);
  log.info('cherry-picked pull request');

  return {
    branch: newBranch,
    branchUrl: branchPageUrl(pr.coordinates, newBranch, pr.htmlUrl),
    written: toWrite.map((r) => r.path),
    deleted: toDelete,
    unchanged: resolved.filter((r) => r.unchanged).map((r) => r.path),
    merged,
    pullRequestOpened,
  };
}
