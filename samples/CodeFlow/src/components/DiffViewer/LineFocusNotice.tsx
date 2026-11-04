/**
 * Says so when a search result could not be reached.
 *
 * Clicking a cross-file result is a promise to take the reviewer somewhere.
 * Almost always the viewer can keep it, widening the presentation if the line
 * was filtered out of view. When it genuinely cannot — the line belongs to a
 * patch this file no longer has, say, because the iteration moved underneath
 * the results — the one thing it must not do is nothing at all, leaving the
 * reviewer staring at an unchanged screen wondering whether the click landed.
 */
import type { DiffSide } from '../../types';

export function LineFocusNotice({
  target,
  onDismiss,
}: {
  /** The line that could not be shown, or null to render nothing. */
  target: { side: DiffSide; line: number } | null;
  onDismiss: () => void;
}) {
  if (!target) return null;

  const side = target.side === 'left' ? 'original' : 'updated';

  return (
    <div className="diff__linenotice" role="status">
      <span className="diff__linenotice-icon" aria-hidden="true">
        ⚠
      </span>
      <span className="diff__linenotice-text">
        Couldn&apos;t jump to line {target.line} on the {side} side — it isn&apos;t in this
        file&apos;s diff any more. The search results may be from an earlier iteration.
      </span>
      <button className="btn btn--sm diff__linenotice-btn" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
