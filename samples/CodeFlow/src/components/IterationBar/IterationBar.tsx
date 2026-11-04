import { useEffect, useRef, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { relativeTime, timeTitle } from '../../utils/format';
import type { ForcePushInfo } from '../../utils/forcePush';
import type { MergeBaseInfo } from '../../utils/mergeIterations';
import { detectMergeBaseSubstitution } from '../../utils/mergeIterations';
import { githubLink } from '../../utils/githubLink';
import { countNewIterations } from '../../utils/lastReviewed';
import type { Iteration } from '../../types';

/** Human label for an iteration ("Base" or "Iteration N"). */
function iterName(it: Iteration): string {
  return it.isBase ? 'Base' : `Iteration ${it.index}`;
}

/**
 * Tells the reviewer when the iteration list is incomplete. GitHub discards
 * rewritten commits, so a force-pushed branch can't offer the states that came
 * before it — saying so is better than quietly showing a shorter list.
 */
function ForcePushNotice({ info, prUrl }: { info: ForcePushInfo; prUrl?: string }) {
  if (!info.confirmed) return null;

  const message = `This branch was force-pushed. ${info.lostCount} earlier commit${
    info.lostCount === 1 ? '' : 's'
  } ${info.lostCount === 1 ? 'is' : 'are'} no longer on it, so ${
    info.lostCount === 1 ? 'its iteration' : 'those iterations'
  } can't be compared here.`;

  return (
    <span className="iterbar__warning" role="status">
      <span className="iterbar__warning-icon" aria-hidden="true">
        ⚠
      </span>
      <span className="iterbar__warning-text">{message}</span>
      {prUrl && (
        <a
          className="iterbar__warning-link"
          href={githubLink(prUrl)}
          target="_blank"
          rel="noreferrer noopener"
        >
          View on GitHub
        </a>
      )}
    </span>
  );
}

/**
 * Explains a diff that isn't the literal range the reviewer picked. Comparing
 * across a merge commit would replay everything the merge brought in, so the
 * left side is moved onto the merged-in mainline instead. That trade — losing
 * strict incrementality to lose the noise — is worth one sentence.
 */export function MergeBaseNotice({ info }: { info: MergeBaseInfo }) {
  const message = `Showing all of the PR's changes as of iteration ${info.toIndex}, because iteration ${info.merge.index} merged in another branch.`;

  return (
    <span className="iterbar__warning" role="status">
      <span className="iterbar__warning-icon" aria-hidden="true">
        ⓘ
      </span>
      <span className="iterbar__warning-text">{message}</span>
    </span>
  );
}

interface IterationPickerProps {
  /** Accessible label for the control (e.g. "From iteration"). */
  label: string;
  /** Currently selected iteration index. */
  value: number;
  iterations: Iteration[];
  approvedShas: ReadonlySet<string>;
  appApprovedShas: ReadonlySet<string>;
  onSelect(index: number): void;
}

/**
 * A compact trigger button that opens a scrollable popover listing every
 * iteration with its push time and commit message. Scales to any number of
 * iterations without a wrapping chip strip.
 */
function IterationPicker({ label, value, iterations, approvedShas, appApprovedShas, onSelect }: IterationPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = iterations.find((it) => it.index === value);

  // Close on outside click or Escape while the popover is open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (index: number) => {
    onSelect(index);
    setOpen(false);
  };

  return (
    <div className="iterpick" ref={rootRef}>
      <button
        type="button"
        className="iterpick__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected ? iterName(selected) : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="iterpick__trigger-name">{selected ? iterName(selected) : '—'}</span>
        <span className="iterpick__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <ul className="iterpick__menu" role="listbox" aria-label={label}>
          {iterations.map((it) => (
            <li key={it.sha || it.index}>
              <button
                type="button"
                role="option"
                aria-selected={it.index === value}
                className={`iterpick__opt${it.index === value ? ' iterpick__opt--active' : ''}`}
                title={it.shortSha}
                onClick={() => pick(it.index)}
              >
                <span className="iterpick__opt-idx">
                  {it.isBase ? 'Base' : `#${it.index}`}
                  {!it.isBase && (approvedShas.has(it.sha) || appApprovedShas.has(it.sha)) && (
                    <span
                      className="iterpick__approved"
                      role="img"
                      aria-label={appApprovedShas.has(it.sha) ? 'Previously approved by you (app only)' : 'Previously approved by you'}
                      title={appApprovedShas.has(it.sha) ? 'Previously approved by you (app only)' : 'Previously approved by you'}
                    >
                      ✓
                    </span>
                  )}
                </span>
                <span className="iterpick__opt-msg">{it.message || '(no message)'}</span>
                {it.date && (
                  <span className="iterpick__opt-time" title={timeTitle(it.date)}>
                    {relativeTime(it.date)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IterationBar() {
  const { iterations, fromIndex, toIndex, comparisonLoading, forcePush, pr, lastReviewed, reviewers, authorApproval, currentUser, actions } =
    useCodeFlow();
  if (iterations.length === 0) return null;

  const lastIndex = iterations.length - 1;
  // iterations[0] is the base; the rest are pushed commits.
  const count = lastIndex;
  const isFull = Math.min(fromIndex, toIndex) === 0 && Math.max(fromIndex, toIndex) === lastIndex;
  // The right-hand ("compare to") iteration whose details fill the bar.
  const toIter = iterations.find((it) => it.index === toIndex);
  const mergeBase = pr
    ? detectMergeBaseSubstitution(iterations, fromIndex, toIndex, pr.baseSha)
    : undefined;
  const ownReviewer = currentUser
    ? reviewers.find((reviewer) => reviewer.user.login.toLowerCase() === currentUser.login.toLowerCase())
    : undefined;
  const ownAuthorApproval = currentUser &&
    authorApproval?.user.login.toLowerCase() === currentUser.login.toLowerCase()
    ? authorApproval : undefined;
  const newSince = countNewIterations(iterations, lastReviewed, [
    ...(ownReviewer ? [ownReviewer] : []),
    ...(ownAuthorApproval ? [ownAuthorApproval] : []),
  ]);
  const approvedShas = new Set(
    ownReviewer?.approvedCommitIds,
  );
  const appApprovedShas = new Set(
    ownAuthorApproval?.approvedCommitIds,
  );

  const select = (from: number, to: number) => {
    if (from === fromIndex && to === toIndex) return;
    void actions.selectIterations(from, to);
  };

  return (
    <div className="iterbar">
      <span className="iterbar__count">
        {count} iteration{count === 1 ? '' : 's'}
      </span>

      {newSince && (
        <button
          type="button"
          className="iterbar__since"
          onClick={() => select(newSince.index, lastIndex)}
          title={`You last reviewed ${iterName(iterations[newSince.index])} ${relativeTime(
            newSince.at,
          )}. Click to see just what has changed since.`}
        >
          {newSince.count} new since your last review
        </button>
      )}

      <span className="iterbar__compare">
        <span className="iterbar__label">Comparing</span>
        <IterationPicker
          label="From iteration"
          value={fromIndex}
          iterations={iterations}
          approvedShas={approvedShas}
          appApprovedShas={appApprovedShas}
          onSelect={(from) => select(from, toIndex)}
        />
        <span className="iterbar__vs">vs</span>
        <IterationPicker
          label="To iteration"
          value={toIndex}
          iterations={iterations}
          approvedShas={approvedShas}
          appApprovedShas={appApprovedShas}
          onSelect={(to) => select(fromIndex, to)}
        />
      </span>

      <button
        className={`btn btn--sm ${isFull ? 'btn--active' : ''}`}
        onClick={() => select(0, lastIndex)}
        disabled={isFull}
        title="Compare the base against the latest iteration"
      >
        Full PR
      </button>

      {comparisonLoading && <span className="iterbar__loading">Comparing…</span>}

      {toIter && (
        <span className="iterbar__detail">
          <span className="iterbar__detail-idx">{toIter.isBase ? 'Base' : `#${toIter.index}`}</span>
          <span className="iterbar__detail-msg" title={toIter.message}>
            {toIter.message || '(no message)'}
          </span>
          {toIter.date && (
            <span className="iterbar__detail-time" title={timeTitle(toIter.date)}>
              {relativeTime(toIter.date)}
            </span>
          )}
        </span>
      )}

      {mergeBase && <MergeBaseNotice info={mergeBase} />}
      {forcePush && <ForcePushNotice info={forcePush} prUrl={pr?.htmlUrl} />}
    </div>
  );
}
