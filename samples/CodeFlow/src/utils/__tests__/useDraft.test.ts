import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDraft } from '../useDraft';
import { readDraft, writeDraft } from '../commentDrafts';
import { appStorage } from '../../storage';

const KEY = 'codeflow:draft:o/r#1|pr';
const OTHER = 'codeflow:draft:o/r#1|reply|t2';

describe('useDraft', () => {
    it('behaves like useState for the composer', () => {
    const { result } = renderHook(() => useDraft(KEY));
    expect(result.current[0]).toBe('');
    act(() => result.current[1]('typing'));
    expect(result.current[0]).toBe('typing');
  });

  it('brings the text back when the composer is mounted again', () => {
    // This is the whole point: the auto-refresh reload unmounts the review
    // tree, so plain component state is gone by the time the user looks up.
    const first = renderHook(() => useDraft(KEY));
    act(() => first.result.current[1]('half a sentence'));
    first.unmount();

    const second = renderHook(() => useDraft(KEY));
    expect(second.result.current[0]).toBe('half a sentence');
  });

  it('prefers a saved draft over the initial value', () => {
    writeDraft(KEY, 'my edit in progress');
    const { result } = renderHook(() => useDraft(KEY, 'the original comment'));
    expect(result.current[0]).toBe('my edit in progress');
  });

  it('falls back to the initial value when nothing was saved', () => {
    const { result } = renderHook(() => useDraft(KEY, 'the original comment'));
    expect(result.current[0]).toBe('the original comment');
  });

  it('forgets the draft when it is cleared', () => {
    const { result } = renderHook(() => useDraft(KEY));
    act(() => result.current[1]('posted this'));
    act(() => result.current[2]());

    expect(result.current[0]).toBe('');
    expect(readDraft(KEY)).toBe('');
  });

  it('persists text set through the updater form', () => {
    // The failure paths restore text this way, to avoid reading a stale value
    // out of a closure — the stored copy has to keep up with them.
    const { result } = renderHook(() => useDraft(KEY));
    act(() => result.current[1]('first'));
    act(() => result.current[1]((cur) => `${cur} then second`));

    expect(result.current[0]).toBe('first then second');
    expect(readDraft(KEY)).toBe('first then second');
  });

  it('re-reads when it is pointed at a different draft', () => {
    writeDraft(OTHER, 'the other thread');
    const { result, rerender } = renderHook(({ key }) => useDraft(key), {
      initialProps: { key: KEY },
    });
    act(() => result.current[1]('this thread'));

    rerender({ key: OTHER });
    expect(result.current[0]).toBe('the other thread');
    // …and the first draft is left intact for when it comes back.
    expect(readDraft(KEY)).toBe('this thread');
  });

  it('keeps the text in memory only when there is no key', () => {
    const { result } = renderHook(() => useDraft(null));
    act(() => result.current[1]('unsaved'));
    expect(result.current[0]).toBe('unsaved');
    expect(appStorage().drafts.keys()).toHaveLength(0);
  });
});
