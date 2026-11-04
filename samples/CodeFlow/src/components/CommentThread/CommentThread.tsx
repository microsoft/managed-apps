import { useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { Avatar } from '../Avatar';
import { MarkdownBody } from '../MarkdownBody/MarkdownBody';
import { MarkdownToolbar } from '../MarkdownToolbar/MarkdownToolbar';
import { relativeTime, timeTitle } from '../../utils/format';
import { buildDeepLink } from '../../utils/deepLink';
import { githubCommentUrl } from '../../utils/githubLink';
import { isSyncedBackend } from '../../utils/commentBackend';
import { canDeleteComment, canEditComment } from '../../utils/commentEdit';
import { editDraftKey, replyDraftKey } from '../../utils/commentDrafts';
import { useDraft } from '../../utils/useDraft';
import { CopyLinkButton } from '../CopyLinkButton/CopyLinkButton';
import { commentLineLabel } from '../../utils/commentRange';
import {
  THREAD_STATUS_LABELS,
  threadDisplayStatus,
  threadStatusLabel,
  threadStatusTitle,
} from '../../utils/threadStatus';
import type { CommentThread as Thread, CommentThreadStatus } from '../../types';

const STATUS_OPTIONS: CommentThreadStatus[] = [
  'active',
  'resolved',
];

interface CommentThreadProps {
  thread: Thread;
  onClose?(): void;
  onCollapse?(): void;
  /** Original line content for rendering suggestions. */
  originalLine?: string;
  /** Line number the thread is anchored to. */
  lineNumber?: number;
}

export function CommentThreadView({ thread, onClose, onCollapse, originalLine, lineNumber }: CommentThreadProps) {
  const { actions, commentBackendLabel, currentUser, pr, prKey } = useCodeFlow();
  // Kept in storage rather than in memory alone: a poll that finds a new commit
  // reloads the pull request, and the reload takes this whole tree down.
  const [reply, setReply] = useDraft(replyDraftKey(prKey, thread.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // At most one comment is open for editing at a time — two half-finished edits
  // in the same thread is a state nobody asked for.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirmingDeletion = thread.comments.some((c) => c.id === deletingId);

  const deleteComment = async (commentId: string) => {
    setBusy(true);
    setError(null);
    try {
      await actions.deleteComment(thread.id, commentId);
      setDeletingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete comment.');
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async (resolve = false) => {
    const body = reply.trim();
    if (!body || busy || confirmingDeletion) return;
    setBusy(true);
    setError(null);
    // Empty the box now, not when the write comes back. `addComment` appends an
    // optimistic copy to the thread immediately, so a draft still holding the
    // same text would show the reply twice for as long as GitHub takes to
    // answer — which is what it looked like the app had done.
    setReply('');
    try {
      await actions.addComment(thread.id, body);
      if (resolve) await actions.setThreadStatus(thread.id, 'resolved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add reply.');
      // The optimistic copy is rolled back on failure, so put the text back
      // rather than lose it — unless something new has been typed since.
      setReply((cur) => (cur.trim() ? cur : body));
    } finally {
      setBusy(false);
    }
  };

  const firstComment = thread.comments[0];

  const commentLink = pr
    ? buildDeepLink({
        owner: pr.coordinates.owner,
        repo: pr.coordinates.name,
        number: pr.coordinates.number,
        commentId: thread.id,
      })
    : '';

  // Two links, because they answer different questions: the deep link reopens
  // the thread in CodeFlow, while this one names the comment on GitHub itself —
  // the form you can hand to Copilot or anyone without the app.
  const githubCommentLink = pr
    ? githubCommentUrl({
        coords: pr.coordinates,
        prHtmlUrl: pr.htmlUrl,
        commentHtmlUrl: firstComment?.htmlUrl,
        commentId: firstComment?.id,
        isIssueComment: thread.isIssueComment,
      })
    : '';

  return (
    <div className={`thread thread--${thread.status}${thread.closed ? ' thread--closed' : ''}`} data-thread-id={thread.id}>
      {/* The header only advertises itself as clickable when a collapse handler
          is wired up — a chevron that does nothing is worse than no chevron. */}
      <div
        className={`thread__head${onCollapse ? ' thread__head--collapsible' : ''}`}
        onClick={onCollapse ? () => onCollapse() : undefined}
        role={onCollapse ? 'button' : undefined}
        tabIndex={onCollapse ? 0 : undefined}
        title={onCollapse ? 'Collapse thread' : undefined}
        onKeyDown={
          onCollapse
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onCollapse();
                }
              }
            : undefined
        }
      >
        {onCollapse && <span className="thread__chevron thread__chevron--open">▶</span>}
        {/* One badge only: "closed" is a local flag that supersedes the GitHub
            status, so a closed thread must not read "Active Closed". */}
        <span
          className={`thread__status thread__status--${threadDisplayStatus(thread)}`}
          title={threadStatusTitle(thread)}
        >
          {threadStatusLabel(thread)}
        </span>
        <span className="thread__anchor">
          {thread.isIssueComment
            ? 'PR comment'
            : `${thread.filename.split('/').pop()}:${commentLineLabel(thread)}`}
        </span>
        {firstComment && (
          <span className="thread__head-author">
            {firstComment.author.name || firstComment.author.login}
          </span>
        )}
        <div className="thread__head-actions" onClick={(e) => e.stopPropagation()}>
          <CopyLinkButton link={commentLink} title="Copy link to this comment" />
          <CopyLinkButton
            link={githubCommentLink}
            label="GH"
            title="Copy the GitHub link to this comment"
          />
          <button
            className={`btn btn--sm thread__closebtn${thread.closed ? ' thread__closebtn--reopen' : ''}`}
            title={thread.closed
              ? 'Reopen this thread (also unresolves on GitHub)'
              : 'Close this thread once you\u2019re satisfied with the fix (also resolves on GitHub)'}
            onClick={() => actions.setThreadClosed(thread.id, !thread.closed)}
          >
            {thread.closed ? 'Reopen' : 'Close'}
          </button>
          {/* GitHub can't resolve a PR-level conversation comment — only
              review threads have a resolved state. */}
          {!thread.isIssueComment && (
            <select
              className="thread__statussel"
              value={threadDisplayStatus(thread)}
              disabled={!!thread.closed}
              onChange={(e) => {
                setError(null);
                void actions
                  .setThreadStatus(thread.id, e.target.value as CommentThreadStatus)
                  .catch((err: unknown) => {
                    setError(
                      err instanceof Error
                        ? err.message
                        : 'Failed to change the thread status.',
                    );
                  });
              }}
              aria-label="Thread status"
            >
              {thread.closed && (
                <option value="closed">{THREAD_STATUS_LABELS.closed}</option>
              )}
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {THREAD_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
          {!isSyncedBackend(commentBackendLabel) && (
            <button
              className="iconbtn"
              title="Delete thread"
              onClick={() => void actions.deleteThread(thread.id)}
            >
              🗑
            </button>
          )}
          {onClose && (
            <button className="iconbtn" title="Collapse" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
      </div>

      <ul className="thread__comments">
        {thread.comments.map((c) => (
          <li key={c.id} className="comment">
            <Avatar user={c.author} size={22} />
            <div className="comment__body">
              <div className="comment__meta">
                <span className="comment__author">{c.author.name || c.author.login}</span>
                <span className="comment__time" title={timeTitle(c.createdAt)}>
                  {relativeTime(c.createdAt)}
                </span>
                {c.local && <span className="comment__local" title="Stored locally">local</span>}
                {editingId !== c.id && canEditComment(c, currentUser) && (
                  <button
                    className="linkbtn comment__edit"
                    title="Edit this comment"
                    disabled={busy || confirmingDeletion}
                    onClick={() => setEditingId(c.id)}
                  >
                    Edit
                  </button>
                )}
                {editingId === null && canDeleteComment(c, currentUser) && (
                  <button
                    className="linkbtn comment__delete"
                    title="Delete this comment"
                    disabled={busy || confirmingDeletion}
                    onClick={() => {
                      setError(null);
                      setDeletingId(c.id);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              {deletingId === c.id && (
                <div className="comment__delete-confirm" role="group" aria-label="Confirm comment deletion">
                  <span>
                    Delete this comment{c.local ? '' : ' from GitHub'}? This cannot be undone. Replies are kept.
                  </span>
                  <button className="btn btn--sm btn--danger" disabled={busy} onClick={() => void deleteComment(c.id)}>
                    {busy ? 'Deleting...' : 'Delete comment'}
                  </button>
                  <button
                    className="btn btn--sm"
                    disabled={busy}
                    onClick={() => {
                      setDeletingId(null);
                      setError(null);
                    }}
                  >
                    Cancel deletion
                  </button>
                </div>
              )}
              {editingId === c.id ? (
                <CommentEditor
                  initialBody={c.body}
                  draftKey={editDraftKey(prKey, c.id)}
                  originalLine={originalLine}
                  onCancel={() => setEditingId(null)}
                  onSave={async (body) => {
                    await actions.editComment(thread.id, c.id, body);
                    setEditingId(null);
                  }}
                />
              ) : (
                <MarkdownBody content={c.body} className="comment__text" originalLine={originalLine} lineNumber={lineNumber} />
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="thread__reply">
        <MarkdownToolbar
          value={reply}
          onChange={setReply}
          placeholder="Reply…"
          rows={2}
          originalLine={originalLine}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter')
              void submitReply(e.shiftKey && !thread.isIssueComment);
          }}
        />
        <div className="thread__reply-actions">
          <button
            className="btn btn--sm btn--primary"
            disabled={!reply.trim() || busy || confirmingDeletion}
            onClick={() => void submitReply()}
          >
            {busy && !confirmingDeletion ? 'Sending…' : 'Reply'}
          </button>
          {thread.status !== 'resolved' && !thread.isIssueComment && (
            <button
              className="btn btn--sm"
              title="Post this reply and mark the thread resolved (⌘/Ctrl + Shift + Enter)"
              disabled={!reply.trim() || busy || confirmingDeletion}
              onClick={() => void submitReply(true)}
            >
              Reply &amp; Resolve
            </button>
          )}
        </div>
        {error && <div className="composer__error" role="alert">{error}</div>}
      </div>
    </div>
  );
}

interface CommentEditorProps {
  initialBody: string;
  onSave(body: string): Promise<void>;
  onCancel(): void;
  /** Original source line for the code suggestion button. */
  originalLine?: string;
  /** Where to persist the in-progress edit; `null` keeps it in memory only. */
  draftKey?: string | null;
}

/**
 * In-place editor for a comment that's already been posted.
 *
 * Deliberately not the same component as {@link NewCommentComposer}: the draft
 * starts populated, an empty body is a no-op rather than a submission, and a
 * failure has to keep the editor open with the text intact — the alternative is
 * a rejected edit that discards what the author just wrote.
 */
export function CommentEditor({ initialBody, onSave, onCancel, originalLine, draftKey = null }: CommentEditorProps) {
  const [body, setBody, clearBody] = useDraft(draftKey, initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = body.trim() !== initialBody.trim();

  // Cancelling is an explicit discard, so the stored copy goes with it —
  // otherwise reopening the editor would resurrect text the author rejected.
  const cancel = () => {
    clearBody();
    onCancel();
  };

  const submit = async () => {
    const text = body.trim();
    // Saving an unchanged comment would burn a round trip and a version in
    // GitHub's edit history to achieve nothing.
    if (!text || !changed) {
      cancel();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(text);
      clearBody();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save this comment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer comment__editor">
      <MarkdownToolbar
        value={body}
        onChange={setBody}
        placeholder="Edit your comment…"
        rows={3}
        autoFocus
        originalLine={originalLine}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
        }}
      />
      <div className="composer__actions">
        <button
          className="btn btn--sm btn--primary"
          disabled={!body.trim() || busy}
          onClick={() => void submit()}
        >
          Save
        </button>
        <button className="btn btn--sm" disabled={busy} onClick={cancel}>
          Cancel
        </button>
        <span className="composer__hint">⌘/Ctrl + Enter</span>
      </div>
      {error && <div className="composer__error" role="alert">{error}</div>}
    </div>
  );
}

interface ComposerProps {
  onSubmit(body: string): Promise<void> | void;
  onCancel(): void;
  placeholder?: string;
  /** Original source line for the code suggestion button. */
  originalLine?: string;
  /** Where to persist the in-progress comment; `null` keeps it in memory only. */
  draftKey?: string | null;
}

/** Standalone composer used to start a brand-new thread on a line. */
export function NewCommentComposer({ onSubmit, onCancel, placeholder, originalLine, draftKey = null }: ComposerProps) {
  const [body, setBody, clearBody] = useDraft(draftKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    if (busy) return;
    clearBody();
    onCancel();
  };

  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    // Clear the draft at the moment the thread appears optimistically above the
    // composer, so the comment isn't rendered twice while the write is in
    // flight. The button carries the progress instead.
    setBody('');
    try {
      await onSubmit(text);
    } catch (err) {
      // Keep the composer open and put the draft back so the text isn't lost.
      setError(err instanceof Error ? err.message : 'Failed to add comment.');
      setBody((cur) => (cur.trim() ? cur : text));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer">
      <MarkdownToolbar
        value={body}
        onChange={setBody}
        placeholder={placeholder ?? 'Start a comment thread…'}
        rows={3}
        autoFocus
        originalLine={originalLine}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
        }}
      />
      <div className="composer__actions">
        <button className="btn btn--sm btn--primary" disabled={!body.trim() || busy} onClick={() => void submit()}>
          {busy ? 'Sending…' : 'Comment'}
        </button>
        <button className="btn btn--sm" disabled={busy} onClick={cancel}>
          Cancel
        </button>
        <span className="composer__hint">⌘/Ctrl + Enter</span>
      </div>
      {error && <div className="composer__error" role="alert">{error}</div>}
    </div>
  );
}
