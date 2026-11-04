import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ParsedDiff } from '../../types';
import { toSideBySideRows, type SideBySideRow } from '../../utils/diffParser';
import type { DiffSideMode } from '../../utils/diffSide';
import { inCommentRange, lineAnchor, type Anchor } from './diffViewerUtils';
import type { SearchColumn } from './diffSearchModel';
import { SplitDiffRow } from './SplitDiffRow';
import type { StartComment } from './CommentLineButton';

interface DiffBodyProps {
  diff: ParsedDiff;
  onStartComment?: StartComment;
  commentRange?: Anchor | null;
  extrasRow(anchor: Anchor | null, colSpan: number, key: string): ReactNode;
  threadBadges(anchor: Anchor | null): ReactNode;
  /** Optional highlighter for the find feature; falls back to plain text. */
  renderContent?(column: SearchColumn, rowKey: string, text: string): ReactNode;
  /** Which side(s) to render. A single side collapses to one full-width pane. */
  sideMode?: DiffSideMode;
}

import { loadSplitRatio, saveSplitRatio } from '../../utils/preferences';

export function SplitDiff({
  diff,
  onStartComment,
  commentRange,
  extrasRow,
  threadBadges,
  renderContent,
  sideMode = 'both',
}: DiffBodyProps) {
  const sbsRows = useMemo(() => toSideBySideRows(diff), [diff]);
  const [splitPct, setSplitPct] = useState(loadSplitRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const showLeft = sideMode !== 'right';
  const showRight = sideMode !== 'left';
  const bothSides = sideMode === 'both';
  const colSpan = bothSides ? 5 : 2;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.min(80, Math.max(20, ((e.clientX - rect.left) / rect.width) * 100));
    setSplitPct(pct);
  }, []);

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setSplitPct((v) => { saveSplitRatio(v); return v; });
  }, []);

  // Suppress text selection while dragging.
  //
  // The end of the drag is watched at the document, not just on the wrapper,
  // because a drag can end somewhere the wrapper never hears about: the pointer
  // is cancelled, capture is lost, or the handle itself unmounts when the side
  // filter changes mid-drag. Miss it and `dragging` stays true forever — and
  // since this handler is on the document, that silently kills text selection
  // in the *entire* app until the file is changed.
  useEffect(() => {
    const onSelectStart = (e: Event) => { if (dragging.current) e.preventDefault(); };
    document.addEventListener('selectstart', onSelectStart);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
    return () => {
      dragging.current = false;
      document.removeEventListener('selectstart', onSelectStart);
      document.removeEventListener('pointerup', endDrag);
      document.removeEventListener('pointercancel', endDrag);
    };
  }, [endDrag]);

  const rows: ReactNode[] = [];

  sbsRows.forEach((row: SideBySideRow, ri) => {
    if (row.type === 'hunk') {
      rows.push(
        <tr key={`hunk-${ri}`} className="diff__hunkrow">
          <td className="diff__hunkhead" colSpan={colSpan}>
            {row.header}
          </td>
        </tr>,
      );
      return;
    }
    const left = row.left;
    const right = row.right;
    const leftAnchor = left ? lineAnchor(left, 'left') : null;
    const rightAnchor = right ? lineAnchor(right, 'right') : null;

    rows.push(
      <SplitDiffRow
        key={`row-${ri}`}
        row={row}
        rowIndex={ri}
        showLeft={showLeft}
        showRight={showRight}
        bothSides={bothSides}
        onStartComment={onStartComment}
        leftSelected={inCommentRange(leftAnchor, commentRange)}
        rightSelected={inCommentRange(rightAnchor, commentRange)}
        threadBadges={threadBadges}
        renderContent={renderContent}
      />,
    );

    if (showLeft) {
      const leftExtras = extrasRow(leftAnchor, colSpan, `l-${ri}`);
      if (leftExtras) rows.push(leftExtras);
    }
    if (showRight) {
      const rightExtras = extrasRow(rightAnchor, colSpan, `r-${ri}`);
      if (rightExtras) rows.push(rightExtras);
    }
  });

  const leftW = bothSides ? `${splitPct}%` : '100%';
  const rightW = bothSides ? `${100 - splitPct}%` : '100%';

  return (
    <div
      className="diff__split-wrap"
      ref={containerRef}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      <table className="diff__table diff__table--split">
        <colgroup>
          {showLeft && <col className="diff__col-gutter" />}
          {showLeft && <col style={{ width: leftW }} />}
          {bothSides && <col className="diff__col-splitter" />}
          {showRight && <col className="diff__col-gutter" />}
          {showRight && <col style={{ width: rightW }} />}
        </colgroup>
        <tbody>{rows}</tbody>
      </table>
      {bothSides && (
        <div
          className="diff__splitter-handle"
          style={{ left: leftW }}
          onPointerDown={onPointerDown}
        />
      )}
    </div>
  );
}
