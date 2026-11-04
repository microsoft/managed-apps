import { describe, it, expect, vi, afterEach } from 'vitest';
import { scrollDiffPaneToTop } from '../diffPane';

/** Build the scrolling pane the diff lives inside, with `scrollTo` spied on. */
function makePane(): { pane: HTMLElement; scrollTo: ReturnType<typeof vi.fn> } {
  const pane = document.createElement('div');
  pane.className = 'workarea__center';
  const scrollTo = vi.fn();
  // jsdom has no layout, so it implements neither scrollTo nor a real scrollTop.
  (pane as unknown as { scrollTo: unknown }).scrollTo = scrollTo;
  document.body.appendChild(pane);
  return { pane, scrollTo };
}

describe('scrollDiffPaneToTop', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('returns false when the pane is not on the page', () => {
    expect(scrollDiffPaneToTop()).toBe(false);
  });

  it('scrolls the pane back to the top', () => {
    const { scrollTo } = makePane();

    expect(scrollDiffPaneToTop()).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it('leaves the horizontal offset alone', () => {
    const { scrollTo } = makePane();

    scrollDiffPaneToTop();

    // Omitting `left` is what keeps a horizontally scrolled diff where it was.
    expect(scrollTo.mock.calls[0][0]).not.toHaveProperty('left');
  });

  it('falls back to scrollTop where scrollTo is unavailable', () => {
    const pane = document.createElement('div');
    pane.className = 'workarea__center';
    Object.defineProperty(pane, 'scrollTo', { value: undefined, configurable: true });
    let scrollTop = 900;
    Object.defineProperty(pane, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => { scrollTop = v; },
    });
    document.body.appendChild(pane);

    expect(scrollDiffPaneToTop()).toBe(true);
    expect(scrollTop).toBe(0);
  });
});
