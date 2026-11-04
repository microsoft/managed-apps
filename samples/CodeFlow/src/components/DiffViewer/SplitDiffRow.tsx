import { memo, type ReactNode } from 'react';
import type { SideBySideRow } from '../../utils/diffParser';
import { lineAnchor, type Anchor } from './diffViewerUtils';
import type { SearchColumn } from './diffSearchModel';
import { CommentLineButton, type StartComment } from './CommentLineButton';

/**
 * One side-by-side row.
 *
 * Split out purely so it can be memoised — see the note on `InlineDiffRow`. It
 * matters most here: the splitter width lives on the table's `<colgroup>`, not
 * on the rows, so dragging it needs no row to change at all. Without the memo,
 * every pointer move rebuilt the entire table.
 */
export const SplitDiffRow = memo(function SplitDiffRow({
  row,
  rowIndex,
  showLeft,
  showRight,
  bothSides,
  onStartComment,
  threadBadges,
  renderContent,
  leftSelected = false,
  rightSelected = false,
}: {
  row: SideBySideRow;
  rowIndex: number;
  showLeft: boolean;
  showRight: boolean;
  bothSides: boolean;
  onStartComment?: StartComment;
  leftSelected?: boolean;
  rightSelected?: boolean;
  threadBadges(anchor: Anchor | null): ReactNode;
  renderContent?(column: SearchColumn, rowKey: string, text: string): ReactNode;
}) {
  const left = row.left;
  const right = row.right;
  const leftAnchor = left ? lineAnchor(left, 'left') : null;
  const rightAnchor = right ? lineAnchor(right, 'right') : null;
  const leftCls = !left
    ? 'diff__line--empty'
    : left.type === 'del'
      ? 'diff__line--del'
      : left.type === 'context'
        ? 'diff__line--ctx'
        : '';
  const rightCls = !right
    ? 'diff__line--empty'
    : right.type === 'add'
      ? 'diff__line--add'
      : right.type === 'context'
        ? 'diff__line--ctx'
        : '';
  const leftBadges = threadBadges(leftAnchor);
  const rightBadges = threadBadges(rightAnchor);
  const ri = String(rowIndex);

  return (
    <tr data-diff-row={ri} className="diff__splitrow">
      {showLeft && (
        <>
          <td className="diff__gutter diff__gutter--old">
            {leftBadges && <span className="diff__badges">{leftBadges}</span>}
            {left?.oldLineNo ?? ''}
            <CommentLineButton anchor={leftAnchor} onStartComment={onStartComment} />
          </td>
          <td className={`diff__code diff__half diff__half--left ${leftCls}${leftSelected ? ' diff__line--comment-range' : ''}`}>
            <span data-comment-code="" data-comment-left={leftAnchor?.line}>
              {left ? renderContent
                ? renderContent('left', ri, left.content)
                : left.content || '\u00a0'
                : '\u00a0'}
            </span>
          </td>
        </>
      )}
      {bothSides && <td className="diff__splitter-col" />}
      {showRight && (
        <>
          <td className="diff__gutter diff__gutter--new">
            {rightBadges && <span className="diff__badges">{rightBadges}</span>}
            {right?.newLineNo ?? ''}
            <CommentLineButton anchor={rightAnchor} onStartComment={onStartComment} />
          </td>
          <td className={`diff__code diff__half diff__half--right ${rightCls}${rightSelected ? ' diff__line--comment-range' : ''}`}>
            <span data-comment-code="" data-comment-right={rightAnchor?.line}>
              {right ? renderContent
                ? renderContent('right', ri, right.content)
                : right.content || '\u00a0'
                : '\u00a0'}
            </span>
          </td>
        </>
      )}
    </tr>
  );
});
