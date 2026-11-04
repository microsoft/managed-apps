/** A review range ends at `line`; a missing start means a single-line comment. */
export interface CommentRange {
  line: number;
  startLine?: number;
}

/** UI placement is the first line; GitHub's `line` remains the range end. */
export function commentTopLine({ startLine, line }: CommentRange): number {
  return startLine ?? line;
}

export function validStartLine(start: unknown, end: number): number | undefined {
  const value = typeof start === 'number' ? start : Number(start);
  return Number.isSafeInteger(value) && value > 0 && value < end ? value : undefined;
}

export function assertCommentRange({ startLine, line }: CommentRange): void {
  if (startLine !== undefined && (
    !Number.isSafeInteger(line) || validStartLine(startLine, line) !== startLine
  )) {
    throw new Error('A multi-line comment must start before its ending line on the same side.');
  }
}

export function commentLineLabel({ startLine, line }: CommentRange): string {
  return startLine === undefined ? String(line) : `${startLine}-${line}`;
}
