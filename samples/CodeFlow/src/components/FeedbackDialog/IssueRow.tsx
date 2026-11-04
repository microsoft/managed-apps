import { useState } from 'react';
import { Avatar } from '../Avatar';
import { MarkdownBody } from '../MarkdownBody/MarkdownBody';
import { IssueEditor } from './IssueEditor';
import { IssueThread } from './IssueThread';
import { STATUS_HINTS, STATUS_LABELS } from './issueFilter';
import { ACTIVE_ISSUE_STATUSES, isClosedStatus } from '../../services/issues/issueStore';
import { relativeTime, timeTitle } from '../../utils/format';
import type { Issue, IssueDraft, IssueKind, IssueStatus, IssueViewer } from '../../types';

const KIND_LABELS: Record<IssueKind, string> = {
  bug: 'Bug',
  idea: 'Idea',
  question: 'Question',
};

export interface IssueRowProps {
  issue: Issue;
  viewer: IssueViewer | undefined;
  busy: boolean;
  onSave: (issue: Issue, draft: IssueDraft) => Promise<boolean>;
  onSetStatus: (issue: Issue, status: IssueStatus) => void;
}

/**
 * One issue in the list: collapsed to a single line, expanding to show the
 * description and the actions this viewer is allowed to take.
 */
export function IssueRow({ issue, viewer, busy, onSave, onSetStatus }: IssueRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  const closed = isClosedStatus(issue.status);
  const author = { login: issue.authorLogin ?? 'unknown', name: issue.authorName };

  return (
    <li className={`issue issue--${issue.status}`}>
      <div className={`issue__head ${expanded ? 'issue__head--open' : ''}`}>
        <button
          className={`issue__disclose ${expanded ? 'issue__disclose--open' : ''}`}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="issue__caret">{expanded ? '▾' : '▸'}</span>
          <span
            className={`issue__status issue__status--${issue.status}`}
            title={STATUS_HINTS[issue.status]}
          >
            {STATUS_LABELS[issue.status]}
          </span>
          <span className={`issue__kind issue__kind--${issue.kind}`}>
            {KIND_LABELS[issue.kind]}
          </span>
          {/* Collapsed the title has one line and gets an ellipsis, so carry the
              whole thing in a tooltip; expanded it wraps and needs no help. */}
          <span
            className={`issue__title ${expanded ? 'issue__title--full' : ''}`}
            title={expanded ? undefined : issue.title}
          >
            {issue.title}
          </span>
        </button>
        <span className="issue__meta" title={timeTitle(issue.updatedAt)}>
          <Avatar user={author} size={18} />
          <span className="issue__author">{author.login}</span>
          <span className="issue__time">{relativeTime(issue.updatedAt)}</span>
        </span>
      </div>

      {expanded && (
        <div className="issue__detail">
          {editing ? (
            <IssueEditor
              initial={{ title: issue.title, body: issue.body, kind: issue.kind }}
              submitLabel="Save changes"
              busy={busy}
              onCancel={() => setEditing(false)}
              onSubmit={(draft) => {
                void onSave(issue, draft).then((ok) => {
                  if (ok) setEditing(false);
                });
              }}
            />
          ) : (
            <>
              {issue.body ? (
                <MarkdownBody content={issue.body} className="issue__body" />
              ) : (
                <p className="issue__nobody">No description.</p>
              )}
              <div className="issue__foot">
                <span className="issue__stamp" title={timeTitle(issue.createdAt)}>
                  Raised {relativeTime(issue.createdAt)}
                  {issue.appVersion && ` on v${issue.appVersion}`}
                  {closed &&
                    issue.closedBy &&
                    ` · ${issue.status === 'wontfix' ? 'closed as won’t fix' : 'closed'} by ${issue.closedBy}`}
                </span>
                <span className="issue__actions">
                  {!closed && (
                    <select
                      className="issue__triage"
                      aria-label="Issue status"
                      title={STATUS_HINTS[issue.status]}
                      value={issue.status}
                      disabled={busy}
                      onChange={(e) => onSetStatus(issue, e.target.value as IssueStatus)}
                    >
                      {ACTIVE_ISSUE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  )}
                  {(
                    <button
                      className="btn btn--sm"
                      onClick={() => setEditing(true)}
                      disabled={busy}
                    >
                      Edit
                    </button>
                  )}
                  {/* Offered on an already-closed issue too, so a close that
                      should have been a decline is one click to correct rather
                      than a reopen-and-reclose. */}
                  {issue.status !== 'wontfix' && (
                    <button
                      className="btn btn--sm"
                      onClick={() => onSetStatus(issue, 'wontfix')}
                      disabled={busy}
                      title={STATUS_HINTS.wontfix}
                    >
                      Won’t fix
                    </button>
                  )}
                  {(
                    <button
                      className="btn btn--sm"
                      onClick={() => onSetStatus(issue, closed ? 'open' : 'closed')}
                      disabled={busy}
                    >
                      {busy ? '⏳' : closed ? 'Reopen' : 'Close'}
                    </button>
                  )}
                </span>
              </div>
              <IssueThread issueId={issue.id} viewer={viewer} />
            </>
          )}
        </div>
      )}
    </li>
  );
}
