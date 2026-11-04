import { useCallback, useEffect, useRef, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
// Imported from the module rather than the package barrel: the barrel also
// exports the connector-backed fetch, and pulling that into a component drags
// the whole managed-apps data client along with it.
import { checkLink } from '../../services/checks/checkLinks';
import { tallyRequired } from '../../services/checks/checksQuery';
import type { CheckOutcome, PrCheck, PrCoordinates } from '../../types';

export interface ChecksDialogProps {
  onClose: () => void;
}

const ICON: Record<CheckOutcome, string> = {
  success: '✓',
  failure: '✗',
  pending: '⏳',
  neutral: '–',
};

const OUTCOME_LABEL: Record<CheckOutcome, string> = {
  success: 'Passed',
  failure: 'Failed',
  pending: 'Running',
  neutral: 'Skipped',
};

function CheckRow({
  check,
  coords,
  prHtmlUrl,
}: {
  check: PrCheck;
  coords: PrCoordinates;
  prHtmlUrl?: string;
}) {
  const href = checkLink(check, coords, prHtmlUrl);

  return (
    <li className={`checks-dialog__row checks-dialog__row--${check.outcome}`}>
      <span
        className="checks-dialog__icon"
        title={check.rawState}
        aria-label={OUTCOME_LABEL[check.outcome]}
        role="img"
      >
        {ICON[check.outcome]}
      </span>
      <span className="checks-dialog__body">
        <span className="checks-dialog__name">
          {check.name}{' '}
          <span className={`checks-dialog__requirement${check.isRequired === true ? ' checks-dialog__requirement--required' : ''}`}>
            {check.isRequired === true ? 'Required' : check.isRequired === false ? 'Optional' : 'Requirement unknown'}
          </span>
        </span>
        {check.description && (
          <span className="checks-dialog__desc" title={check.description}>
            {check.description}
          </span>
        )}
      </span>
      {href && (
        <a
          className="checks-dialog__action"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          Details ↗
        </a>
      )}
    </li>
  );
}

/**
 * The full check list behind the pill.
 *
 * Every row links somewhere useful, which is more than GitHub's own summary
 * manages for some providers — a check can report a placeholder details URL, so
 * the links are rebuilt against GitHub rather than followed blindly.
 */
export function ChecksDialog({ onClose }: ChecksDialogProps) {
  const { checks, pr, actions } = useCodeFlow();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const recheck = useCallback(async () => {
    setRefreshing(true);
    try {
      await actions.refreshChecks();
    } finally {
      setRefreshing(false);
    }
  }, [actions]);

  if (!checks || !pr) return null;

  const required = tallyRequired(checks.checks);
  const unknown = checks.checks.some((check) => check.isRequired === undefined);

  return (
    <div className="fb__backdrop" onMouseDown={onBackdrop}>
      <div
        className="checks-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checks-dialog-title"
        data-testid="checks-dialog"
      >
        <header className="fb__head">
          <div>
            <h2 className="fb__title" id="checks-dialog-title">
              Checks
            </h2>
            <p className="fb__sub">
              {checks.passed} of {checks.total} passing
              {checks.failed > 0 ? `, ${checks.failed} failing` : ''}
              {checks.pending > 0 ? `, ${checks.pending} still running` : ''}
              {checks.sha ? ` · ${checks.sha.slice(0, 7)}` : ''}
            </p>
          </div>
          <button className="fb__close" onClick={onClose} ref={closeRef} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="checks-dialog__requirements">
          {required.passed} of {required.total} reported required checks passing.
          {' '}Optional checks are informational and do not block merging.
          {unknown ? ' Some check requirements could not be determined.' : ''}
        </p>

        <ul className="checks-dialog__list">
          {checks.checks.map((check) => (
            <CheckRow
              key={`${check.kind}:${check.id}`}
              check={check}
              coords={pr.coordinates}
              prHtmlUrl={pr.htmlUrl}
            />
          ))}
        </ul>

        <footer className="checks-dialog__foot">
          <button
            className="btn btn--sm"
            onClick={() => void recheck()}
            disabled={refreshing}
            data-testid="checks-recheck"
          >
            {refreshing ? 'Re-checking…' : 'Re-check'}
          </button>
        </footer>
      </div>
    </div>
  );
}
