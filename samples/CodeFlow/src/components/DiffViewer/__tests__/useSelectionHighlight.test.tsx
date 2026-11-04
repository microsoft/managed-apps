import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { RefObject } from 'react';
import { useSelectionHighlight } from '../useSelectionHighlight';
import type { SearchCell } from '../diffSearchModel';

const CELLS: SearchCell[] = [
  { column: 'inline', rowKey: '0-0', text: 'const value = compute(value);' },
  { column: 'inline', rowKey: '0-1', text: 'return valueOf(value);' },
];

/** A root the fake selection always reports as its container. */
function rootWithSelection(text: string | null) {
  const root = document.createElement('div');
  const node = document.createTextNode(text ?? '');
  root.appendChild(node);

  if (text !== null) {
    vi.spyOn(document, 'getSelection').mockReturnValue({
      isCollapsed: false,
      anchorNode: node,
      focusNode: node,
      toString: () => text,
    } as unknown as Selection);
  } else {
    vi.spyOn(document, 'getSelection').mockReturnValue(null);
  }

  const ref: RefObject<HTMLElement | null> = { current: root };
  return ref;
}

/** Nudge the hook the way the browser does after a drag. */
function selectionChanged() {
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

/** Dispatch a bare document event, the way a pointer or key does. */
function fire(type: string, init?: KeyboardEventInit) {
  act(() => {
    document.dispatchEvent(
      init ? new KeyboardEvent(type, init) : new Event(type),
    );
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSelectionHighlight', () => {
  it('highlights every occurrence of the selected word', () => {
    const ref = rootWithSelection('value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));
    selectionChanged();

    expect(result.current.active).toBe(true);
    expect(result.current.token).toBe('value');
    // Twice on the first line, once on the second — `valueOf` is not a match.
    expect(result.current.count).toBe(3);
    expect(result.current.marksFor('inline', '0-0')).toHaveLength(2);
    expect(result.current.marksFor('inline', '0-1')).toHaveLength(1);
  });

  it('marks carry the selection class and no hit id', () => {
    const ref = rootWithSelection('value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));
    selectionChanged();

    const [mark] = result.current.marksFor('inline', '0-0');
    expect(mark.className).toBe('diff__selmatch');
    expect(mark.hitId).toBeUndefined();
    expect(mark.start).toBe(6);
    expect(mark.end).toBe(11);
  });

  it('matches whole words only, so value does not light up valueOf', () => {
    const ref = rootWithSelection('value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));
    selectionChanged();

    const [mark] = result.current.marksFor('inline', '0-1');
    expect(mark.start).toBe(15);
  });

  it('is case-sensitive, because Item and item are different things', () => {
    const ref = rootWithSelection('Value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));
    selectionChanged();
    expect(result.current.active).toBe(false);
  });

  it('stays quiet when the word appears only once', () => {
    const ref = rootWithSelection('compute');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));
    selectionChanged();

    expect(result.current.active).toBe(false);
    expect(result.current.count).toBe(0);
    expect(result.current.marksFor('inline', '0-0')).toEqual([]);
  });

  it('ignores a selection that is not a single word', () => {
    const ref = rootWithSelection('const value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));
    selectionChanged();
    expect(result.current.active).toBe(false);
  });

  it('ignores a selection made outside the diff', () => {
    const ref = rootWithSelection('value');
    // Same selection, but the root no longer contains it.
    ref.current = document.createElement('div');

    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));
    selectionChanged();
    expect(result.current.active).toBe(false);
  });

  it('draws nothing while disabled, and picks up again when re-enabled', () => {
    const ref = rootWithSelection('value');
    const { result, rerender } = renderHook(
      ({ enabled }) => useSelectionHighlight(CELLS, enabled, ref),
      { initialProps: { enabled: false } },
    );
    selectionChanged();
    expect(result.current.active).toBe(false);

    rerender({ enabled: true });
    selectionChanged();
    expect(result.current.active).toBe(true);
  });

  it('clears the highlight when the selection collapses', () => {
    const ref = rootWithSelection('value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));
    selectionChanged();
    expect(result.current.active).toBe(true);

    vi.spyOn(document, 'getSelection').mockReturnValue({
      isCollapsed: true,
      anchorNode: null,
      focusNode: null,
      toString: () => '',
    } as unknown as Selection);
    selectionChanged();

    expect(result.current.active).toBe(false);
    expect(result.current.token).toBeNull();
  });

  it('keeps the token when the marks collapse the selection without an event', () => {
    // Drawing the highlight rewrites the text node the selection sits in, so the
    // browser quietly collapses it — no selectionchange, nothing selected. The
    // token has to survive that, because it is what Ctrl+F falls back on.
    const ref = rootWithSelection('value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));
    selectionChanged();
    expect(result.current.token).toBe('value');

    vi.spyOn(document, 'getSelection').mockReturnValue({
      isCollapsed: true,
      anchorNode: ref.current,
      focusNode: ref.current,
      toString: () => '',
    } as unknown as Selection);

    expect(result.current.token).toBe('value');
    expect(result.current.active).toBe(true);
  });

  it('re-reads the selection against the new cells after a file switch', () => {
    const ref = rootWithSelection('value');
    const { result, rerender } = renderHook(
      ({ cells }) => useSelectionHighlight(cells, true, ref),
      { initialProps: { cells: CELLS } },
    );
    selectionChanged();
    expect(result.current.count).toBe(3);

    rerender({ cells: [{ column: 'inline', rowKey: '0-0', text: 'value value' }] });
    expect(result.current.count).toBe(2);
  });

  it('stops listening once unmounted', () => {
    const ref = rootWithSelection('value');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useSelectionHighlight(CELLS, true, ref));
    unmount();
    expect(remove).toHaveBeenCalledWith('selectionchange', expect.any(Function));
  });
});

describe('useSelectionHighlight — while the selection is still being made', () => {
  // Drawing the marks rewrites the text node the selection is anchored in, and
  // the browser collapses the selection when that happens. Doing it mid-drag
  // therefore cuts the drag short: the reader keeps moving the mouse and only
  // the few characters selected before the first match lit up stay selected.
  it('waits for the mouse button to come up before highlighting', () => {
    const ref = rootWithSelection('value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));

    fire('pointerdown');
    selectionChanged();
    expect(result.current.active).toBe(false);
    expect(result.current.token).toBeNull();

    fire('pointerup');
    expect(result.current.active).toBe(true);
    expect(result.current.token).toBe('value');
  });

  it('picks the selection up again after a cancelled pointer', () => {
    const ref = rootWithSelection('value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));

    fire('pointerdown');
    selectionChanged();
    fire('pointercancel');
    expect(result.current.token).toBe('value');
  });

  it('waits for Shift to be released before highlighting', () => {
    const ref = rootWithSelection('value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));

    fire('keydown', { key: 'Shift' });
    selectionChanged();
    expect(result.current.active).toBe(false);

    fire('keyup', { key: 'Shift' });
    expect(result.current.token).toBe('value');
  });

  it('is not held up by keys that do not extend a selection', () => {
    const ref = rootWithSelection('value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));

    fire('keydown', { key: 'ArrowDown' });
    selectionChanged();
    expect(result.current.token).toBe('value');
  });

  it('leaves the highlight alone during a drag rather than clearing it', () => {
    const ref = rootWithSelection('value');
    const { result } = renderHook(() => useSelectionHighlight(CELLS, true, ref));
    selectionChanged();
    expect(result.current.token).toBe('value');

    // A fresh drag starts; the browser collapses the old selection on the way.
    fire('pointerdown');
    vi.spyOn(document, 'getSelection').mockReturnValue({
      isCollapsed: true,
      anchorNode: null,
      focusNode: null,
      toString: () => '',
    } as unknown as Selection);
    selectionChanged();
    // Still drawn — pulling the marks out now would rewrite the text under the
    // drag just as surely as putting them in.
    expect(result.current.token).toBe('value');

    fire('pointerup');
    expect(result.current.token).toBeNull();
  });
});
