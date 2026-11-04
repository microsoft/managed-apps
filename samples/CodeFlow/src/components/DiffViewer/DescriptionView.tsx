import { useCallback, useMemo, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import type { CommentThread } from '../../types';
import { CommentThreadView, NewCommentComposer } from '../CommentThread/CommentThread';
import { CollapsedThread } from '../CommentThread/CollapsedThread';
import { MarkdownBody } from '../MarkdownBody/MarkdownBody';
import { hasDraft, prDraftKey } from '../../utils/commentDrafts';

/** Shows the PR description and any top-level (non-file) comments. */
export function DescriptionView() {
  const { pr, threads, comparison, actions, prKey } = useCodeFlow();
  const draftKey = prDraftKey(prKey);
  // Reopen the box if there's a comment part-written in it. A reload wipes this
  // component out, and a restored draft with nothing on screen to hold it would
  // look exactly like the text having been thrown away.
  const [showComposer, setShowComposer] = useState(() => hasDraft(draftKey));
  // Threads the reviewer has collapsed. Conversations start expanded; clicking
  // a thread header (or its chevron) folds it down to a one-line summary.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const collapseThread = useCallback((id: string) => {
    setCollapsed((prev) => new Set(prev).add(id));
  }, []);

  const expandThread = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Non-file threads: no filename, unknown path, or path not in the comparison.
  const changedFiles = useMemo(
    () => new Set((comparison?.files ?? []).map((f) => f.filename)),
    [comparison],
  );
  const prThreads = useMemo(
    () =>
      threads.filter(
        (t: CommentThread) => !t.filename || t.filename === '(unknown)' || !changedFiles.has(t.filename),
      ),
    [threads, changedFiles],
  );

  const handleSubmit = async (body: string) => {
    await actions.addIssueComment(body);
    setShowComposer(false);
  };

  return (
    <div className="diff diff--description">
      <div className="diff__header">
        <span className="diff__filename">Description</span>
        <button className="btn btn--sm" onClick={() => setShowComposer(true)}>
          + Comment
        </button>
      </div>
      <div className="description__body">
        {pr?.title && <h2 className="description__title">{pr.title}</h2>}
        {pr?.body ? (
          <MarkdownBody content={pr.body} className="description__text" />
        ) : (
          <p className="description__empty">No description provided.</p>
        )}
      </div>
      {showComposer && (
        <div className="description__threads" style={{ paddingBottom: 0 }}>
          <NewCommentComposer
            onSubmit={handleSubmit}
            onCancel={() => setShowComposer(false)}
            draftKey={draftKey}
            placeholder="Leave a comment on this pull request…"
          />
        </div>
      )}
      {prThreads.length > 0 && (
        <div className="description__threads">
          <h3 className="description__threads-heading">
            Conversations ({prThreads.length})
          </h3>
          {prThreads.map((t) =>
            collapsed.has(t.id) ? (
              <CollapsedThread
                key={t.id}
                thread={t}
                onExpand={() => expandThread(t.id)}
                className="collapsed-thread--description"
              />
            ) : (
              <CommentThreadView key={t.id} thread={t} onCollapse={() => collapseThread(t.id)} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
