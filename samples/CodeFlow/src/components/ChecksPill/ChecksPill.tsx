import { useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { tallyRequired } from '../../services/checks/checksQuery';
import { ChecksDialog } from './ChecksDialog';

/** Required-check progress, with optional results one click away. */
export function ChecksPill() {
  const { checks, checksLoading } = useCodeFlow();
  const [open, setOpen] = useState(false);

  // Nothing to say: still loading, unreadable, or a PR with no CI at all. In
  // every case an empty space beats a pill that explains itself.
  if (!checks || checks.total === 0) {
    return checksLoading ? <span className="checks-pill checks-pill--loading">Checks…</span> : null;
  }

  const required = tallyRequired(checks.checks);
  const optional = checks.checks.filter((check) => check.isRequired === false).length;
  const unknown = checks.total - required.total - optional;
  const label = required.total > 0
    ? 'required checks passing'
    : `${unknown > 0 ? '' : 'optional '}check${checks.total === 1 ? '' : 's'}`;
  const tone = required.failed > 0 ? 'failing'
    : required.pending > 0 ? 'pending'
    : required.total > 0 && unknown === 0 ? 'passing' : 'informational';
  const detail = [
    required.total > 0 ? `${required.passed}/${required.total} reported required checks passing` : undefined,
    required.failed > 0 ? `${required.failed} required checks failing` : undefined,
    required.pending > 0 ? `${required.pending} required checks still running` : undefined,
    optional > 0 ? `${optional} optional checks (informational)` : undefined,
    unknown > 0 ? `${unknown} checks with unknown requirements` : undefined,
  ].filter(Boolean);

  return (
    <>
      <button
        type="button"
        className={`checks-pill checks-pill--${tone}`}
        onClick={() => setOpen(true)}
        title={`${detail.join(', ')} — click for details`}
        data-testid="checks-pill"
      >
        <span className="checks-pill__count">
          {required.total > 0 ? `${required.passed}/${required.total}` : checks.total}
        </span>{' '}
        {label}
      </button>
      {open && <ChecksDialog onClose={() => setOpen(false)} />}
    </>
  );
}
