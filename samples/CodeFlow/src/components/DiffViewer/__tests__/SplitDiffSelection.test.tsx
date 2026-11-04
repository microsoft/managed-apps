import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SplitDiff } from '../SplitDiff';
import { parsePatch } from '../../../utils/diffParser';

const PATCH = [
  '@@ -1,2 +1,2 @@',
  ' const alpha = 1;',
  '-const beta = alpha;',
  '+const beta = alpha + alpha;',
].join('\n');

function renderSplit() {
  const { container, unmount } = render(
    <SplitDiff
      diff={parsePatch(PATCH)}
      onStartComment={vi.fn()}
      extrasRow={() => null}
      threadBadges={() => null}
    />,
  );
  const handle = container.querySelector('.diff__splitter-handle') as HTMLElement;
  // jsdom has no pointer capture; the component calls it unconditionally.
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  return { container, handle, unmount };
}

/** True when the diff is still suppressing text selection app-wide. */
function selectionSuppressed(): boolean {
  const event = new Event('selectstart', { cancelable: true, bubbles: true });
  document.body.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
});

describe('SplitDiff — the splitter must not jam text selection', () => {
  it('suppresses selection only for the duration of the drag', () => {
    const { container, handle } = renderSplit();
    expect(selectionSuppressed()).toBe(false);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
    expect(selectionSuppressed()).toBe(true);

    fireEvent.pointerUp(container.querySelector('.diff__split-wrap') as HTMLElement, {
      pointerId: 1,
    });
    expect(selectionSuppressed()).toBe(false);
  });

  it('lets go when the pointer is cancelled instead of released', () => {
    const { handle } = renderSplit();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });

    // A cancelled pointer never reaches the wrapper as a pointerup, so before
    // the document backstop existed this left selection dead for good.
    fireEvent(document, new Event('pointercancel'));
    expect(selectionSuppressed()).toBe(false);
  });

  it('lets go when the drag ends outside the diff', () => {
    const { handle } = renderSplit();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });

    fireEvent(document, new Event('pointerup'));
    expect(selectionSuppressed()).toBe(false);
  });

  it('stops suppressing selection once the diff goes away mid-drag', () => {
    const { handle, unmount } = renderSplit();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });

    unmount();
    expect(selectionSuppressed()).toBe(false);
  });
});

describe('SplitDiff — the add-comment chip is not part of the code', () => {
  it('keeps the chip in the gutter so it cannot intercept a drag from the start of code', () => {
    const { container } = renderSplit();
    expect(container.querySelector('.diff__gutter .diff__addcomment')).not.toBeNull();
    expect(container.querySelector('.diff__half .diff__addcomment')).toBeNull();
  });
});
