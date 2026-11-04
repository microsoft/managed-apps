import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffSearchBox } from '../DiffSearchBox';
import type { DiffSearch } from '../useDiffSearch';

function makeSearch(overrides: Partial<DiffSearch> = {}): DiffSearch {
  return {
    open: true,
    query: '',
    options: { caseSensitive: false, wholeWord: false, regex: false },
    total: 0,
    activeOrdinal: 0,
    activeHitId: null,
    error: null,
    capped: false,
    focusTick: 0,
    setQuery: vi.fn(),
    toggleOption: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    openFind: vi.fn(),
    close: vi.fn(),
    marksFor: vi.fn(() => []),
    highlight: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DiffSearchBox', () => {
  it('shows "N of M" when there are matches', () => {
    render(<DiffSearchBox search={makeSearch({ query: 'foo', total: 5, activeOrdinal: 2 })} />);
    expect(screen.getByText('2 of 5')).toBeInTheDocument();
  });

  it('appends a + when results are capped', () => {
    render(<DiffSearchBox search={makeSearch({ query: 'x', total: 5000, activeOrdinal: 1, capped: true })} />);
    expect(screen.getByText('1 of 5000+')).toBeInTheDocument();
  });

  it('shows "No results" for a non-empty query with no matches', () => {
    render(<DiffSearchBox search={makeSearch({ query: 'zzz', total: 0 })} />);
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('shows "Invalid regex" when the query is a bad pattern', () => {
    render(<DiffSearchBox search={makeSearch({ query: '(', total: 0, error: 'bad' })} />);
    expect(screen.getByText('Invalid regex')).toBeInTheDocument();
  });

  it('renders no count label for an empty query', () => {
    const { container } = render(<DiffSearchBox search={makeSearch({ query: '' })} />);
    expect(container.querySelector('.diff__search-count')?.textContent).toBe('');
  });

  it('calls setQuery on input change', () => {
    const search = makeSearch();
    render(<DiffSearchBox search={search} />);
    fireEvent.change(screen.getByLabelText('Find in file'), { target: { value: 'abc' } });
    expect(search.setQuery).toHaveBeenCalledWith('abc');
  });

  it('toggles each option', () => {
    const search = makeSearch();
    render(<DiffSearchBox search={search} />);
    screen.getByLabelText('Match Case').click();
    screen.getByLabelText('Match Whole Word').click();
    screen.getByLabelText('Use Regular Expression').click();
    expect(search.toggleOption).toHaveBeenNthCalledWith(1, 'caseSensitive');
    expect(search.toggleOption).toHaveBeenNthCalledWith(2, 'wholeWord');
    expect(search.toggleOption).toHaveBeenNthCalledWith(3, 'regex');
  });

  it('reflects active toggles via aria-pressed', () => {
    render(<DiffSearchBox search={makeSearch({ options: { caseSensitive: true, wholeWord: false, regex: true } })} />);
    expect(screen.getByLabelText('Match Case')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Match Whole Word')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Use Regular Expression')).toHaveAttribute('aria-pressed', 'true');
  });

  it('invokes prev/next/close from the nav buttons', () => {
    const search = makeSearch({ query: 'foo', total: 3, activeOrdinal: 1 });
    render(<DiffSearchBox search={search} />);
    screen.getByLabelText('Previous match').click();
    screen.getByLabelText('Next match').click();
    screen.getByLabelText('Close find').click();
    expect(search.prev).toHaveBeenCalledOnce();
    expect(search.next).toHaveBeenCalledOnce();
    expect(search.close).toHaveBeenCalledOnce();
  });

  it('disables prev/next when there are no matches', () => {
    render(<DiffSearchBox search={makeSearch({ query: 'zzz', total: 0 })} />);
    expect(screen.getByLabelText('Previous match')).toBeDisabled();
    expect(screen.getByLabelText('Next match')).toBeDisabled();
  });

  it('handles Enter, Shift+Enter and Escape keys', () => {
    const search = makeSearch({ query: 'foo', total: 3, activeOrdinal: 1 });
    render(<DiffSearchBox search={search} />);
    const input = screen.getByLabelText('Find in file');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(search.next).toHaveBeenCalledOnce();

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(search.prev).toHaveBeenCalledOnce();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(search.close).toHaveBeenCalledOnce();
  });
});
