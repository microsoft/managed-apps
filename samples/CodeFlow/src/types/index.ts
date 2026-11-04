/**
 * Domain types for the CodeFlow app.
 *
 * These are app-facing models normalized from the generated GitHub
 * connector types. Keeping a thin domain layer lets the UI stay decoupled from
 * the raw connector shapes (which are heavily optional).
 */

import type { ClosedEntry } from '../utils/sharedClosed';

export type { ClosedEntry };

/** Sentinel filename for the PR description / top-level comments pseudo-file. */
export const DESCRIPTION_FILE = '__description__';

/** A repository coordinate. */
export interface RepoRef {
  owner: string;
  name: string;
}

/** A fully-qualified pull request coordinate. */
export interface PrCoordinates extends RepoRef {
  number: number;
}

/** A GitHub user, normalized for display. */
export interface GitUserRef {
  login: string;
  name?: string;
  avatarUrl?: string;
  htmlUrl?: string;
}

/** High-level pull request metadata. */
export interface PrSummary {
  coordinates: PrCoordinates;
  /**
   * GraphQL node id. Optional because the REST payload is the source of truth
   * for everything else here, but GraphQL mutations — publishing a draft, for
   * one — address a pull request by node id and nothing else.
   */
  nodeId?: string;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  author?: GitUserRef;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  createdAt?: string;
  updatedAt?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  commitsCount?: number;
  htmlUrl?: string;
  /**
   * Whether GitHub believes the branch merges cleanly. Genuinely tri-state:
   * GitHub computes mergeability lazily, so the first read of a PR it hasn't
   * looked at yet answers `undefined` — which means "ask again", not "no".
   */
  mergeable?: boolean;
  /**
   * GitHub's own word for why the merge is or isn't available (`clean`,
   * `blocked`, `dirty`, `behind`, `unknown`…). Kept raw: the values are
   * undocumented and change, so it's shown as evidence rather than branched on.
   */
  mergeableState?: string;
}

/**
 * How a pull request's commits are written onto the base branch.
 *
 * These are GitHub's three strategies, spelled the way the REST API expects
 * them — the value goes over the wire verbatim.
 */
export type MergeMethod = 'merge' | 'squash' | 'rebase';

/** What GitHub said when asked to merge. */
export interface MergeOutcome {
  merged: boolean;
  /** The resulting merge commit, when one was made. */
  sha?: string;
  /** GitHub's own message — the useful half of a refusal. */
  message?: string;
}

/**
 * How a single check landed, collapsed to the four outcomes a reviewer acts on.
 *
 * GitHub spreads this across two vocabularies — a check run has a `status` plus
 * a `conclusion`, a legacy commit status has only a `state` — and between them
 * they define a dozen values. Most of that detail changes nothing about what a
 * reviewer does next, so it collapses here: `neutral` covers neutral/skipped
 * outcomes, and `failure` covers unsuccessful results. Whether a result blocks
 * merging depends on the check's separate requirement for this PR.
 */
export type CheckOutcome = 'success' | 'failure' | 'pending' | 'neutral';

/** Where a check came from — a Checks API run, or a legacy commit status. */
export type CheckKind = 'check' | 'status';

/** One required or informational entry in a pull request's check list. */
export interface PrCheck {
  /** Stable per-PR identity: the check run's database id, or the status context. */
  id: string;
  name: string;
  outcome: CheckOutcome;
  /** The provider's own word for it ("SUCCESS", "IN_PROGRESS"), for the tooltip. */
  rawState: string;
  /** One-line result summary, when the provider gave one. */
  description?: string;
  kind: CheckKind;
  /** GitHub's requirement for this PR. Absent means unknown, not optional. */
  isRequired?: boolean;
  /** The provider's own link. Often useless — see {@link src/services/checks}. */
  detailsUrl?: string;
}

/** A pull request's checks, plus outcome tallies across all reported checks. */
export interface ChecksSummary {
  checks: PrCheck[];
  /** The head commit the checks were reported against. */
  sha: string;
  passed: number;
  failed: number;
  pending: number;
  total: number;
}

/**
 * A lightweight PR entry for dashboard/list views. Unlike {@link PrSummary},
 * it omits diff-only fields (base/head refs, SHAs) that require a full PR fetch,
 * so it can be built directly from a search result or a stored reference.
 */
export interface PrListItem {
  coordinates: PrCoordinates;
  title: string;
  state?: 'open' | 'closed';
  draft?: boolean;
  author?: GitUserRef;
  createdAt?: string;
  updatedAt?: string;
  htmlUrl?: string;
  commentsCount?: number;
}

/** A reviewer's vote/state on the PR. */
export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';

export interface Reviewer {
  user: GitUserRef;
  state: ReviewState;
  /** Absent for GitHub reviews; CodeFlow votes never satisfy GitHub merge rules. */
  source?: 'codeflow';
  submittedAt?: string;
  /** Commit SHA the review was submitted against (for staleness detection). */
  commitId?: string;
  /** Distinct SHAs from this user's APPROVED reviews, not just their latest vote. */
  approvedCommitIds?: string[];
}

export interface AuthorApproval extends Reviewer {
  state: 'APPROVED';
  source: 'codeflow';
  submittedAt: string;
  commitId: string;
  approvedCommitIds: string[];
}

/**
 * An "iteration" of the PR. Modeled as: base = Iteration 0, then each commit on
 * the PR branch (oldest -> newest) is Iteration 1..N. Two iterations can be
 * selected to diff just the range between them.
 */
export interface Iteration {
  /** 0 for base, 1..N for commits in chronological order. */
  index: number;
  sha: string;
  shortSha: string;
  label: string;
  message?: string;
  author?: GitUserRef;
  date?: string;
  isBase: boolean;
  /**
   * True when the commit's committer date is meaningfully later than its author
   * date, suggesting it was replayed or amended. This does not establish that
   * published history changed and must not trigger a force-push warning alone.
   */
  rewritten?: boolean;
  /**
   * Parent commit SHAs, oldest-first as Git orders them. Two or more parents
   * means this iteration is a merge commit, and `parents[1]` is the tip of the
   * branch that was merged in. Kept raw so that all merge semantics live in
   * `utils/mergeIterations`.
   */
  parents?: string[];
}

export type FileChangeStatus =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'copied'
  | 'changed'
  | 'unchanged';

/** A single changed file within a comparison. */
export interface FileChange {
  filename: string;
  previousFilename?: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  changes: number;
  /** Unified-diff patch text (may be absent for binary/large files). */
  patch?: string;
  sha?: string;
  blobUrl?: string;
}

/** The result of comparing two refs: the changed files plus the commit range. */
export interface ComparisonResult {
  baseSha: string;
  headSha: string;
  status?: string;
  aheadBy?: number;
  behindBy?: number;
  totalCommits?: number;
  files: FileChange[];
  commits: Iteration[];
}

/* ----------------------------- Diff model ------------------------------ */

export type DiffLineType = 'add' | 'del' | 'context' | 'hunk' | 'meta';

export interface DiffLine {
  type: DiffLineType;
  /** Line number in the old (left) file, when applicable. */
  oldLineNo?: number;
  /** Line number in the new (right) file, when applicable. */
  newLineNo?: number;
  content: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  hunks: DiffHunk[];
  /** True when there is no textual patch (binary, too large, or unchanged). */
  isEmpty: boolean;
}

/* ---------------------------- Comments model --------------------------- */

export type CommentThreadStatus = 'active' | 'resolved';

/** Which side of the diff a comment anchors to. */
export type DiffSide = 'left' | 'right';

export interface Comment {
  id: string;
  author: GitUserRef;
  body: string;
  createdAt: string;
  /** True when this comment originated locally and isn't synced to GitHub. */
  local?: boolean;
  /**
   * GraphQL node id — `PRRC_…` for a review comment, `IC_…` for an issue
   * comment. The only handle GitHub accepts for rewriting a body; read with the
   * conversation. A comment without one can be read but not edited.
   */
  nodeId?: string;
  /**
   * GitHub's own permalink for this comment (`…/pull/7#discussion_r123`). The
   * only source that is right by construction for the "open on GitHub" link, and
   * absent from a comment this app has only optimistically added.
   */
  htmlUrl?: string;
  /**
   * The hidden marker preamble that was stripped off `body` before display —
   * an out-of-diff anchor, or the parent of a Description reply (see
   * comments/github/anchorMarker.ts and comments/github/issueReplyMarker.ts).
   *
   * Kept because `body` is what the user sees and therefore what they edit, so
   * writing it back on its own would drop the marker and silently un-anchor the
   * comment or detach the reply from its parent.
   */
  bodyPrefix?: string;
}

export interface CommentThread {
  id: string;
  /** GitHub thread node ID (e.g. PRRT_kwDO…) for resolve/unresolve. */
  threadNodeId?: string;
  /** Stable PR key (owner/name#number) the thread belongs to. */
  prKey: string;
  filename: string;
  side: DiffSide;
  /** Anchor line number (in the side's file coordinate space). */
  line: number;
  /** Inclusive first line on the same side; absent for single-line threads. */
  startLine?: number;
  status: CommentThreadStatus;
  /**
   * True once GitHub considers the thread outdated — the code it was written
   * against has changed in a later iteration. `line` is then where the comment
   * *was* made, not where that code lives now, which is the whole reason we go
   * falling back to `originalLine` (see comments/github/threadParser.ts).
   */
  outdated?: boolean;
  comments: Comment[];
  createdAt: string;
  updatedAt: string;
  /** Commit SHA the thread was originally created against. */
  commitSha?: string;
  /** Iteration index the thread was first created against (for display). */
  iterationIndex?: number;
  /**
   * "Closed" review flag. GitHub has no closed state, so this is a
   * client-side overlay shared by everyone reviewing the PR (see
   * sharedClosed.ts). Orthogonal to `status`: a thread can be GitHub-active or
   * -resolved AND closed once a reviewer is satisfied with the resolution.
   */
  closed?: boolean;
  /** Who closed the thread, when `closed` is true and attribution is known. */
  closedBy?: ClosedEntry;
  /**
   * True for the PR-level "Description" conversation, which GitHub stores as
   * *issue* comments rather than review comments. They live in a different id
   * space and support neither `in_reply_to` nor resolve/unresolve, so replies
   * and status changes have to take a different route.
   */
  isIssueComment?: boolean;
}

/** Where comment threads are persisted. */
export type CommentBackend = 'github' | 'local';

/* ------------------------------- Feedback ------------------------------- */

/** What sort of feedback an issue is. */
export type IssueKind = 'bug' | 'idea' | 'question';

/**
 * Where an issue sits in the pipeline.
 *
 * `open` is the raised-but-untriaged default, `pending` means someone has picked
 * the work up and started, `blocked` means it has been triaged but can't be
 * finished yet, and `closed` is done. The three non-terminal states are what
 * {@link ACTIVE_ISSUE_STATUSES} calls active.
 *
 * `wontfix` is the other way an issue ends: decided against rather than done.
 * It is a *terminal* state, not a fourth live one — it files under Closed
 * everywhere the tracker groups by status, and deliberately has no tab of its
 * own. See {@link CLOSED_ISSUE_STATUSES}.
 */
export type IssueStatus = 'open' | 'pending' | 'blocked' | 'closed' | 'wontfix';

/**
 * A note/feedback item raised from inside the app, stored in the `feedback`
 * collection of app storage.
 */
export interface Issue {
  /** Server-assigned id, unique within the collection. */
  id: string;
  /** Concurrency token from storage; sent back on the next write. */
  version?: string;
  title: string;
  body: string;
  kind: IssueKind;
  status: IssueStatus;
  /** Stable id of the author. */
  authorId: string;
  /** Display login of the author, for attribution. */
  authorLogin?: string;
  authorName?: string;
  /** Who ended it, and when — set for `closed` and `wontfix` alike, cleared on reopen. */
  closedBy?: string;
  closedAt?: string;
  /** App version the issue was raised against. */
  appVersion?: string;
  createdAt: string;
  updatedAt: string;
}

/** The signed-in user, as far as the feedback tracker is concerned. */
export interface IssueViewer {
  /** Stable id, matched against {@link Issue.authorId}. */
  id: string;
  login?: string;
  name?: string;
}

/** The editable half of an issue — what a create/edit form produces. */
export interface IssueDraft {
  title: string;
  body: string;
  kind: IssueKind;
}

/**
 * What a comment on a feedback issue is for.
 *
 * `status` and `question` exist so an automated triage pass can leave a legible
 * trail — "picked this up", "shipped in v0.40.0" — and park something it needs a
 * human answer to, without that being mistaken for ordinary conversation.
 */
export type FeedbackCommentKind = 'comment' | 'status' | 'question';

/**
 * One reply on a feedback issue, stored in the `feedbackComments` collection.
 *
 * Named `FeedbackComment` rather than `IssueComment` on purpose: in this codebase
 * "issue comment" already means a GitHub *PR-level* comment (see
 * {@link CommentThread.isIssueComment}), which is an unrelated concept.
 */
export interface FeedbackComment {
  /** Server-assigned id, unique within the collection. */
  id: string;
  /** Concurrency token from storage; sent back on the next write. */
  version?: string;
  /** {@link Issue.id} this comment hangs off. */
  issueId: string;
  body: string;
  kind: FeedbackCommentKind;
  /** Stable id of the author. */
  authorId: string;
  authorLogin?: string;
  authorName?: string;
  createdAt: string;
  updatedAt: string;
}

/** The editable half of a comment — what the composer produces. */
export interface FeedbackCommentDraft {
  body: string;
  kind: FeedbackCommentKind;
}