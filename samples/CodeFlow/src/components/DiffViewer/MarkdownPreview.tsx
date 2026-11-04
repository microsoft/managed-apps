import { Fragment } from 'react';
import { MarkdownBody } from '../MarkdownBody/MarkdownBody';
import type { DiffSide } from '../../types';
import type { DiffSideMode } from '../../utils/diffSide';
import { commentLineLabel, commentTopLine } from '../../utils/commentRange';
import type { Anchor } from './diffViewerUtils';
import type { StartComment } from './CommentLineButton';
import type { FileComments } from './useFileComments';
import {
  markdownBlockStatusLabel,
  previewRangeLabel,
  type MarkdownPreviewBlock,
} from '../../utils/markdownPreview';

/**
 * The rendered half of a Markdown diff.
 *
 * Each block is laid out as gutter + body, exactly like the source view, so the
 * two read as the same document seen two ways: the line numbers on the left are
 * the ones a reviewer would quote, and the red/green wash is the same palette.
 * A block that was rewritten shows both versions stacked, before over after —
 * the closest a rendered view gets to a side-by-side line diff.
 */
export function MarkdownPreview({
  blocks, sideMode = 'both', onStartComment, composer, renderComposer,
}: {
  blocks: MarkdownPreviewBlock[];
  sideMode?: DiffSideMode;
  onStartComment?: StartComment;
  composer?: Anchor | null;
  renderComposer?: FileComments['renderComposer'];
}) {
  const composerBlock = composer ? blocks.findIndex((block) => {
    if (block.status === 'gap' || (sideMode !== 'both' && sideMode !== composer.side)) return false;
    if (block.status !== 'unchanged' && !(composer.side === 'left' ? block.oldText : block.newText)) return false;
    const anchor = blockAnchor(block, composer.side);
    return anchor && commentTopLine(composer) >= commentTopLine(anchor)
      && commentTopLine(composer) <= anchor.line;
  }) : -1;
  const editor = composer && renderComposer && (
    <div className="mdpreview__composer">
      {composerBlock === -1 && (
        <div className="composer__range">This draft's source lines are not shown in the preview.</div>
      )}
      {renderComposer('Comments are anchored to Markdown source lines.')}
    </div>
  );
  return (
    <div className="mdpreview">
      {blocks.length === 0 && <div className="diff__nopatch">Nothing to preview in this file.</div>}
      {blocks.map((block, index) => (
        <Fragment key={block.key}>
          <PreviewBlock block={block} sideMode={sideMode} onStartComment={onStartComment} />
          {composerBlock === index && editor}
        </Fragment>
      ))}
      {composerBlock === -1 && editor}
    </div>
  );
}

function blockAnchor(block: MarkdownPreviewBlock, side: DiffSide): Anchor | null {
  const start = side === 'left' ? block.oldStart : block.newStart;
  const end = (side === 'left' ? block.oldEnd : block.newEnd) ?? start;
  if (start == null || end == null) return null;
  return { side, line: end, ...(start < end ? { startLine: start } : {}) };
}

function PreviewBlock({ block, sideMode, onStartComment }: {
  block: MarkdownPreviewBlock;
  sideMode: DiffSideMode;
  onStartComment?: StartComment;
}) {
  if (block.status === 'gap') {
    return (
      <div className="mdpreview__gap" role="separator" aria-label="Skipped content">
        <span className="mdpreview__gap-label">{block.label || '…'}</span>
      </div>
    );
  }

  // Quote removals and left-only previews by their original source positions.
  const range =
    block.status === 'removed' || sideMode === 'left'
      ? previewRangeLabel(block.oldStart, block.oldEnd)
      : previewRangeLabel(block.newStart, block.newEnd);
  const word = markdownBlockStatusLabel(block.status);

  return (
    <div
      className={`mdpreview__block mdpreview__block--${block.status}`}
      role="group"
      aria-label={range ? `${word}, lines ${range}` : word}
    >
      <div className="mdpreview__gutter">
        <span className="mdpreview__lines">{range}</span>
        {block.added > 0 && <span className="mdpreview__add">+{block.added}</span>}
        {block.removed > 0 && <span className="mdpreview__del">−{block.removed}</span>}
      </div>
      <div className="mdpreview__body">
        {block.oldText !== '' && block.status !== 'unchanged' && (
          <PreviewSide text={block.oldText} side="left" block={block} onStartComment={onStartComment} />
        )}
        {block.newText !== '' && (
          <PreviewSide text={block.newText} side={sideMode === 'left' ? 'left' : 'right'}
            block={block} onStartComment={onStartComment} />
        )}
      </div>
    </div>
  );
}

function PreviewSide({ text, side, block, onStartComment }: {
  text: string;
  side: DiffSide;
  block: MarkdownPreviewBlock;
  onStartComment?: StartComment;
}) {
  const anchor = blockAnchor(block, side);
  const label = anchor
    ? `Comment on ${side} ${anchor.startLine === undefined ? 'line' : 'lines'} ${commentLineLabel(anchor)}`
    : '';
  return (
    <div className={`mdpreview__side mdpreview__side--${side === 'left' ? 'old' : 'new'}`}>
      {anchor && onStartComment && (
        <button className="mdpreview__comment" aria-label={label} title={label}
          onClick={() => onStartComment(anchor)}>
          + Comment on {side} {previewRangeLabel(commentTopLine(anchor), anchor.line)}
        </button>
      )}
      <MarkdownBody content={text} />
    </div>
  );
}
