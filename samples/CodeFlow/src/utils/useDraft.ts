import { useCallback, useEffect, useRef, useState } from 'react';
import { clearDraft, pruneDrafts, readDraft, writeDraft } from './commentDrafts';

let swept = false;

/** Sweep aged-out drafts once per session, the first time one is opened. */
function sweepOnce(): void {
  if (swept) return;
  swept = true;
  pruneDrafts();
}

export type DraftSetter = (next: string | ((current: string) => string)) => void;

/**
 * Editor state for a composer, mirrored into storage so it survives a remount.
 *
 * Behaves exactly like `useState<string>` except that the text is written
 * through to localStorage under `key`, and read back from there when the
 * composer mounts. Pass `key = null` to opt out entirely — the hook then keeps
 * the value purely in memory, which is what happens before a pull request has
 * been identified.
 *
 * The returned `clear` is for the two moments a draft stops being wanted: the
 * comment was posted, or the reviewer cancelled. Simply emptying the box does
 * the same thing, since blank text is never stored.
 */
export function useDraft(
  key: string | null,
  initial = '',
): [string, DraftSetter, () => void] {
  const [value, setValue] = useState(() => {
    sweepOnce();
    return (key ? readDraft(key) : '') || initial;
  });

  // Re-read when the composer is repointed at a different draft without being
  // unmounted. `initial` is deliberately not what drives this: it is only the
  // fallback for a fresh draft, and reacting to it would fight the reviewer's
  // typing whenever the underlying comment changed under them.
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    setValue((key ? readDraft(key) : '') || initial);
  }, [key, initial]);

  const update = useCallback<DraftSetter>(
    (next) => {
      setValue((current) => {
        const text = typeof next === 'function' ? next(current) : next;
        // Writing from inside the updater keeps the stored copy in step with
        // the functional form, which the failure paths rely on to put text back
        // without reading a stale closure. Storing the same value twice under
        // StrictMode's double-invoke is harmless.
        writeDraft(key, text);
        return text;
      });
    },
    [key],
  );

  const clear = useCallback(() => {
    setValue('');
    clearDraft(key);
  }, [key]);

  return [value, update, clear];
}
