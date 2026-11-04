import type { ReactNode } from 'react';
import type { ParsedDiff } from '../../types';
import { inCommentRange, lineAnchor, type Anchor } from './diffViewerUtils';
import type { SearchColumn } from './diffSearchModel';
import { InlineDiffRow } from './InlineDiffRow';
import type { StartComment } from './CommentLineButton';
import type { DiffSideMode } from '../../utils/diffSide';

interface DiffBodyProps {
  diff: ParsedDiff;
  onStartComment?: StartComment;
  commentRange?: Anchor | null;
  sideMode?: DiffSideMode;
  extrasRow(anchor: Anchor | null, colSpan: number, key: string): ReactNode;
  threadBadges(anchor: Anchor | null): ReactNode;
  /** Optional highlighter for the find feature; falls back to plain text. */
  renderContent?(column: SearchColumn, rowKey: string, text: string): ReactNode;
}

export function InlineDiff({ diff, onStartComment, commentRange, sideMode = 'both', extrasRow, threadBadges, renderContent }: DiffBodyProps) {
  const rows: ReactNode[] = [];

  diff.hunks.forEach((hunk, hi) => {
    hunk.lines.forEach((line, li) => {
      const key = `${hi}-${li}`;
      if (line.type === 'hunk') {
        rows.push(
          <tr key={`hunk-${key}`} className="diff__hunkrow">
            <td className="diff__gutter" colSpan={2} />
            <td className="diff__marker" />
            <td className="diff__hunkhead">{line.content}</td>
          </tr>,
        );
        return;
      }
      if (line.type === 'meta') {
        rows.push(
          <tr key={`meta-${key}`} className="diff__metarow">
            <td className="diff__gutter" colSpan={2} />
            <td className="diff__marker" />
            <td className="diff__meta">{line.content}</td>
          </tr>,
        );
        return;
      }
      const leftAnchor = sideMode !== 'right' ? lineAnchor(line, 'left') : null;
      const rightAnchor = sideMode !== 'left' ? lineAnchor(line, 'right') : null;
      rows.push(
        <InlineDiffRow
          key={`line-${key}`}
          line={line}
          rowKey={key}
          onStartComment={onStartComment}
          showLeft={sideMode !== 'right'}
          showRight={sideMode !== 'left'}
          selected={inCommentRange(leftAnchor, commentRange) || inCommentRange(rightAnchor, commentRange)}
          threadBadges={threadBadges}
          renderContent={renderContent}
        />,
      );
      const leftExtras = extrasRow(leftAnchor, 4, `l-${key}`);
      const rightExtras = extrasRow(rightAnchor, 4, `r-${key}`);
      if (leftExtras) rows.push(leftExtras);
      if (rightExtras) rows.push(rightExtras);
    });
  });

  return (
    <table className="diff__table diff__table--inline">
      <tbody>{rows}</tbody>
    </table>
  );
}
