import type { Anchor } from './diffViewerUtils';
import { selectedCommentRange } from './selectedCommentRange';

export type StartComment = (anchor: Anchor) => void;

export function CommentLineButton({ anchor, onStartComment }: {
  anchor: Anchor | null;
  onStartComment?: StartComment;
}) {
  if (!anchor || !onStartComment) return null;
  return (
    <button
      className="diff__addcomment"
      title="Comment on highlighted lines, or this line if no range is selected"
      aria-label={`Comment on ${anchor.side} line ${anchor.line}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => onStartComment(selectedCommentRange(event.currentTarget, anchor) ?? anchor)}
    >
      +
    </button>
  );
}
