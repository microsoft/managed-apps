import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { parsePatch } from '../../../utils/diffParser';
import { InlineDiff } from '../InlineDiff';
import { SplitDiff } from '../SplitDiff';

/**
 * These are the memoisation guarantees the large-file fix rests on.
 *
 * The budget in `fullFileBudget` keeps most long files from being expanded at
 * all, but a reviewer can still insist, and everything else in the viewer — the
 * splitter, the composer, a background poll — re-renders the table when it
 * changes. Without memoised rows, each of those pays for every line in the file.
 * The assertion is deliberately about *identity*: React skips a memoised
 * subtree only when the props compare equal, so a callback rebuilt each render
 * silently undoes the memo without failing anything else.
 */

/** A patch with several context lines, so there is something to re-render. */
const patch = [
  '@@ -1,6 +1,6 @@',
  ' const a = 1;',
  ' const b = 2;',
  '-const c = 3;',
  '+const c = 4;',
  ' const d = 5;',
  ' const e = 6;',
].join('\n');

afterEach(cleanup);

describe('diff rows are memoised', () => {
  it('re-renders no inline row when nothing a row depends on changed', () => {
    const diff = parsePatch(patch);
    const onStartComment = vi.fn();
    const threadBadges = vi.fn(() => null);
    const extrasRow = vi.fn(() => null);

    // `renderContent` is what a row calls to produce its text, so counting its
    // calls counts the rows that actually re-rendered.
    const renderContent = vi.fn((_c: string, _k: string, text: string) => text);

    const props = { diff, onStartComment, extrasRow, threadBadges, renderContent };
    const { rerender } = render(<InlineDiff {...props} />);

    const first = renderContent.mock.calls.length;
    expect(first).toBeGreaterThan(0);

    // Same props, same identities — every row should be skipped.
    rerender(<InlineDiff {...props} />);
    expect(renderContent.mock.calls.length).toBe(first);
  });

  it('re-renders every inline row when the content renderer changes', () => {
    const diff = parsePatch(patch);
    const shared = {
      diff,
      onStartComment: vi.fn(),
      extrasRow: vi.fn(() => null),
      threadBadges: vi.fn(() => null),
    };
    const one = vi.fn((_c: string, _k: string, text: string) => text);
    const { rerender } = render(<InlineDiff {...shared} renderContent={one} />);
    const rows = one.mock.calls.length;

    // A new highlighter — as a search does — must reach every row, or matches
    // below the fold would never light up.
    const two = vi.fn((_c: string, _k: string, text: string) => text);
    rerender(<InlineDiff {...shared} renderContent={two} />);
    expect(two.mock.calls.length).toBe(rows);
  });

  it('re-renders no split row when nothing a row depends on changed', () => {
    const diff = parsePatch(patch);
    const props = {
      diff,
      onStartComment: vi.fn(),
      extrasRow: vi.fn(() => null),
      threadBadges: vi.fn(() => null),
      renderContent: vi.fn((_c: string, _k: string, text: string) => text),
    };
    const { rerender } = render(<SplitDiff {...props} />);
    const first = props.renderContent.mock.calls.length;
    expect(first).toBeGreaterThan(0);

    rerender(<SplitDiff {...props} />);
    expect(props.renderContent.mock.calls.length).toBe(first);
  });
});
