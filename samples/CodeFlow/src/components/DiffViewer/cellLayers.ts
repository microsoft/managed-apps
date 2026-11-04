/**
 * Composes the diff viewer's overlapping highlight layers into one flat plan.
 *
 * Three things want to colour the same line at the same time: find matches,
 * word-level change marks, and syntax tokens. They are not alternatives — a
 * search hit inside a string literal on a rewritten line is all three at once —
 * so they have to nest rather than take turns.
 *
 * ## Marks outside, tokens inside
 *
 * The nesting order is fixed, and not arbitrary. A find hit is addressed in the
 * DOM: the viewer looks its `<mark data-hit-id>` up by id and scrolls to it.
 * That only works while a hit is exactly one element, so a mark can never be
 * split. A syntax token has no such constraint — a token cut in half renders as
 * two spans with the same class and looks identical — so tokens are the layer
 * that gives way at a boundary.
 *
 * Hence: marks form the outer spans and define the cuts; tokens are sliced to
 * fit inside them.
 *
 * This module is pure and does no rendering, which is what makes the rule
 * testable without a DOM.
 */

import type { TokenKind, TokenRange } from '../../utils/syntax/tokens';

/**
 * An outer highlight: a find hit or a word-diff change.
 *
 * `hitId` is set only for find results, and becomes the `data-hit-id` attribute
 * the viewer scrolls to. Word-diff marks have no id because nothing navigates
 * between them.
 */
export interface MarkRange {
  start: number;
  end: number;
  className: string;
  /** React key; unique within the cell. */
  key: string;
  hitId?: string;
}

/** A run of text with a single syntax kind, or none. */
export interface Segment {
  text: string;
  kind: TokenKind | null;
}

/** A stretch of the line either inside one mark, or between marks. */
export interface LayeredPart {
  mark: MarkRange | null;
  segments: Segment[];
}

/**
 * Discard ranges that cannot be rendered and put the rest in order.
 *
 * Producers are expected to emit sorted, disjoint ranges already; this is the
 * belt to that braces. Overlaps are resolved by keeping the earlier range whole
 * and dropping the later one rather than truncating it, because a truncated
 * find hit would still carry its id while no longer covering its match.
 */
function normalize<T extends { start: number; end: number }>(ranges: readonly T[], len: number): T[] {
  const usable = ranges
    .filter((r) => r.end > r.start && r.start < len && r.end > 0)
    .map((r) => ({ ...r, start: Math.max(0, r.start), end: Math.min(len, r.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: T[] = [];
  let reach = 0;
  for (const r of usable) {
    if (r.start < reach) continue;
    out.push(r);
    reach = r.end;
  }
  return out;
}

/**
 * Cut `[from, to)` of `text` into segments along token boundaries.
 *
 * `cursor` is carried between calls so the whole line costs one pass over the
 * token list rather than one per part; it points at the first token that might
 * still be relevant.
 */
function segmentsIn(
  text: string,
  from: number,
  to: number,
  tokens: readonly TokenRange[],
  cursor: { i: number },
): Segment[] {
  const segments: Segment[] = [];
  let at = from;

  while (cursor.i < tokens.length && tokens[cursor.i].end <= from) cursor.i += 1;

  for (let i = cursor.i; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.start >= to) break;
    const start = Math.max(token.start, at);
    const end = Math.min(token.end, to);
    if (end <= start) continue;
    if (start > at) segments.push({ text: text.slice(at, start), kind: null });
    segments.push({ text: text.slice(start, end), kind: token.kind });
    at = end;
  }

  if (at < to) segments.push({ text: text.slice(at, to), kind: null });
  return segments;
}

/**
 * Build the render plan for one code cell.
 *
 * Returns parts in reading order covering the whole of `text`. A cell with no
 * marks and no tokens yields a single plain part, which callers generally
 * short-circuit before getting here.
 */
export function sliceLayers(
  text: string,
  marks: readonly MarkRange[],
  tokens: readonly TokenRange[],
): LayeredPart[] {
  const len = text.length;
  if (len === 0) return [];

  const outer = normalize(marks, len);
  const inner = normalize(tokens, len);
  const cursor = { i: 0 };
  const parts: LayeredPart[] = [];
  let at = 0;

  for (const mark of outer) {
    if (mark.start > at) {
      parts.push({ mark: null, segments: segmentsIn(text, at, mark.start, inner, cursor) });
    }
    parts.push({ mark, segments: segmentsIn(text, mark.start, mark.end, inner, cursor) });
    at = mark.end;
  }

  if (at < len) parts.push({ mark: null, segments: segmentsIn(text, at, len, inner, cursor) });
  return parts;
}

/**
 * Merge two mark layers, letting `overlay` win wherever they collide.
 *
 * `sliceLayers` resolves an overlap by dropping the later range whole, so simply
 * concatenating two sources would give one of them arbitrary, position-dependent
 * precedence. Here the base ranges are instead *clipped* around the overlay, so
 * a word-diff highlight keeps its colour on either side of a selected
 * occurrence rather than vanishing because something landed on top of it.
 *
 * A base range carrying a `hitId` is dropped rather than split: its id addresses
 * the element the viewer scrolls to, and a fragment would still claim the id
 * while no longer covering the match.
 */
export function overlayMarks(
  base: readonly MarkRange[],
  overlay: readonly MarkRange[],
): readonly MarkRange[] {
  if (overlay.length === 0) return base;
  if (base.length === 0) return overlay;

  const cuts = [...overlay].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MarkRange[] = [];

  for (const range of base) {
    const hits = cuts.filter((c) => c.end > range.start && c.start < range.end);
    if (hits.length === 0) {
      out.push(range);
      continue;
    }
    if (range.hitId) continue;

    let at = range.start;
    for (const cut of hits) {
      if (cut.start > at) out.push({ ...range, start: at, end: cut.start, key: `${range.key}+${at}` });
      at = Math.max(at, cut.end);
    }
    if (at < range.end) out.push({ ...range, start: at, end: range.end, key: `${range.key}+${at}` });
  }

  out.push(...cuts);
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}
