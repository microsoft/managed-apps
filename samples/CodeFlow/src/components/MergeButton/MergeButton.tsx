import { useEffect, useRef, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import type { MergeMethod } from '../../types';
import { MERGE_METHODS, describeCheckWarning, evaluateMergeGate } from './mergeGate';

/**
 * The one irreversible button in the app.
 *
 * Only the pull request's author ever sees it — see {@link evaluateMergeGate} —
 * and pressing it opens a confirmation panel rather than merging outright,
 * because a misplaced click here can't be undone.
 *
 * Unmet required checks warn on that panel without disabling it. Optional
 * checks stay informational in the checks dialog; GitHub enforces merge rules.
 */
export function MergeButton() {
  const { pr, currentUser, checks, checksLoading, actions } = useCodeFlow();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [method, setMethod] = useState<MergeMethod>('merge');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Toasts outlive the click; if the PR is closed in between, don't set state
  // on an unmounted component.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
    };
  }, []);

  const gate = evaluateMergeGate({ pr, currentUser });
  if (!gate.visible) return null;

  const checkWarning = describeCheckWarning(checks, checksLoading);

  const flash = (type: 'success' | 'error', msg: string, ms: number) => {
    setResult({ type, msg });
    timers.current.push(setTimeout(() => setResult(null), ms));
  };

  const confirm = async () => {
    setOpen(false);
    setBusy(true);
    setResult(null);
    try {
      await actions.mergePr(method);
      flash('success', 'Merged', 6000);
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Merge failed', 8000);
    } finally {
      setBusy(false);
    }
  };

  const title = gate.ready
    ? 'Merge this pull request'
    : (gate.reason ?? 'This pull request cannot be merged yet');

  return (
    <>
      <button
        className="btn btn--sm btn--merge"
        disabled={!gate.ready || busy}
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {busy ? '⏳' : '⛙'} Merge
      </button>
      {result && (
        <span className={`topbar__review-toast topbar__review-toast--${result.type}`}>
          {result.msg}
        </span>
      )}
      {open && (
        <div className="merge-prompt" role="dialog" aria-label="Merge pull request">
          <p className="merge-prompt__lead">
            Merge <strong>{pr?.headRef}</strong> into <strong>{pr?.baseRef}</strong>?
          </p>
          {checkWarning && (
            <p className="merge-prompt__warning" role="status">
              ⚠ {checkWarning}
            </p>
          )}
          <div className="merge-prompt__methods">
            {MERGE_METHODS.map((m) => (
              <label key={m.value} className="merge-prompt__method">
                <input
                  type="radio"
                  name="merge-method"
                  value={m.value}
                  checked={method === m.value}
                  onChange={() => setMethod(m.value)}
                />
                <span className="merge-prompt__method-label">{m.label}</span>
                <span className="merge-prompt__method-hint">{m.hint}</span>
              </label>
            ))}
          </div>
          <p className="merge-prompt__note">
            This can’t be undone. The merge is pinned to the commit shown here, so it will be
            refused if someone pushes first.
          </p>
          <div className="merge-prompt__actions">
            <button className="btn btn--sm btn--merge" onClick={() => void confirm()}>
              Merge pull request
            </button>
            <button className="btn btn--sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
