/**
 * The label that used to read "R0".
 *
 * Line zero cannot exist — files start at 1 — so every "R0" in the comment
 * summary was the UI faithfully rendering a number that meant "we don't know".
 * These tests pin the two things that has to stop being true: an unknown line
 * must not look like a real one, and a known-but-historical line must say so.
 */
import { describe, it, expect } from 'vitest';
import {
  hasAnchorLine,
  threadAnchorLabel,
  threadAnchorTitle,
  NO_LINE_LABEL,
} from '../threadAnchor';

describe('threadAnchorLabel', () => {
  it('writes the side and the line', () => {
    expect(threadAnchorLabel({ side: 'right', line: 857 })).toBe('R857');
    expect(threadAnchorLabel({ side: 'left', line: 42 })).toBe('L42');
  });

  it('never renders line zero', () => {
    // The regression this whole change exists to prevent.
    expect(threadAnchorLabel({ side: 'right', line: 0 })).toBe(NO_LINE_LABEL);
    expect(threadAnchorLabel({ side: 'left', line: 0 })).toBe(NO_LINE_LABEL);
    expect(threadAnchorLabel({ side: 'right', line: 0 })).not.toContain('0');
  });

  it('treats any impossible line as unknown', () => {
    expect(threadAnchorLabel({ side: 'right', line: -1 })).toBe(NO_LINE_LABEL);
    expect(threadAnchorLabel({ side: 'right', line: Number.NaN })).toBe(NO_LINE_LABEL);
  });

  it('shows an outdated line the same way as a live one', () => {
    // The number is the point — a reviewer needs it to go and check whether the
    // comment was addressed. The caveat belongs in the tooltip, not the label.
    expect(threadAnchorLabel({ side: 'right', line: 857, outdated: true })).toBe('R857');
  });
});

describe('threadAnchorTitle', () => {
  it('says the line is historical when the thread is outdated', () => {
    const title = threadAnchorTitle({ side: 'right', line: 857, outdated: true });
    expect(title).toContain('857');
    expect(title).toContain('when the comment was written');
    expect(title).toContain('may have moved');
  });

  it('states a live line plainly', () => {
    const title = threadAnchorTitle({ side: 'left', line: 42 });
    expect(title).toBe('Line 42 on the left side');
  });

  it('explains an absent line rather than leaving it bare', () => {
    expect(threadAnchorTitle({ side: 'right', line: 0 })).toContain('Line unknown');
  });
});

describe('hasAnchorLine', () => {
  it('is true only for a line a file could have', () => {
    expect(hasAnchorLine({ side: 'right', line: 1 })).toBe(true);
    expect(hasAnchorLine({ side: 'right', line: 0 })).toBe(false);
    expect(hasAnchorLine({ side: 'right', line: -2 })).toBe(false);
  });
});
