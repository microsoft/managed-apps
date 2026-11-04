import { describe, it, expect } from 'vitest';
import { diffHasLine, planLineReveal, type RevealPresentation } from '../lineReveal';
import { parsePatch } from '../../../utils/diffParser';
import { collapseWhitespaceOnlyChanges } from '../../../utils/whitespaceDiff';

const PATCH = [
  '@@ -1,4 +1,4 @@',
  ' const alpha = 1;',
  '-const beta = needle;',
  '+const beta = haystack;',
  ' const gamma = 3;',
].join('\n');

const raw = parsePatch(PATCH);

/** Everything shown: no preview, no collapse, both sides. */
const plain: RevealPresentation = {
  markdownPreview: false,
  ignoreWhitespace: false,
  sideMode: 'both',
};

describe('diffHasLine', () => {
  it('finds a deletion by its old line number and an addition by its new one', () => {
    expect(diffHasLine(raw, 'left', 2)).toBe(true);
    expect(diffHasLine(raw, 'right', 2)).toBe(true);
  });

  it('anchors context lines to the right', () => {
    expect(diffHasLine(raw, 'right', 1)).toBe(true);
    expect(diffHasLine(raw, 'left', 1)).toBe(false);
  });

  it('does not invent lines the diff never had', () => {
    expect(diffHasLine(raw, 'right', 99)).toBe(false);
  });
});

describe('planLineReveal — nothing in the way', () => {
  it('reports a visible line as visible', () => {
    expect(planLineReveal(raw, raw, { side: 'left', line: 2 }, plain)).toEqual({ kind: 'visible' });
  });

  it('reports a line no rendering contains as unavailable', () => {
    expect(planLineReveal(raw, raw, { side: 'right', line: 99 }, plain)).toEqual({
      kind: 'unavailable',
    });
  });
});

describe('planLineReveal — Markdown preview', () => {
  // A rendered document draws no diff rows at all, so every hit behind the
  // preview needs the source back before it can be scrolled to.
  it('turns the preview off even when the line is otherwise on screen', () => {
    const plan = planLineReveal(raw, raw, { side: 'left', line: 2 }, {
      ...plain,
      markdownPreview: true,
    });
    expect(plan).toEqual({
      kind: 'reveal',
      presentation: { markdownPreview: false, ignoreWhitespace: false, sideMode: 'both' },
    });
  });

  it('still refuses a line that is not in the diff at all', () => {
    const plan = planLineReveal(raw, raw, { side: 'right', line: 99 }, {
      ...plain,
      markdownPreview: true,
    });
    expect(plan).toEqual({ kind: 'unavailable' });
  });
});

describe('planLineReveal — hidden side', () => {
  it('widens to both sides for a deletion hidden by the right-only filter', () => {
    const plan = planLineReveal(raw, raw, { side: 'left', line: 2 }, {
      ...plain,
      sideMode: 'right',
    });
    expect(plan).toEqual({
      kind: 'reveal',
      presentation: { markdownPreview: false, ignoreWhitespace: false, sideMode: 'both' },
    });
  });

  it('widens to both sides for an addition hidden by the left-only filter', () => {
    const plan = planLineReveal(raw, raw, { side: 'right', line: 2 }, {
      ...plain,
      sideMode: 'left',
    });
    expect(plan).toEqual({
      kind: 'reveal',
      presentation: { markdownPreview: false, ignoreWhitespace: false, sideMode: 'both' },
    });
  });

  it('leaves the side filter alone when it is not hiding the line', () => {
    // Context lines survive both filters, so asking for one while the left side
    // is hidden must not widen the view the reviewer chose.
    expect(planLineReveal(raw, raw, { side: 'right', line: 1 }, { ...plain, sideMode: 'left' }))
      .toEqual({ kind: 'visible' });
  });
});

describe('planLineReveal — whitespace collapse', () => {
  const WS_PATCH = [
    '@@ -1,3 +1,3 @@',
    ' const alpha = 1;',
    '-  const needle = 2;',
    '+\tconst needle = 2;',
    ' const gamma = 3;',
  ].join('\n');

  const wsRaw = parsePatch(WS_PATCH);
  const wsCollapsed = collapseWhitespaceOnlyChanges(wsRaw).diff;

  it('really does lose the deleted side to the collapse', () => {
    // Guards the premise of the test below: collapsing rewrites the pair as one
    // context line carrying the *new* number, so the old address disappears.
    expect(diffHasLine(wsRaw, 'left', 2)).toBe(true);
    expect(diffHasLine(wsCollapsed, 'left', 2)).toBe(false);
  });

  it('shows whitespace again to reach a collapsed deletion', () => {
    const plan = planLineReveal(wsRaw, wsCollapsed, { side: 'left', line: 2 }, {
      ...plain,
      ignoreWhitespace: true,
    });
    expect(plan).toEqual({
      kind: 'reveal',
      presentation: { markdownPreview: false, ignoreWhitespace: false, sideMode: 'both' },
    });
  });

  it('keeps the collapse when the surviving right-side address still resolves', () => {
    expect(
      planLineReveal(wsRaw, wsCollapsed, { side: 'right', line: 2 }, {
        ...plain,
        ignoreWhitespace: true,
      }),
    ).toEqual({ kind: 'visible' });
  });

  it('undoes every filter at once when they all hide the line', () => {
    const plan = planLineReveal(wsRaw, wsCollapsed, { side: 'left', line: 2 }, {
      markdownPreview: true,
      ignoreWhitespace: true,
      sideMode: 'right',
    });
    expect(plan).toEqual({
      kind: 'reveal',
      presentation: { markdownPreview: false, ignoreWhitespace: false, sideMode: 'both' },
    });
  });
});
