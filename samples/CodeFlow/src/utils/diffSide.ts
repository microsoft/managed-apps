/**
 * "Which side of the diff am I reading" filter.
 *
 * `both` is the classic two-sided diff. `left` shows the file as it was
 * (context + deletions) and `right` shows the file as it will be (context +
 * additions), so a reviewer can read one version top-to-bottom without the
 * other version's lines interleaved.
 *
 * The filter is applied to the parsed diff itself rather than at render time,
 * so everything downstream — find-in-file, change-block navigation, the
 * scrollbar minimap and orphaned-comment detection — sees exactly what the
 * reviewer sees. A comment anchored to a hidden side simply drops out of the
 * diff and is picked up by the existing orphaned-threads list.
 */
import type { DiffLineType, ParsedDiff } from '../types';

export type DiffSideMode = 'both' | 'left' | 'right';

/** Cycle order of the header's side toggle. */
export const DIFF_SIDE_MODES: readonly DiffSideMode[] = ['both', 'left', 'right'];

export const DEFAULT_DIFF_SIDE: DiffSideMode = 'both';

export function isDiffSideMode(value: unknown): value is DiffSideMode {
  return value === 'both' || value === 'left' || value === 'right';
}

/** Next mode in the toggle's cycle: both → left → right → both. */
export function nextDiffSideMode(mode: DiffSideMode): DiffSideMode {
  const i = DIFF_SIDE_MODES.indexOf(mode);
  return DIFF_SIDE_MODES[(i + 1) % DIFF_SIDE_MODES.length];
}

const SIDE_LABELS: Record<DiffSideMode, string> = {
  both: 'Both sides',
  left: 'Left only',
  right: 'Right only',
};

/** Button label for a side mode. */
export function diffSideLabel(mode: DiffSideMode): string {
  return SIDE_LABELS[mode];
}

const SIDE_TITLES: Record<DiffSideMode, string> = {
  both: 'Showing both sides — click to show only the left (original) side',
  left: 'Showing the left (original) side only — click to show only the right (updated) side',
  right: 'Showing the right (updated) side only — click to show both sides',
};

/** Tooltip explaining the current side mode and what clicking does next. */
export function diffSideTitle(mode: DiffSideMode): string {
  return SIDE_TITLES[mode];
}

function isContentLine(type: DiffLineType): boolean {
  return type === 'add' || type === 'del' || type === 'context';
}

/**
 * Drop the lines belonging to the side the reviewer has hidden. Hunks left
 * without any content line are removed so the view doesn't show a lone header.
 */
export function filterDiffToSide(diff: ParsedDiff, mode: DiffSideMode): ParsedDiff {
  if (mode === 'both') return diff;
  const dropped: DiffLineType = mode === 'left' ? 'add' : 'del';
  const hunks = diff.hunks
    .map((hunk) => ({ ...hunk, lines: hunk.lines.filter((line) => line.type !== dropped) }))
    .filter((hunk) => hunk.lines.some((line) => isContentLine(line.type)));
  return { hunks, isEmpty: hunks.length === 0 };
}

/**
 * Explain an empty view caused by the side filter (e.g. asking for the left
 * side of a newly-added file). Returns null when the emptiness has some other
 * cause, so the caller can fall back to its usual "no patch" message.
 */
export function sideFilterEmptyMessage(
  mode: DiffSideMode,
  filteredIsEmpty: boolean,
  unfilteredIsEmpty: boolean,
): string | null {
  if (mode === 'both' || !filteredIsEmpty || unfilteredIsEmpty) return null;
  return mode === 'left'
    ? 'Nothing to show on the left — this file has no original content in this diff.'
    : 'Nothing to show on the right — this file has no updated content in this diff.';
}
