import type { CommentThread } from '../../types';
import { threadDisplayStatus } from '../../utils/threadStatus';

interface ThreadBadgeProps {
  thread: CommentThread;
  onClick: () => void;
}

/** Small gutter indicator for a collapsed thread — like CodeFlow's inline badges. */
export function ThreadBadge({ thread, onClick }: ThreadBadgeProps) {
  const count = thread.comments.length;
  const isResolved = thread.status === 'resolved';
  const isClosed = !!thread.closed;
  const state = threadDisplayStatus(thread);
  const cls = `diff__thread-badge diff__thread-badge--${state}`;
  const glyph = isClosed ? `💬✓ ${count}` : isResolved ? '💬✓' : `💬 ${count}`;
  return (
    <button
      className={cls}
      data-thread-id={thread.id}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`${state}: ${thread.comments[0]?.body.slice(0, 60) ?? ''} (click to expand)`}
    >
      {glyph}
    </button>
  );
}
