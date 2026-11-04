/**
 * Integration cover for clicking a cross-file search result.
 *
 * These deliberately render the *real* DiffViewer rather than a stub. The
 * whole risk in this feature lives in the seam between the raw patch the search
 * reads and the filtered diff the reviewer is looking at, so a test that mocks
 * the viewer — or that only asserts `focusLine` was called — proves nothing
 * about whether the reviewer actually arrives at the line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { DiffViewer } from '../DiffViewer';
import { resetSettingsStoreForTests, updateSettings } from '../../../settings/settingsStore';
import type { DiffSide } from '../../../types';

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: vi.fn(),
  useFileThreads: () => [],
}));

vi.mock('../../../services/githubService', () => ({
  GitHubService: { getFileContent: vi.fn().mockResolvedValue(undefined) },
}));

import { useCodeFlow } from '../../../state/useCodeFlow';
const mockUseCodeFlow = vi.mocked(useCodeFlow);

const CODE = 'src/app.ts';
const CODE_PATCH = [
  '@@ -1,4 +1,4 @@',
  ' const alpha = 1;',
  '-const beta = needle;',
  '+const beta = haystack;',
  ' const gamma = 3;',
].join('\n');

const DOC = 'docs/readme.md';
const DOC_PATCH = [
  '@@ -1,3 +1,3 @@',
  ' # Title',
  '-an old needle line',
  '+a new haystack line',
].join('\n');

const WS = 'src/ws.ts';
// A deletion and its replacement differing only in indentation: the collapse
// folds the pair into one context line and the deleted address disappears.
const WS_PATCH = [
  '@@ -1,3 +1,3 @@',
  ' const alpha = 1;',
  '-  const needle = 2;',
  '+\tconst needle = 2;',
].join('\n');

const FILES = [
  { filename: CODE, status: 'modified', additions: 1, deletions: 1, changes: 2, patch: CODE_PATCH },
  { filename: DOC, status: 'modified', additions: 1, deletions: 1, changes: 2, patch: DOC_PATCH },
  { filename: WS, status: 'modified', additions: 1, deletions: 1, changes: 2, patch: WS_PATCH },
];

/** Every element `scrollDiffRowIntoView` landed on, most recent last. */
let scrolled: HTMLElement[] = [];
let originalScrollIntoView: typeof Element.prototype.scrollIntoView;
/**
 * Stable across renders, because the landing effect depends on it. The real
 * provider's is `useCallback`-stable for the same reason; a fresh spy per
 * render would re-arm the effect and this file would be testing the mock.
 * What consuming actually *does* is covered in `lineFocusLifecycle.test.tsx`,
 * which runs the genuine hooks.
 */
const consumeLineFocus = vi.fn();

/**
 * The provider keeps one request object per click, so its identity is stable
 * until `focusLine` mints a new one. Mirror that here: a test that passes a
 * fresh object literal on every render would be asking the viewer to treat one
 * click as many, which is not a state the app can reach.
 */
let lastRequest: { filename: string; side: DiffSide; line: number; seq: number } | undefined;
function stableRequest(next?: { filename: string; side: DiffSide; line: number; seq: number }) {
  if (!next) return undefined;
  if (lastRequest && lastRequest.seq === next.seq) return lastRequest;
  lastRequest = next;
  return next;
}

function setCtx(opts: {
  file: string;
  viewMode?: 'inline' | 'split';
  lineFocusRequest?: { filename: string; side: DiffSide; line: number; seq: number };
  focusRequest?: { threadId: string; seq: number };
}) {
  mockUseCodeFlow.mockReturnValue({
    comparison: { files: FILES, headSha: 'head' },
    selectedFile: opts.file,
    selectedFolder: undefined,
    viewMode: opts.viewMode ?? 'inline',
    prKey: 'o/r#1',
    toIndex: 1,
    threads: [],
    pr: { coordinates: { owner: 'o', name: 'r', number: 1 } },
    focusRequest: opts.focusRequest,
    lineFocusRequest: stableRequest(opts.lineFocusRequest),
    actions: { setViewMode: vi.fn(), selectFile: vi.fn(), consumeLineFocus },
  } as unknown as ReturnType<typeof useCodeFlow>);
}

/** Let the landing loop's timers run for a fixed span. */
async function settle(ms = 400) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Long enough for the landing loop to exhaust its retry budget. */
const BUDGET = 40 * 50 + 500;

/**
 * Wait until `check` holds.
 *
 * Landing is a retry loop over real timers, and revealing a hidden line costs
 * an extra render before it can succeed. How long that takes depends on what
 * else the machine is doing, so waiting a fixed span is a guess that passes
 * alone and fails in a full suite. Poll instead.
 */
async function waitUntil(check: () => boolean, ms = 4000) {
  const deadline = Date.now() + ms;
  // Each sleep is its own act() scope on purpose: React flushes when the scope
  // closes, so a check made inside one long scope would never see the update
  // it is waiting for.
  while (Date.now() < deadline && !check()) {
    await settle(20);
  }
}

/** Wait for the reviewer to be scrolled somewhere, then report where. */
async function waitForLanding(count = 1): Promise<string | undefined> {
  await waitUntil(() => scrolled.length >= count);
  return landedOn();
}

/** The line text of the row we were last scrolled to. */
function landedOn(): string | undefined {
  return scrolled.at(-1)?.textContent ?? undefined;
}

beforeEach(() => {
  resetSettingsStoreForTests();
  scrolled = [];
  lastRequest = undefined;
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function scrollIntoViewStub(this: HTMLElement) {
    scrolled.push(this);
  };
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.clearAllMocks();
});

describe('cross-file result → ordinary inline and split diffs', () => {
  it('lands on an added line in inline view', async () => {
    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'right', line: 2, seq: 1 },
    });
    render(<DiffViewer />);
    expect(await waitForLanding()).toContain('const beta = haystack;');
  });

  it('lands on a deleted line in inline view', async () => {
    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'left', line: 2, seq: 1 },
    });
    render(<DiffViewer />);
    expect(await waitForLanding()).toContain('const beta = needle;');
  });

  it('lands on the right row in split view', async () => {
    setCtx({
      file: CODE,
      viewMode: 'split',
      lineFocusRequest: { filename: CODE, side: 'left', line: 2, seq: 1 },
    });
    render(<DiffViewer />);
    expect(await waitForLanding()).toContain('const beta = needle;');
  });

  it('ignores a request aimed at a different file', async () => {
    setCtx({
      file: CODE,
      lineFocusRequest: { filename: 'other/file.ts', side: 'right', line: 2, seq: 1 },
    });
    render(<DiffViewer />);
    await settle();

    expect(scrolled).toHaveLength(0);
  });
});

describe('cross-file result → Markdown preview', () => {
  it('leaves the rendered document for the source so the line can be shown', async () => {
    updateSettings({ markdownPreview: true });
    setCtx({ file: DOC });
    const { container, rerender } = render(<DiffViewer />);

    // Precondition: the preview really is up, and really has no diff rows.
    expect(container.querySelector('.mdpreview')).not.toBeNull();
    expect(container.querySelectorAll('[data-diff-row]')).toHaveLength(0);

    setCtx({
      file: DOC,
      lineFocusRequest: { filename: DOC, side: 'left', line: 2, seq: 1 },
    });
    rerender(<DiffViewer />);
    expect(await waitForLanding()).toContain('an old needle line');
    expect(container.querySelectorAll('[data-diff-row]').length).toBeGreaterThan(0);
  });

  it('does not disturb the preview for a line it cannot reach anyway', async () => {
    updateSettings({ markdownPreview: true });
    setCtx({
      file: DOC,
      lineFocusRequest: { filename: DOC, side: 'right', line: 404, seq: 1 },
    });
    const { container } = render(<DiffViewer />);
    await settle(BUDGET);

    expect(container.querySelector('.mdpreview')).not.toBeNull();
    expect(scrolled).toHaveLength(0);
  });
});

describe('cross-file result → hidden side', () => {
  it('widens a right-only view to reach a deleted line', async () => {
    updateSettings({ diffSide: 'right' });
    setCtx({ file: CODE });
    const { container, rerender } = render(<DiffViewer />);

    // Precondition: the deletion is genuinely not on screen.
    expect(container.textContent).not.toContain('const beta = needle;');

    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'left', line: 2, seq: 1 },
    });
    rerender(<DiffViewer />);
    expect(await waitForLanding()).toContain('const beta = needle;');
  });

  it('reveals locally without rewriting the saved preference', async () => {
    updateSettings({ diffSide: 'right' });
    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'left', line: 2, seq: 1 },
    });
    render(<DiffViewer />);
    await waitForLanding();

    // The reveal is a per-file override; the reviewer's global choice stands.
    const { getSettings } = await import('../../../settings/settingsStore');
    expect(getSettings().diffSide).toBe('right');
  });
});

describe('cross-file result → whitespace-collapsed hit', () => {
  it('shows whitespace again to reach a line the collapse folded away', async () => {
    updateSettings({ ignoreWhitespace: true });
    setCtx({ file: WS });
    const { container, rerender } = render(<DiffViewer />);

    // Precondition: the collapse really did hide the deleted line.
    expect(container.textContent).not.toContain('  const needle = 2;');

    setCtx({
      file: WS,
      lineFocusRequest: { filename: WS, side: 'left', line: 2, seq: 1 },
    });
    rerender(<DiffViewer />);
    expect(await waitForLanding()).toContain('const needle = 2;');
    expect(scrolled).not.toHaveLength(0);
  });

  it('leaves the collapse alone when the hit resolves without it', async () => {
    updateSettings({ ignoreWhitespace: true });
    setCtx({
      file: WS,
      lineFocusRequest: { filename: WS, side: 'right', line: 2, seq: 1 },
    });
    const { container } = render(<DiffViewer />);
    await waitForLanding();

    expect(scrolled).not.toHaveLength(0);
    // Still collapsed: the whitespace notice is the tell.
    expect(container.querySelector('.diff__wsnotice')).not.toBeNull();
  });
});

describe('a line that is in no rendering of the diff', () => {
  it('says so instead of failing silently', async () => {
    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'right', line: 999, seq: 1 },
    });
    const { container } = render(<DiffViewer />);
    await waitUntil(() => container.querySelector('.diff__linenotice') !== null);

    const notice = container.querySelector('.diff__linenotice');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('999');
    expect(scrolled).toHaveLength(0);
  });

  it('clears the warning once a later result lands', async () => {
    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'right', line: 999, seq: 1 },
    });
    const { container, rerender } = render(<DiffViewer />);
    await waitUntil(() => container.querySelector('.diff__linenotice') !== null);
    expect(container.querySelector('.diff__linenotice')).not.toBeNull();

    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'right', line: 2, seq: 2 },
    });
    rerender(<DiffViewer />);
    expect(await waitForLanding()).toContain('const beta = haystack;');

    expect(container.querySelector('.diff__linenotice')).toBeNull();
  });
});

describe('request lifecycle', () => {
  it('honours a repeated click on the same result', async () => {
    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'right', line: 2, seq: 1 },
    });
    const { rerender } = render(<DiffViewer />);
    await waitForLanding();
    expect(scrolled).toHaveLength(1);

    // Same address, new sequence number — the click must land again.
    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'right', line: 2, seq: 2 },
    });
    rerender(<DiffViewer />);
    expect(await waitForLanding(2)).toContain('const beta = haystack;');
    expect(scrolled).toHaveLength(2);
  });

  it('does not re-land an old request when the view changes underneath it', async () => {
    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'right', line: 2, seq: 1 },
    });
    const { rerender } = render(<DiffViewer />);
    await waitForLanding();
    expect(scrolled).toHaveLength(1);

    // The reviewer switches to split view. The request is unchanged, and a
    // completed landing must not be re-run — that is what used to drag them
    // back to a search hit they had moved on from.
    setCtx({
      file: CODE,
      viewMode: 'split',
      lineFocusRequest: { filename: CODE, side: 'right', line: 2, seq: 1 },
    });
    rerender(<DiffViewer />);
    await settle();

    expect(scrolled).toHaveLength(1);
  });

  it('lets a later thread focus win over an in-flight landing', async () => {
    // A line that needs the retry budget, so the loop is still running when the
    // reviewer picks a comment out of the summary.
    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'right', line: 999, seq: 1 },
    });
    const { container, rerender } = render(<DiffViewer />);
    await settle(100);

    setCtx({
      file: CODE,
      lineFocusRequest: { filename: CODE, side: 'right', line: 999, seq: 1 },
      focusRequest: { threadId: 't1', seq: 1 },
    });
    rerender(<DiffViewer />);
    await settle(BUDGET);

    // The abandoned landing must not post its failure over the top of the
    // navigation that replaced it.
    expect(scrolled).toHaveLength(0);
    expect(container.querySelector('.diff__linenotice')).toBeNull();
  });
});
