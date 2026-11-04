import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SplitDiff } from '../SplitDiff';
import { parsePatch } from '../../../utils/diffParser';
import { filterDiffToSide, type DiffSideMode } from '../../../utils/diffSide';

const PATCH = [
  '@@ -1,3 +1,3 @@',
  ' const alpha = 1;',
  '-const beta = alpha;',
  '+const beta = alpha + alpha;',
  ' const gamma = 3;',
].join('\n');

/** Render the split view exactly as DiffViewer does: filter first, then draw. */
function renderSide(sideMode: DiffSideMode) {
  const diff = filterDiffToSide(parsePatch(PATCH), sideMode);
  const { container } = render(
    <SplitDiff
      diff={diff}
      onStartComment={vi.fn()}
      extrasRow={() => null}
      threadBadges={() => null}
      sideMode={sideMode}
    />,
  );
  return container;
}

/** Cell text with the hover "add comment" button stripped out. */
const text = (container: HTMLElement, selector: string) =>
  Array.from(container.querySelectorAll(selector)).map((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.diff__addcomment').forEach((btn) => btn.remove());
    return clone.textContent;
  });

describe('SplitDiff — both sides', () => {
  it('renders both panes, the splitter column and the drag handle', () => {
    const c = renderSide('both');
    expect(c.querySelectorAll('.diff__half--left').length).toBeGreaterThan(0);
    expect(c.querySelectorAll('.diff__half--right').length).toBeGreaterThan(0);
    expect(c.querySelectorAll('.diff__splitter-col').length).toBeGreaterThan(0);
    expect(c.querySelector('.diff__splitter-handle')).not.toBeNull();
    expect(c.querySelectorAll('colgroup col')).toHaveLength(5);
  });

  it('spans hunk headers across every column', () => {
    const c = renderSide('both');
    expect(c.querySelector('.diff__hunkhead')?.getAttribute('colspan')).toBe('5');
  });
});

describe('SplitDiff — left only', () => {
  it('drops the right pane, its gutter, the splitter and the handle', () => {
    const c = renderSide('left');
    expect(c.querySelectorAll('.diff__half--right')).toHaveLength(0);
    expect(c.querySelectorAll('.diff__gutter--new')).toHaveLength(0);
    expect(c.querySelectorAll('.diff__splitter-col')).toHaveLength(0);
    expect(c.querySelector('.diff__splitter-handle')).toBeNull();
    expect(c.querySelectorAll('colgroup col')).toHaveLength(2);
  });

  it('shows the original lines and no additions', () => {
    const c = renderSide('left');
    const cells = text(c, '.diff__half--left');
    expect(cells).toContain('const beta = alpha;');
    expect(cells).not.toContain('const beta = alpha + alpha;');
  });

  it('narrows the hunk header colspan to the visible columns', () => {
    const c = renderSide('left');
    expect(c.querySelector('.diff__hunkhead')?.getAttribute('colspan')).toBe('2');
  });
});

describe('SplitDiff — right only', () => {
  it('drops the left pane, its gutter and the splitter', () => {
    const c = renderSide('right');
    expect(c.querySelectorAll('.diff__half--left')).toHaveLength(0);
    expect(c.querySelectorAll('.diff__gutter--old')).toHaveLength(0);
    expect(c.querySelectorAll('.diff__splitter-col')).toHaveLength(0);
    expect(c.querySelectorAll('colgroup col')).toHaveLength(2);
  });

  it('shows the updated lines and no deletions', () => {
    const c = renderSide('right');
    const cells = text(c, '.diff__half--right');
    expect(cells).toContain('const beta = alpha + alpha;');
    expect(cells).not.toContain('const beta = alpha;');
  });

  it('leaves no blank rows where the deletions used to be', () => {
    const c = renderSide('right');
    // 2 context rows + 1 addition — the lone deletion must not leave a gap.
    expect(c.querySelectorAll('.diff__splitrow')).toHaveLength(3);
  });
});

describe('SplitDiff — comment plumbing on one side', () => {
  it('only renders extras for the visible side', () => {
    const diff = filterDiffToSide(parsePatch(PATCH), 'right');
    const extrasRow = vi.fn(() => null);
    render(
      <SplitDiff
        diff={diff}
        onStartComment={vi.fn()}
        extrasRow={extrasRow}
        threadBadges={() => null}
        sideMode="right"
      />,
    );
    const keys = extrasRow.mock.calls.map((call) => (call as unknown as [unknown, number, string])[2]);
    expect(keys.every((k) => k.startsWith('r-'))).toBe(true);
    // ...and the colSpan matches the two rendered columns.
    const spans = extrasRow.mock.calls.map((call) => (call as unknown as [unknown, number, string])[1]);
    expect(new Set(spans)).toEqual(new Set([2]));
  });
});
