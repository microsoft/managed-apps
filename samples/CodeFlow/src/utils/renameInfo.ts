/**
 * Works out what a "renamed" file really is, so the UI can say it out loud.
 *
 * A pure move is the one change that looks like *nothing* in a diff: GitHub
 * sends no patch, the additions and deletions are both zero, and the file list
 * shows the same basename it always did. The reviewer is left staring at an
 * empty pane with no clue that the file simply travelled to a new folder.
 *
 * GitHub reports the move as `status: 'renamed'` plus `previous_filename`, and
 * lumps three quite different edits under that one word — a file renamed in
 * place, a file moved to another directory, and one that did both. Reviewers
 * care about the difference, so name it here once and let every view share it.
 */
import type { FileChange } from '../types';

export type RenameKind = 'moved' | 'renamed' | 'moved-and-renamed';

export interface RenameInfo {
  kind: RenameKind;
  /** Path the file had before this change. */
  from: string;
  /** Path it has now. */
  to: string;
  /** Containing directory of each path; '' at the repository root. */
  fromDir: string;
  toDir: string;
  /** True when the path is the only thing that changed. */
  pathOnly: boolean;
  /** Sentence-case verb: "Moved", "Renamed", "Moved and renamed". */
  verb: string;
  /** Compact label for dense rows: "Moved", "Renamed", "Moved + renamed". */
  badge: string;
  /** Full one-liner, for tooltips and screen readers. */
  summary: string;
}

/** The part of a path before the last slash, or '' when there is none. */
function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

/** The part of a path after the last slash. */
function baseOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? path : path.slice(cut + 1);
}

const VERB: Record<RenameKind, string> = {
  moved: 'Moved',
  renamed: 'Renamed',
  'moved-and-renamed': 'Moved and renamed',
};

const BADGE: Record<RenameKind, string> = {
  moved: 'Moved',
  renamed: 'Renamed',
  'moved-and-renamed': 'Moved + renamed',
};

/** The fields of a FileChange this module actually reads. */
type RenameSource = Pick<
  FileChange,
  'filename' | 'previousFilename' | 'additions' | 'deletions' | 'changes'
>;

/**
 * Describe a file's path change, or `undefined` when the path did not change.
 *
 * Keyed on `previousFilename` differing rather than on `status === 'renamed'`:
 * the old path is the fact that matters, and a status of 'modified' alongside
 * one still means the file moved.
 */
export function getRenameInfo(file: RenameSource): RenameInfo | undefined {
  const from = file.previousFilename;
  const to = file.filename;
  if (!from || from === to) return undefined;

  const fromDir = dirOf(from);
  const toDir = dirOf(to);
  const changedDir = fromDir !== toDir;
  const changedName = baseOf(from) !== baseOf(to);

  const kind: RenameKind =
    changedDir && changedName ? 'moved-and-renamed' : changedDir ? 'moved' : 'renamed';

  // GitHub zeroes all three for a pure move. Check every one rather than
  // trusting `changes` alone, which some payloads omit.
  const pathOnly =
    (file.changes ?? 0) <= 0 && (file.additions ?? 0) <= 0 && (file.deletions ?? 0) <= 0;

  const verb = VERB[kind];
  const summary = pathOnly
    ? `${verb} from ${from} to ${to} — path change only, no content changes.`
    : `${verb} from ${from} to ${to}, and the contents changed too.`;

  return { kind, from, to, fromDir, toDir, pathOnly, verb, badge: BADGE[kind], summary };
}

/**
 * What to show in place of a diff that has no lines in it. A move with no
 * content is not a missing diff — there is genuinely nothing to render, and
 * saying so is more useful than blaming the file for being binary or too large.
 */
export function noDiffMessage(info: RenameInfo | undefined): string {
  return info?.pathOnly
    ? 'No content changes — only the file path changed.'
    : 'No textual diff available (binary, too large, or unchanged).';
}
