/**
 * Renders one code cell from a layered plan.
 *
 * Split from {@link sliceLayers} so the composition rules can be tested without
 * a DOM, and so this file stays small enough to read in one go: it does nothing
 * but turn parts into elements.
 */

import { Fragment, type ReactNode } from 'react';
import type { TokenRange } from '../../utils/syntax/tokens';
import { tokenClass } from '../../utils/syntax/tokens';
import { sliceLayers, type LayeredPart, type MarkRange, type Segment } from './cellLayers';
import { DeferredSyntax } from './DeferredSyntax';

/**
 * Empty lines still need to occupy a row, and an empty text node collapses.
 * Every renderer in the viewer has always used a non-breaking space for this.
 */
const BLANK = '\u00a0';

function renderSegments(segments: Segment[], prefix: string): ReactNode[] {
  return segments.map((segment, i) =>
    segment.kind === null ? (
      segment.text
    ) : (
      <span key={`${prefix}-${i}`} className={tokenClass(segment.kind)}>
        {segment.text}
      </span>
    ),
  );
}

function renderPart(part: LayeredPart, index: number): ReactNode {
  const children = renderSegments(part.segments, String(index));
  // The unmarked stretches are wrapped in a keyed Fragment rather than returned
  // as a bare array, so React never has to key an array against its siblings.
  if (!part.mark) return <Fragment key={`p${index}`}>{children}</Fragment>;
  return (
    <mark
      key={part.mark.key}
      className={part.mark.className}
      data-hit-id={part.mark.hitId}
    >
      {children}
    </mark>
  );
}

/**
 * Compose marks and syntax tokens over a line of code.
 *
 * Falls straight through to plain text when there is nothing to draw, which is
 * the common case — most lines in most diffs carry neither a match nor a token.
 */
export function renderCell(
  text: string,
  marks: readonly MarkRange[],
  tokens: readonly TokenRange[],
  deferSyntax = false,
): ReactNode {
  if (text.length === 0) return BLANK;
  if (deferSyntax && tokens.length > 0) {
    return (
      <DeferredSyntax>
        {(visible) => renderCell(text, marks, visible ? tokens : [])}
      </DeferredSyntax>
    );
  }
  if (marks.length === 0 && tokens.length === 0) return text;
  const parts = sliceLayers(text, marks, tokens);
  if (parts.length === 0) return text;
  return parts.map(renderPart);
}
