import { describe, it, expect } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import { useDiffSearch } from '../useDiffSearch';
import type { SearchCell } from '../diffSearchModel';

const CELLS: SearchCell[] = [
  { column: 'inline', rowKey: '0-0', text: 'const foo = bar;' },
  { column: 'inline', rowKey: '0-1', text: 'foo(foo);' },
];

describe('useDiffSearch', () => {
  it('starts closed with no query and no matches', () => {
    const { result } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe('');
    expect(result.current.total).toBe(0);
    expect(result.current.activeOrdinal).toBe(0);
    expect(result.current.activeHitId).toBeNull();
  });

  it('counts every occurrence across cells', () => {
    const { result } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    act(() => result.current.setQuery('foo'));
    expect(result.current.total).toBe(3);
    expect(result.current.activeOrdinal).toBe(1);
    expect(result.current.activeHitId).toBe('inline:0-0:0');
  });

  it('navigates next/prev with wrap-around', () => {
    const { result } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    act(() => result.current.setQuery('foo'));

    act(() => result.current.next());
    expect(result.current.activeOrdinal).toBe(2);
    expect(result.current.activeHitId).toBe('inline:0-1:0');

    act(() => result.current.next());
    expect(result.current.activeOrdinal).toBe(3);
    expect(result.current.activeHitId).toBe('inline:0-1:1');

    // wrap forward
    act(() => result.current.next());
    expect(result.current.activeOrdinal).toBe(1);

    // wrap backward
    act(() => result.current.prev());
    expect(result.current.activeOrdinal).toBe(3);
  });

  it('resets the active match when the query changes', () => {
    const { result } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    act(() => result.current.setQuery('foo'));
    act(() => result.current.next());
    expect(result.current.activeOrdinal).toBe(2);

    act(() => result.current.setQuery('bar'));
    expect(result.current.total).toBe(1);
    expect(result.current.activeOrdinal).toBe(1);
  });

  it('respects the match-case toggle', () => {
    const cells: SearchCell[] = [{ column: 'inline', rowKey: '0-0', text: 'Foo foo FOO' }];
    const { result } = renderHook(() => useDiffSearch(cells, 'file.ts'));
    act(() => result.current.setQuery('foo'));
    expect(result.current.total).toBe(3);

    act(() => result.current.toggleOption('caseSensitive'));
    expect(result.current.total).toBe(1);
    expect(result.current.options.caseSensitive).toBe(true);
  });

  it('reports an error for an invalid regex', () => {
    const { result } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    act(() => result.current.toggleOption('regex'));
    act(() => result.current.setQuery('('));
    expect(result.current.error).not.toBeNull();
    expect(result.current.total).toBe(0);
  });

  it('highlights matches, flagging the active one', () => {
    const { result } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    act(() => result.current.setQuery('foo'));

    const { container } = render(
      <div>{result.current.highlight('inline', '0-1', 'foo(foo);')}</div>,
    );
    const marks = container.querySelectorAll('mark.diff__match');
    expect(marks).toHaveLength(2);
    // First cell owns the active hit, so neither mark here is active yet.
    expect(container.querySelectorAll('mark.diff__match--active')).toHaveLength(0);
  });

  it('marks the active hit inside its cell', () => {
    const { result } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    act(() => result.current.setQuery('foo'));
    act(() => result.current.next()); // active is inline:0-1:0

    const { container } = render(
      <div>{result.current.highlight('inline', '0-1', 'foo(foo);')}</div>,
    );
    const active = container.querySelectorAll('mark.diff__match--active');
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute('data-hit-id')).toBe('inline:0-1:0');
  });

  it('opens and closes', () => {
    const { result } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    act(() => result.current.openFind());
    expect(result.current.open).toBe(true);
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });

  it('openFind with an initialQuery pre-fills the query', () => {
    const { result } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    act(() => result.current.openFind('foo'));
    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe('foo');
    expect(result.current.total).toBe(3);
  });

  it('openFind without an argument does not clear an existing query', () => {
    const { result } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    act(() => result.current.setQuery('bar'));
    act(() => result.current.openFind());
    expect(result.current.query).toBe('bar');
  });

  it('openFind increments focusTick on every call', () => {
    const { result } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    const initial = result.current.focusTick;
    act(() => result.current.openFind());
    expect(result.current.focusTick).toBe(initial + 1);
    act(() => result.current.openFind('baz'));
    expect(result.current.focusTick).toBe(initial + 2);
  });

  it('persists toggle options', () => {
    const { result, unmount } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    act(() => result.current.toggleOption('wholeWord'));
    unmount();

    const { result: result2 } = renderHook(() => useDiffSearch(CELLS, 'file.ts'));
    expect(result2.current.options.wholeWord).toBe(true);
  });
});
