import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SearchResults } from '../SearchResults';
import type { FileChange } from '../../../types';

vi.mock('../../../state/useCodeFlow', () => ({ useCodeFlow: vi.fn() }));

import { useCodeFlow } from '../../../state/useCodeFlow';
const mockUseCodeFlow = vi.mocked(useCodeFlow);

function file(filename: string, patch: string): FileChange {
  return { filename, status: 'modified', additions: 0, deletions: 0, changes: 0, patch };
}

const ALPHA = [
  '@@ -1,3 +1,3 @@',
  ' const alpha = 1;',
  '-const beta = needle();',
  '+const beta = NEEDLE();',
  ' const gamma = 3;',
].join('\n');

const BETA = ['@@ -10,2 +10,3 @@', ' untouched', '+another needle here'].join('\n');

const focusLine = vi.fn();

function mockCtx(over: Record<string, unknown> = {}) {
  mockUseCodeFlow.mockReturnValue({
    comparison: { files: [file('a.ts', ALPHA), file('b.ts', BETA)] },
    selectedFile: undefined,
    lineFocusRequest: undefined,
    actions: { focusLine },
    ...over,
  } as unknown as ReturnType<typeof useCodeFlow>);
}

function renderPanel(props: Partial<React.ComponentProps<typeof SearchResults>> = {}) {
  const onQuery = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <SearchResults
      query=""
      onQuery={onQuery}
      focusTick={0}
      onClose={onClose}
      {...props}
    />,
  );
  return { ...view, onQuery, onClose };
}

beforeEach(() => {
  focusLine.mockClear();
  mockCtx();
});

describe('SearchResults', () => {
  it('invites a search before one has been typed', () => {
    renderPanel();

    expect(screen.getByText(/Ctrl\+Shift\+F/)).toBeTruthy();
  });

  it('focuses and selects the input when the focus tick changes', () => {
    const { rerender, onQuery, onClose } = renderPanel({ query: 'needle' });
    const input = screen.getByLabelText('Search all files in the diff') as HTMLInputElement;
    input.blur();

    rerender(
      <SearchResults query="needle" onQuery={onQuery} focusTick={1} onClose={onClose} />,
    );

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('needle'.length);
  });

  it('lists every matching line, grouped by file', () => {
    const { container } = renderPanel({ query: 'needle' });

    const groups = container.querySelectorAll('.results__file');
    expect(groups).toHaveLength(2);
    expect(within(groups[0] as HTMLElement).getAllByRole('button')).toHaveLength(2);
    expect(within(groups[1] as HTMLElement).getAllByRole('button')).toHaveLength(1);
  });

  it('marks the matched text inside each line', () => {
    const { container } = renderPanel({ query: 'needle' });

    const marks = container.querySelectorAll('.results__hit mark');
    expect(marks).toHaveLength(3);
    expect(Array.from(marks).every((m) => m.textContent?.toLowerCase() === 'needle')).toBe(true);
  });

  it('jumps to a hit, addressed by side and line', () => {
    const { container } = renderPanel({ query: 'needle' });

    const hits = container.querySelectorAll('.results__hit');
    fireEvent.click(hits[0]);
    expect(focusLine).toHaveBeenCalledWith('a.ts', 'left', 2);

    fireEvent.click(hits[1]);
    expect(focusLine).toHaveBeenCalledWith('a.ts', 'right', 2);
  });

  it('marks the hit that was last jumped to', () => {
    mockCtx({ lineFocusRequest: { filename: 'a.ts', side: 'right', line: 2, seq: 1 } });
    const { container } = renderPanel({ query: 'needle' });

    const current = container.querySelectorAll('.results__hit--current');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain('NEEDLE');
  });

  it('says when nothing matches', () => {
    renderPanel({ query: 'haystack' });

    expect(screen.getByText(/No changed line matches/)).toBeTruthy();
  });

  it('reports an invalid regex rather than rendering nothing', () => {
    const { container } = renderPanel({ query: '(unclosed' });
    fireEvent.click(screen.getByLabelText('Use Regular Expression'));

    expect(container.querySelector('.results__empty--error')).toBeTruthy();
    expect(container.querySelector('.results__field--error')).toBeTruthy();
  });

  it('narrows results with match case, and remembers the toggle in settings', () => {
    const { container } = renderPanel({ query: 'NEEDLE' });
    expect(container.querySelectorAll('.results__hit')).toHaveLength(3);

    fireEvent.click(screen.getByLabelText('Match Case'));

    expect(container.querySelectorAll('.results__hit')).toHaveLength(1);
    expect(screen.getByLabelText('Match Case').getAttribute('aria-pressed')).toBe('true');
  });

  it('reports the query as the reviewer types', () => {
    const { onQuery } = renderPanel();

    fireEvent.change(screen.getByLabelText('Search all files in the diff'), {
      target: { value: 'needle' },
    });

    expect(onQuery).toHaveBeenCalledWith('needle');
  });

  it('closes on Escape', () => {
    const { onClose } = renderPanel({ query: 'needle' });

    fireEvent.keyDown(screen.getByLabelText('Search all files in the diff'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('survives a comparison that has not loaded', () => {
    mockCtx({ comparison: undefined });

    expect(() => renderPanel({ query: 'needle' })).not.toThrow();
    expect(screen.getByText(/No changed line matches/)).toBeTruthy();
  });
});
