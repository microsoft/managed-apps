import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { renderCell } from '../renderCell';
import type { MarkRange } from '../cellLayers';
import type { TokenRange } from '../../../utils/syntax/tokens';

function draw(text: string, marks: MarkRange[] = [], tokens: TokenRange[] = []) {
  return render(<div data-testid="cell">{renderCell(text, marks, tokens)}</div>).getByTestId('cell');
}

const hit: MarkRange = { start: 6, end: 11, key: 'h1', className: 'diff__match', hitId: 'inline:0-1:0' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderCell', () => {
  it('renders a non-breaking space for an empty line, so the row keeps its height', () => {
    expect(draw('').textContent).toBe('\u00a0');
  });

  it('returns bare text when there is nothing to draw', () => {
    const cell = draw('const x = 1;');
    expect(cell.textContent).toBe('const x = 1;');
    expect(cell.querySelectorAll('span, mark')).toHaveLength(0);
  });

  it('wraps tokens in a class-bearing span', () => {
    const cell = draw('const x', [], [{ start: 0, end: 5, kind: 'keyword' }]);
    const span = cell.querySelector('span')!;
    expect(span.className).toBe('tok tok--keyword');
    expect(span.textContent).toBe('const');
    expect(cell.textContent).toBe('const x');
  });

  it('keeps a find hit as exactly one element carrying its id', () => {
    // Diff navigation looks this element up by id and scrolls to it, so a hit
    // split across two <mark>s would duplicate the id and break Next/Prev.
    const cell = draw('const value = 1;', [hit], [{ start: 0, end: 16, kind: 'string' }]);
    const marks = cell.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute('data-hit-id')).toBe('inline:0-1:0');
    expect(marks[0].textContent).toBe('value');
  });

  it('nests tokens inside marks rather than beside them', () => {
    const cell = draw('const value = 1;', [hit], [{ start: 0, end: 16, kind: 'string' }]);
    expect(cell.querySelector('mark > span.tok--string')).not.toBeNull();
  });

  it('omits data-hit-id for word-diff marks, which nothing navigates to', () => {
    const cell = draw('abcdef', [{ start: 1, end: 3, key: 'wd-1', className: 'diff__word-change' }]);
    const mark = cell.querySelector('mark')!;
    expect(mark.hasAttribute('data-hit-id')).toBe(false);
    expect(mark.className).toBe('diff__word-change');
  });

  it('preserves the full text no matter how it is carved up', () => {
    const text = 'if (ready) { return compute(a, b); }';
    const cell = draw(
      text,
      [{ start: 4, end: 9, key: 'h', className: 'diff__match' }],
      [
        { start: 0, end: 2, kind: 'keyword' },
        { start: 3, end: 10, kind: 'variable' },
        { start: 20, end: 27, kind: 'function' },
      ],
    );
    expect(cell.textContent).toBe(text);
  });

  it('renders without React key warnings', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    draw(
      'alpha beta gamma',
      [
        { start: 0, end: 5, key: 'a', className: 'diff__match' },
        { start: 6, end: 10, key: 'b', className: 'diff__match' },
      ],
      [
        { start: 0, end: 5, kind: 'string' },
        { start: 6, end: 16, kind: 'number' },
      ],
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
