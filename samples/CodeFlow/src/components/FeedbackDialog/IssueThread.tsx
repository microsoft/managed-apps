import { useState } from 'react';
import { Avatar } from '../Avatar';
import { MarkdownBody } from '../MarkdownBody/MarkdownBody';
import { useIssueComments } from './useIssueComments';
import { COMMENT_MAX_LENGTH, wasEdited } from '../../services/issues/commentStore';
import { relativeTime, timeTitle } from '../../utils/format';
import type { FeedbackComment, FeedbackCommentKind, IssueViewer } from '../../types';

/**
 * How each kind is flagged in the thread. `comment` has no badge — an ordinary
 * reply shouldn't be decorated.
 */
const KIND_BADGES: Partial<Record<FeedbackCommentKind, string>> = {
  status: 'Status',
  question: 'Needs an answer',
};

export interface IssueThreadProps {
  issueId: string;
  viewer: IssueViewer | undefined;
}

/**
 * The comment thread under an expanded issue.
 *
 * This is the tracker's only two-way channel: without it there is no way to ask
 * a reporter what they meant, or to record that something shipped, and every
 * ambiguous issue has to be chased somewhere else.
 */
export function IssueThread({ issueId, viewer }: IssueThreadProps) {
  const { comments, loading, error, busyId, posting, post, save } = useIssueComments(
    issueId,
    viewer,
  );
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editDraft, setEditDraft] = useState('');

  const canPost = draft.trim().length > 0 && !posting;

  const beginEdit = (comment: FeedbackComment) => {
    setEditingId(comment.id);
    setEditDraft(comment.body);
  };

  return (
    <div className="issue-thread" data-testid="issue-thread">
      {error && (
        <p className="issue-thread__error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="issue-thread__empty">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="issue-thread__empty">No comments yet.</p>
      ) : (
        <ol className="issue-thread__list">
          {comments.map((comment) => {
            const author = {
              login: comment.authorLogin ?? 'unknown',
              name: comment.authorName,
            };
            const badge = KIND_BADGES[comment.kind];
            const editing = editingId === comment.id;
            const busy = busyId === comment.id;

            return (
              <li
                key={comment.id}
                className={`issue-thread__item issue-thread__item--${comment.kind}`}
              >
                <div className="issue-thread__head">
                  <Avatar user={author} size={18} />
                  <span className="issue-thread__author">{author.login}</span>
                  {badge && (
                    <span
                      className={`issue-thread__badge issue-thread__badge--${comment.kind}`}
                    >
                      {badge}
                    </span>
                  )}
                  <span className="issue-thread__time" title={timeTitle(comment.createdAt)}>
                    {relativeTime(comment.createdAt)}
                    {wasEdited(comment) && ' · edited'}
                  </span>
                  {!editing && (
                    <button
                      className="issue-thread__edit"
                      onClick={() => beginEdit(comment)}
                      disabled={busy}
                    >
                      Edit
                    </button>
                  )}
                </div>

                {editing ? (
                  <form
                    className="issue-thread__form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!editDraft.trim() || busy) return;
                      void save(comment, { body: editDraft, kind: comment.kind }).then(
                        (ok) => {
                          if (ok) setEditingId(undefined);
                        },
                      );
                    }}
                  >
                    <textarea
                      className="issue-thread__input"
                      aria-label="Edit comment"
                      maxLength={COMMENT_MAX_LENGTH}
                      rows={3}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                    />
                    <div className="issue-thread__actions">
                      <button
                        type="submit"
                        className="btn btn--sm btn--primary"
                        disabled={!editDraft.trim() || busy}
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => setEditingId(undefined)}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <MarkdownBody content={comment.body} className="issue-thread__body" />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {(
        <form
          className="issue-thread__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canPost) return;
            void post({ body: draft, kind: 'comment' }).then((ok) => {
              if (ok) setDraft('');
            });
          }}
        >
          <textarea
            className="issue-thread__input"
            placeholder="Add a comment — markdown welcome."
            aria-label="Add a comment"
            maxLength={COMMENT_MAX_LENGTH}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="issue-thread__actions">
            <button type="submit" className="btn btn--sm btn--primary" disabled={!canPost}>
              {posting && busyId === undefined ? 'Posting…' : 'Comment'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
