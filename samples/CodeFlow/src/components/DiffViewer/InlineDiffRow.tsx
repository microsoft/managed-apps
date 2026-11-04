import { memo, type ReactNode } from 'react';
import type { DiffLine } from '../../types';
import { lineAnchor, type Anchor } from './diffViewerUtils';
import type { SearchColumn } from './diffSearchModel';
import { CommentLineButton, type StartComment } from './CommentLineButton';

/**
 * One line of the inline diff.
 *
 * Split out purely so it can be memoised. A long file is thousands of these,
 * and without the memo every one of them is rebuilt whenever anything in the
 * viewer changes — dragging the splitter, opening a thread, a background poll.
 * The props are all stable by construction: `line` comes from a memoised diff,
 * and the four callbacks are `useCallback`/`useMemo` results, so a render that
 * changes none of them costs nothing per row instead of a millisecond.
 */
export const InlineDiffRow = memo(function InlineDiffRow({
  line,
  rowKey,
  onStartComment,
  threadBadges,
  renderContent,
  showLeft = true,
  showRight = true,
  selected = false,
}: {
  line: DiffLine;
  rowKey: string;
  onStartComment?: StartComment;
  showLeft?: boolean;
  showRight?: boolean;
  selected?: boolean;
  threadBadges(anchor: Anchor | null): ReactNode;
  renderContent?(column: SearchColumn, rowKey: string, text: string): ReactNode;
}) {
  const leftAnchor = showLeft ? lineAnchor(line, 'left') : null;
  const rightAnchor = showRight ? lineAnchor(line, 'right') : null;
  const cls =
    line.type === 'add'
      ? 'diff__line--add'
      : line.type === 'del'
        ? 'diff__line--del'
        : 'diff__line--ctx';
  const leftBadges = threadBadges(leftAnchor);
  const rightBadges = threadBadges(rightAnchor);
  return (
    <tr data-diff-row={rowKey} className={`diff__line ${cls}${selected ? ' diff__line--comment-range' : ''}`}>
      <td className="diff__gutter diff__gutter--old">
        {leftBadges && <span className="diff__badges">{leftBadges}</span>}
        {line.oldLineNo ?? ''}
        <CommentLineButton anchor={leftAnchor} onStartComment={onStartComment} />
      </td>
      <td className="diff__gutter diff__gutter--new">
        <span className="diff__lineno">{line.newLineNo ?? ''}</span>
        {rightBadges && <span className="diff__badges">{rightBadges}</span>}
        <CommentLineButton anchor={rightAnchor} onStartComment={onStartComment} />
      </td>
      <td className={`diff__marker diff__marker--${line.type}`}>
        {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''}
      </td>
      <td className="diff__code">
        <span data-comment-code="" data-comment-left={leftAnchor?.line} data-comment-right={rightAnchor?.line}>
          {renderContent ? renderContent('inline', rowKey, line.content) : line.content || '\u00a0'}
        </span>
      </td>
    </tr>
  );
});
