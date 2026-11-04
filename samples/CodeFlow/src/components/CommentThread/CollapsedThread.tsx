import type { CommentThread } from '../../types';
import { threadDisplayStatus, threadStatusLabel, threadStatusTitle } from '../../utils/threadStatus';

interface CollapsedThreadProps {
  thread: CommentThread;
  onExpand(): void;
  /** Extra class for context-specific layout. */
  className?: string;
}

/**
 * Compact one-line stand-in for a collapsed thread: status, comment count and a
 * preview of the opening comment. Shared by outdated (orphaned) threads in the
 * diff and top-level conversations on the description, so both collapse the
 * same way.
 */
export function CollapsedThread({ thread, onExpand, className }: CollapsedThreadProps) {
  return (
    <button
      type="button"
      className={`collapsed-thread${className ? ` ${className}` : ''}`}
      data-thread-id={thread.id}
      onClick={onExpand}
      title="Expand thread"
    >
      <span className="collapsed-thread__chevron">▶</span>
      <span
        className={`thread__status thread__status--${threadDisplayStatus(thread)}`}
        title={threadStatusTitle(thread)}
      >
        {threadStatusLabel(thread)}
      </span>
      <span className="collapsed-thread__count">💬 {thread.comments.length}</span>
      <span className="collapsed-thread__preview">{thread.comments[0]?.body}</span>
    </button>
  );
}
