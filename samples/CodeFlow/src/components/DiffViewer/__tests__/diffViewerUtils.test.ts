import { describe, it, expect, vi, afterEach } from 'vitest';
import { anchorKey, lineAnchor, scrollThreadIntoView } from '../diffViewerUtils';
import type { DiffLine } from '../../../types';

describe('anchorKey', () => {
  it('creates deterministic key from side and line', () => {
    expect(anchorKey('left', 42)).toBe('left:42');
    expect(anchorKey('right', 1)).toBe('right:1');
  });
});

describe('lineAnchor', () => {
  it('returns right anchor for add lines', () => {
    const line: DiffLine = { type: 'add', newLineNo: 10, content: 'added' };
    expect(lineAnchor(line)).toEqual({ side: 'right', line: 10 });
  });

  it('returns left anchor for del lines', () => {
    const line: DiffLine = { type: 'del', oldLineNo: 5, content: 'deleted' };
    expect(lineAnchor(line)).toEqual({ side: 'left', line: 5 });
  });

  it('returns right anchor for context lines (prefers new side)', () => {
    const line: DiffLine = { type: 'context', oldLineNo: 3, newLineNo: 4, content: 'ctx' };
    expect(lineAnchor(line)).toEqual({ side: 'right', line: 4 });
  });

  it('returns null for hunk header lines', () => {
    const line: DiffLine = { type: 'hunk', content: '@@ -1,3 +1,4 @@' };
    expect(lineAnchor(line)).toBeNull();
  });

  it('returns null for meta lines', () => {
    const line: DiffLine = { type: 'meta', content: 'No newline at end of file' };
    expect(lineAnchor(line)).toBeNull();
  });

  it('returns null for del lines without oldLineNo', () => {
    const line: DiffLine = { type: 'del', content: 'orphan' };
    expect(lineAnchor(line)).toBeNull();
  });
});

describe('scrollThreadIntoView', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    // Remove the stub we added (jsdom has no native scrollIntoView).
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('returns false when no matching element exists', () => {
    expect(scrollThreadIntoView('missing')).toBe(false);
  });

  it('scrolls the matching element into view and flashes it', () => {
    vi.useFakeTimers();
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const el = document.createElement('div');
    el.setAttribute('data-thread-id', 'thread-42');
    document.body.appendChild(el);

    const found = scrollThreadIntoView('thread-42');

    expect(found).toBe(true);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(el.classList.contains('thread--flash')).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(el.classList.contains('thread--flash')).toBe(false);
    vi.useRealTimers();
  });

  it('escapes ids that contain selector-special characters', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const el = document.createElement('div');
    const trickyId = 'owner/repo#1:"quoted"';
    el.setAttribute('data-thread-id', trickyId);
    document.body.appendChild(el);

    expect(scrollThreadIntoView(trickyId)).toBe(true);
  });
});
