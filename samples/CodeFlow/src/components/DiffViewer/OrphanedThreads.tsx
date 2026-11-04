import type { CommentThread } from '../../types';
import { CommentThreadView } from '../CommentThread/CommentThread';
import { CollapsedThread } from '../CommentThread/CollapsedThread';
import { threadAnchorLabel, threadAnchorTitle } from '../../utils/threadAnchor';

interface OrphanedThreadsProps {
  threads: CommentThread[];
  /** Ids of threads that are currently expanded. */
  expandedThreads: Set<string>;
  onExpand(id: string): void;
  onCollapse(id: string): void;
  /**
   * Overrides the header. The default names these threads as outdated, which is
   * only true when the caller filtered them that way — the Markdown preview
   * reuses this list for *every* thread on the file, because a rendered
   * document has no line to hang them off.
   */
  heading?: string;
  /** Overrides the ⚠️ that goes with the default heading. */
  icon?: string;
}

/**
 * Render threads whose anchor line is no longer in the visible diff. Each thread
 * can be collapsed to a compact header (parity with in-diff comment badges) so a
 * long list of outdated comments stays manageable.
 *
 * The anchor shown is where the comment was written, which for an outdated
 * thread is a line in an earlier iteration — the point being that a reviewer can
 * go and check whether it was addressed. It is deliberately not a live position.
 */
export function OrphanedThreads({
  threads,
  expandedThreads,
  onExpand,
  onCollapse,
  heading,
  icon = '⚠️',
}: OrphanedThreadsProps) {
  return (
    <div className="diff__orphaned">
      <div className="diff__orphaned-header">
        <span className="diff__orphaned-icon">{icon}</span>
        {heading ?? `Outdated comments (${threads.length}) — line no longer in diff`}
      </div>
      {threads.map((t) => {
        const expanded = expandedThreads.has(t.id);
        return (
          <div key={t.id} className="diff__orphaned-thread">
            <span className="diff__orphaned-anchor" title={threadAnchorTitle(t)}>
              {threadAnchorLabel(t)}
            </span>
            {expanded ? (
              <CommentThreadView thread={t} onCollapse={() => onCollapse(t.id)} />
            ) : (
              <CollapsedThread thread={t} onExpand={() => onExpand(t.id)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
