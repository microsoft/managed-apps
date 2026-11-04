import { useEffect, useRef, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { evaluatePublishGate } from './publishGate';

/**
 * "Publish" — take the author's own pull request out of draft.
 *
 * The one action a draft affords, and until now the one thing that sent an
 * author back to GitHub mid-review. It is deliberately a single click with no
 * confirmation step: publishing is reversible from GitHub's own UI, so a
 * misclick costs nothing, and a dialog would be more ceremony than the change
 * deserves.
 *
 * Renders nothing at all unless {@link evaluatePublishGate} says this is the
 * author's draft to publish.
 */
export function PublishDraftButton() {
  const { pr, currentUser, actions } = useCodeFlow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const gate = evaluatePublishGate({ pr, currentUser });
  // No success toast: the badge next to the title flips from "Draft" to "Open"
  // the moment this resolves, which says it better than a message would.
  if (!gate.visible) return null;

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.publishDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish this pull request.');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setError(null), 6000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="btn btn--sm btn--publish"
        disabled={busy}
        onClick={() => void publish()}
        title="Mark this draft as ready for review"
      >
        {busy ? '⏳' : '▲'} Publish
      </button>
      {error && (
        <span className="topbar__review-toast topbar__review-toast--error">{error}</span>
      )}
    </>
  );
}
