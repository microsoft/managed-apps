import type { FileChange, PrSummary } from '../../types';

/**
 * Everything about a cherry-pick that can be decided without talking to
 * GitHub: whether to offer it, what to call the new branch, which files to
 * touch, and what to warn about.
 *
 * Kept apart from `cherryPick.ts` because all of it is worth testing and none
 * of it needs a network.
 */

/** Whether the cherry-pick control should appear, and whether it can be used. */
export interface CherryPickGate {
  visible: boolean;
  ready: boolean;
  /** Why it can't be used yet, phrased for a tooltip. */
  reason?: string;
}

const HIDDEN: CherryPickGate = { visible: false, ready: false };

/**
 * Decide whether to offer a cherry-pick of this pull request.
 *
 * Deliberately open to everyone, which is the opposite of the merge gate.
 * Merging is the author's decision because it is irreversible; cherry-picking
 * writes a *new* branch and leaves the pull request exactly as it was, so the
 * worst outcome is a branch someone deletes. Release managers back-porting
 * other people's fixes are the main audience, and an author-only rule would
 * shut out precisely the people who need it.
 *
 * A draft is fine — its commits are real. What is not fine is a pull request
 * whose head commit we never learned, because there is then nothing to copy.
 */
export function evaluateCherryPickGate(pr?: PrSummary): CherryPickGate {
  if (!pr) return HIDDEN;
  if (!pr.headSha) {
    return {
      visible: true,
      ready: false,
      reason: 'This pull request’s head commit is still loading.',
    };
  }
  return { visible: true, ready: true };
}

/**
 * Reduce a string to something git will accept inside a ref name.
 *
 * Slashes survive, because a target branch is very often `release/1.0` and
 * flattening that to `release-1.0` makes the generated name harder to
 * recognise, not easier.
 */
export function slugifyRef(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/\.{2,}/g, '.');
  const trimmed = cleaned.replace(/^[-./]+/, '').replace(/[-./]+$/, '');
  return trimmed.slice(0, 60).replace(/[-./]+$/, '');
}

/** The branch name offered by default, e.g. `cherry-pick/pr-42-to-release/1.0`. */
export function suggestCherryPickBranch(pr: PrSummary, targetBranch: string): string {
  const target = slugifyRef(targetBranch) || 'branch';
  return `cherry-pick/pr-${pr.coordinates.number}-to-${target}`;
}

/**
 * Why git would reject this ref name, or `undefined` when it wouldn't.
 *
 * The rules are `git check-ref-format`'s, minus the ones a branch name cannot
 * hit. Checking here rather than letting the API refuse means the reviewer
 * finds out while they are still typing, and — more importantly — that we
 * never create half a cherry-pick before discovering the name was bad.
 */
export function validateBranchName(name: string): string | undefined {
  const value = name.trim();
  if (!value) return 'Give the new branch a name.';
  if (/\s/.test(value)) return 'Branch names can’t contain spaces.';
  if (/[~^:?*[\\]/.test(value)) return 'Branch names can’t contain ~ ^ : ? * [ or \\.';
  if (value.includes('..')) return 'Branch names can’t contain “..”.';
  if (value.includes('@{')) return 'Branch names can’t contain “@{”.';
  if (value.startsWith('/') || value.endsWith('/')) {
    return 'Branch names can’t start or end with “/”.';
  }
  if (value.includes('//')) return 'Branch names can’t contain an empty path segment.';
  if (value.endsWith('.') || value.endsWith('.lock')) {
    return 'Branch names can’t end with “.” or “.lock”.';
  }
  if (value.split('/').some((part) => part.startsWith('.'))) {
    return 'No part of a branch name may start with “.”.';
  }
  return undefined;
}

/** A file the cherry-pick could not carry across, and why. */
export interface SkippedFile {
  path: string;
  reason: string;
}

/**
 * The file-level work a cherry-pick amounts to.
 *
 * `writes` are paths that need content on the target; `deletes` are paths that
 * must disappear. A rename is both.
 */
export interface CherryPickPlan {
  writes: string[];
  deletes: string[];
  skipped: SkippedFile[];
}

/**
 * Turn a pull request's changed-file list into the writes and deletes needed
 * to reproduce it on another branch.
 *
 * `writes` are paths whose *final content* the cherry-pick has to determine —
 * not necessarily the pull request's version, since the target branch may have
 * moved on and the two then have to be merged. Working out that content is
 * `cherryPick.ts`'s job; this only decides which paths are in play.
 */
export function planCherryPick(files: readonly FileChange[]): CherryPickPlan {
  const writes: string[] = [];
  const deletes: string[] = [];
  const skipped: SkippedFile[] = [];

  for (const file of files) {
    switch (file.status) {
      case 'added':
      case 'modified':
      case 'changed':
      case 'copied':
        writes.push(file.filename);
        break;
      case 'renamed':
        writes.push(file.filename);
        if (file.previousFilename) deletes.push(file.previousFilename);
        break;
      case 'removed':
        deletes.push(file.filename);
        break;
      case 'unchanged':
        break;
      default:
        skipped.push({ path: file.filename, reason: 'unrecognised change type' });
    }
  }

  const written = new Set(writes);
  return {
    writes: [...written],
    // A path that is written can't also be deleted: a rename A→B whose old
    // path another entry reports as removed would otherwise cancel itself out.
    deletes: [...new Set(deletes)].filter((p) => !written.has(p)),
    skipped,
  };
}

/** Paths this cherry-pick would touch that have also moved on the target branch. */
export function overlappingPaths(
  plan: CherryPickPlan,
  changedOnTarget: readonly string[],
): string[] {
  const touched = new Set([...plan.writes, ...plan.deletes]);
  return [...new Set(changedOnTarget)].filter((p) => touched.has(p)).sort();
}

/**
 * What the confirmation panel should say about files that have moved on the
 * target branch, or `undefined` when there is nothing worth saying.
 *
 * This is information, not a warning: those files get a real three-way merge,
 * so divergence on its own costs nothing. What the reviewer is being told is
 * where a *conflict* could come from, and that finding one stops the whole
 * cherry-pick rather than half-applying it.
 */
export function describeOverlap(
  overlap: readonly string[],
  targetBranch: string,
): string | undefined {
  if (overlap.length === 0) return undefined;
  const n = overlap.length;
  const shown = overlap.slice(0, 3).join(', ');
  const rest = n > 3 ? `, and ${n - 3} more` : '';
  return `${n} file${n === 1 ? ' has' : 's have'} also changed on ${targetBranch} since this pull request branched (${shown}${rest}). They’ll be merged; if any of them conflict, nothing is written.`;
}

/**
 * Explain a refusal, listing what got in the way.
 *
 * Every one of these means nothing was written at all, so the message leads
 * with that: the reviewer's next question is always whether they have a mess to
 * clean up before retrying.
 */
export function describeRefusal(problems: readonly SkippedFile[]): string {
  if (problems.length === 0) return 'The cherry-pick could not be completed.';
  const lead =
    problems.length === 1
      ? 'This pull request can’t be cherry-picked cleanly, so nothing was changed.'
      : `This pull request can’t be cherry-picked cleanly (${problems.length} files), so nothing was changed.`;
  const listed = problems
    .slice(0, 5)
    .map((p) => `• ${p.path} — ${p.reason}`)
    .join('\n');
  const rest = problems.length > 5 ? `\n• …and ${problems.length - 5} more` : '';
  return `${lead}\n\n${listed}${rest}\n\nCherry-pick this one locally, where you can resolve the conflicts.`;
}

/** The commit message written onto the cherry-pick branch. */
export function cherryPickCommitMessage(pr: PrSummary): string {
  const short = pr.headSha.slice(0, 7);
  return `${pr.title}\n\nCherry-picked from #${pr.coordinates.number} (${short}).`;
}

const CHERRY_PICK_PREFIX = /^cherry[- ]pick:\s*/i;

/** The title offered for the follow-up pull request, without stuttering. */
export function cherryPickPrTitle(pr: PrSummary): string {
  return `Cherry-pick: ${pr.title.replace(CHERRY_PICK_PREFIX, '')}`;
}

/** The body of the follow-up pull request — short, and pointing back. */
export function cherryPickPrBody(pr: PrSummary, targetBranch: string): string {
  return `Cherry-pick of #${pr.coordinates.number} onto \`${targetBranch}\`.`;
}

/**
 * Branches worth offering as a target, most plausible first.
 *
 * The pull request's own base and head are dropped: cherry-picking a change
 * onto the branch it already lives on is never what anyone meant, and leaving
 * them in the list makes them the easiest thing to pick by accident.
 */
export function cherryPickTargets(branches: readonly string[], pr?: PrSummary): string[] {
  const base = pr?.baseRef;
  const head = pr?.headRef;
  return [...new Set(branches)].filter((b) => b !== base && b !== head).sort();
}
