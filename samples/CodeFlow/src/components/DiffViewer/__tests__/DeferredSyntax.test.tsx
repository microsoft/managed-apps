import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderCell } from '../renderCell';
import type { TokenRange } from '../../../utils/syntax/tokens';

const observers: TestObserver[] = [];

class TestObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin: string;
  readonly scrollMargin = '0px';
  readonly thresholds = [0];
  private callback: IntersectionObserverCallback;
  observe = vi.fn<(target: Element) => void>();
  unobserve = vi.fn<(target: Element) => void>();
  disconnect = vi.fn();
  takeRecords = () => [];

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.rootMargin = options?.rootMargin ?? '';
    observers.push(this);
  }

  emit(targets: Element[], isIntersecting: boolean) {
    this.callback(targets.map((target) => ({
      target, isIntersecting, time: 0, intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: new DOMRect(), intersectionRect: new DOMRect(), rootBounds: null,
    })), this);
  }
}

const tokens: TokenRange[] = [{ start: 0, end: 5, kind: 'keyword' }];
const text = 'const value = 1;';
const marks = [{ start: 6, end: 11, key: 'hit', className: 'diff__match', hitId: 'inline:0-1:0' }];

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', TestObserver);
});

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

describe('deferred syntax rendering', () => {
  it('keeps text and navigable marks offscreen, and adds/removes only syntax near the viewport', () => {
    const { container } = render(<div>{renderCell(text, marks, tokens, true)}</div>);
    const observer = observers[0];
    const target = observer.observe.mock.calls[0][0];
    expect(container.textContent).toBe(text);
    expect(container.querySelector('.tok')).toBeNull();
    expect(container.querySelector('[data-hit-id="inline:0-1:0"]')?.textContent).toBe('value');

    act(() => observer.emit([target], true));
    expect(container.querySelector('.tok--keyword')?.textContent).toBe('const');
    act(() => observer.emit([target], false));
    expect(container.querySelector('.tok')).toBeNull();
    expect(container.textContent).toBe(text);
    expect(container.querySelectorAll('[data-hit-id="inline:0-1:0"]')).toHaveLength(1);
  });

  it('shares one observer and bounds token spans as the visible rows change', () => {
    const { container, unmount } = render(
      <div>{Array.from({ length: 2501 }, (_, i) => <div key={i}>{renderCell(text, [], tokens, true)}</div>)}</div>,
    );
    expect(observers).toHaveLength(1);
    const observer = observers[0];
    const targets = observer.observe.mock.calls.map(([target]) => target);
    expect(targets).toHaveLength(2501);
    expect(container.querySelectorAll('.tok')).toHaveLength(0);
    act(() => observer.emit(targets.slice(0, 40), true));
    expect(container.querySelectorAll('.tok')).toHaveLength(40);
    act(() => {
      observer.emit(targets.slice(0, 40), false);
      observer.emit(targets.slice(-40), true);
    });
    expect(container.querySelectorAll('.tok')).toHaveLength(40);
    expect(targets.at(-1)?.querySelector('.tok--keyword')?.textContent).toBe('const');
    expect(container.textContent).toBe(text.repeat(2501));
    unmount();
    expect(observer.unobserve).toHaveBeenCalledTimes(2501);
    expect(observer.disconnect).toHaveBeenCalledOnce();

    // A late delivery from a disconnected observer must not update retired cells.
    act(() => observer.emit(targets, true));
  });

  it.each([false, true])('does not rewrite a multi-cell selection when visibility becomes %s', (visible) => {
    const { container } = render(
      <div>{renderCell(text, [], tokens, true)}{renderCell(text, [], tokens, true)}</div>,
    );
    const observer = observers[0];
    const targets = observer.observe.mock.calls.map(([target]) => target);
    act(() => observer.emit(targets, !visible));
    const range = document.createRange();
    range.setStart(targets[0], 0);
    range.setEnd(targets[1], targets[1].childNodes.length);
    const selection = document.getSelection()!;
    selection.addRange(range);
    expect(selection.toString()).toBe(text.repeat(2));

    act(() => observer.emit(targets, visible));
    expect(selection.toString()).toBe(text.repeat(2));
    expect(container.querySelectorAll('.tok')).toHaveLength(visible ? 0 : 2);
    act(() => {
      selection.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(container.querySelectorAll('.tok')).toHaveLength(visible ? 2 : 0);
  });

  it('keeps eager cells and cells without tokens out of the observer', () => {
    const { container } = render(
      <div>{renderCell(text, [], tokens)}{renderCell(text, marks, [], true)}</div>,
    );
    expect(container.querySelectorAll('.tok')).toHaveLength(1);
    expect(observers).toHaveLength(0);
  });

  it('renders tokens eagerly when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<div>{renderCell(text, [], tokens, true)}</div>);
    expect(container.querySelector('.tok--keyword')?.textContent).toBe('const');
  });
});
