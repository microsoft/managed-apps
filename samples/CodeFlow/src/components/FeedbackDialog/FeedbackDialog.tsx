import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IssueEditor } from './IssueEditor';
import { IssueRow } from './IssueRow';
import { useIssues } from './useIssues';
import { appStorage } from '../../storage';
import {
  countIssues,
  EMPTY_COPY,
  filterIssues,
  ISSUE_FILTERS,
  type IssueFilter,
} from './issueFilter';

export interface FeedbackDialogProps {
  onClose: () => void;
}

/**
 * Notes & feedback: a small tracker for bugs, ideas and questions, stored in the
 * `feedback` collection of app storage. In local mode the list lives in this
 * browser only; with a shared storage provider everyone with access sees it.
 */
export function FeedbackDialog({ onClose }: FeedbackDialogProps) {
  const {
    issues,
    viewer,
    loading,
    unavailable,
    error,
    busyId,
    saving,
    refresh,
    create,
    save,
    setStatus,
    dismissError,
  } = useIssues();

  const shared = appStorage().provider.capabilities.shared;
  const [filter, setFilter] = useState<IssueFilter>('open');
  const [composing, setComposing] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

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

  const counts = useMemo(() => countIssues(issues), [issues]);
  const visible = useMemo(() => filterIssues(issues, filter), [issues, filter]);

  return (
    <div className="fb__backdrop" onMouseDown={onBackdrop}>
      <div
        className="fb"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fb-title"
        data-testid="feedback-dialog"
      >
        <header className="fb__head">
          <div>
            <h2 className="fb__title" id="fb-title">
              Notes &amp; feedback
            </h2>
            <p className="fb__sub">
              {shared
                ? 'Everyone with access to this app’s data sees these items.'
                : 'Stored in this browser only. Use Settings → Data to export them.'}
            </p>
          </div>
          <button
            className="fb__close"
            onClick={onClose}
            ref={closeRef}
            aria-label="Close feedback"
            title="Close"
          >
            ✕
          </button>
        </header>

        <div className="fb__toolbar">
          <div className="fb__filters" role="group" aria-label="Filter issues">
            {ISSUE_FILTERS.map((f) => (
              <button
                key={f.value}
                className={`fb__filter ${filter === f.value ? 'fb__filter--active' : ''}`}
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
              >
                {f.label} <span className="fb__count">{counts[f.value]}</span>
              </button>
            ))}
          </div>
          <div className="fb__toolbar-right">
            <button
              className="btn btn--sm"
              onClick={() => void refresh()}
              disabled={loading}
              title="Reload the list"
            >
              ↻ Refresh
            </button>
            <button
              className="btn btn--sm btn--primary"
              onClick={() => setComposing(true)}
              disabled={composing || unavailable}
            >
              + New item
            </button>
          </div>
        </div>

        {error && !unavailable && (
          <div className="fb__error" role="alert">
            {error}
            <button className="fb__error-x" onClick={dismissError} aria-label="Dismiss error">
              ✕
            </button>
          </div>
        )}

        <div className="fb__body">
          {composing && (
            <IssueEditor
              submitLabel="Save item"
              busy={saving && busyId === undefined}
              onCancel={() => setComposing(false)}
              onSubmit={(draft) => {
                void create(draft).then((ok) => {
                  if (ok) {
                    setComposing(false);
                    setFilter('open');
                  }
                });
              }}
            />
          )}

          {unavailable ? (
            <p className="fb__empty">
              Notes couldn’t be loaded from storage. Try Refresh, or check the storage
              settings.
            </p>
          ) : loading ? (
            <p className="fb__empty">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="fb__empty">{EMPTY_COPY[filter]}</p>
          ) : (
            <ul className="fb__list">
              {visible.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  viewer={viewer}
                  busy={busyId === issue.id}
                  onSave={save}
                  onSetStatus={(i, s) => void setStatus(i, s)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
