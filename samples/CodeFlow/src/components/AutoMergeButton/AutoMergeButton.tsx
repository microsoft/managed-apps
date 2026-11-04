import { useEffect, useRef, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import type { MergeMethod } from '../../types';
import { MERGE_METHODS } from '../MergeButton/mergeGate';
import { describeAutoMerge, evaluateAutoMergeGate } from './autoMergeGate';

/**
 * "Auto-merge" — hand the pull request to GitHub to land on the author's
 * behalf once its requirements are met.
 *
 * The counterpart to the merge button next door, and the answer to the case it
 * can't serve: a pull request that is approved and simply waiting on a long CI
 * run. Without this the author either sits on the tab until the checks go
 * green or leaves for GitHub to press the same button there.
 *
 * Arming it asks first, because it is a standing instruction to merge code
 * that may not be written yet. Disarming it doesn't — cancelling something
 * that hasn't happened costs nothing, and a confirmation would only stand
 * between the author and calling it off.
 */
export function AutoMergeButton() {
  const { pr, currentUser, autoMerge, autoMergeLoading, actions } = useCodeFlow();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<MergeMethod>('merge');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const gate = evaluateAutoMergeGate({ pr, currentUser, autoMerge, autoMergeLoading });
  if (!gate.visible) return null;

  const armed = !!autoMerge?.enabled;

  const flashError = (e: unknown, fallback: string) => {
    setError(e instanceof Error ? e.message : fallback);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setError(null), 8000);
  };

  const arm = async () => {
    setOpen(false);
    setBusy(true);
    setError(null);
    try {
      await actions.enableAutoMerge(method);
    } catch (e) {
      flashError(e, 'Could not enable auto-merge.');
    } finally {
      setBusy(false);
    }
  };

  const disarm = async () => {
    setOpen(false);
    setBusy(true);
    setError(null);
    try {
      await actions.disableAutoMerge();
    } catch (e) {
      flashError(e, 'Could not turn auto-merge off.');
    } finally {
      setBusy(false);
    }
  };

  // Armed is a state, not a prompt: the button says what pressing it does, and
  // the summary of what is pending sits on the panel behind it.
  const label = armed ? 'Auto-merge on' : 'Auto-merge';
  const title = armed
    ? (describeAutoMerge(autoMerge) ?? 'Auto-merge is on for this pull request')
    : (gate.reason ?? 'Merge this pull request automatically once it is ready');

  return (
    <>
      <button
        className={`btn btn--sm btn--automerge${armed ? ' btn--automerge-on' : ''}`}
        disabled={!gate.ready || busy}
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={armed}
      >
        {busy ? '⏳' : '⏱'} {label}
      </button>
      {error && <span className="topbar__review-toast topbar__review-toast--error">{error}</span>}
      {open && armed && (
        <div className="merge-prompt" role="dialog" aria-label="Auto-merge">
          <p className="merge-prompt__lead">{describeAutoMerge(autoMerge)}</p>
          <div className="merge-prompt__actions">
            <button className="btn btn--sm" onClick={() => void disarm()}>
              Turn auto-merge off
            </button>
            <button className="btn btn--sm" onClick={() => setOpen(false)}>
              Keep it on
            </button>
          </div>
        </div>
      )}
      {open && !armed && (
        <div className="merge-prompt" role="dialog" aria-label="Enable auto-merge">
          <p className="merge-prompt__lead">
            Merge <strong>{pr?.headRef}</strong> into <strong>{pr?.baseRef}</strong> as soon as it
            is ready?
          </p>
          <div className="merge-prompt__methods">
            {MERGE_METHODS.map((m) => (
              <label key={m.value} className="merge-prompt__method">
                <input
                  type="radio"
                  name="auto-merge-method"
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
            GitHub merges it once every required review and check passes — including commits pushed
            after this. Turn it off from here or from GitHub at any point before then.
          </p>
          <div className="merge-prompt__actions">
            <button className="btn btn--sm btn--automerge-go" onClick={() => void arm()}>
              Enable auto-merge
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
