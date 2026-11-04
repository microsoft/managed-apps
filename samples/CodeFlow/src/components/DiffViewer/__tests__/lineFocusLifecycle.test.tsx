/**
 * Integration cover for the *lifecycle* of a cross-file search result.
 *
 * The sibling file proves a click arrives at the right line. This one proves
 * the request then goes away. Those are different failure modes, and the second
 * one is invisible to a mocked context: a hand-written `lineFocusRequest` in a
 * mock is a value that can never be consumed, so a viewer that quietly retains
 * requests forever looks identical to one that retires them properly.
 *
 * So these tests wire the REAL request lifecycle — `useLineFocus` and
 * `useFileSelection`, the same hooks the provider uses — to the REAL
 * DiffViewer, and drive it through the actions a reviewer actually has:
 * clicking a result, and opening a file from the tree.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect, useMemo, useState } from 'react';
import { render, act } from '@testing-library/react';
import { DiffViewer } from '../DiffViewer';
import { useLineFocus } from '../../../state/hooks/useLineFocus';
import { useFileSelection } from '../../../state/hooks/useFileSelection';
import { resetSettingsStoreForTests, updateSettings } from '../../../settings/settingsStore';
import type { CodeFlowState } from '../../../state/codeFlowContext';

vi.mock('../../../state/useCodeFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../state/useCodeFlow')>();
  return { ...actual, useCodeFlow: vi.fn(), useFileThreads: () => [] };
});

vi.mock('../../../services/githubService', () => ({
  GitHubService: { getFileContent: vi.fn().mockResolvedValue(undefined) },
}));

import { useCodeFlow } from '../../../state/useCodeFlow';
const mockUseCodeFlow = vi.mocked(useCodeFlow);

const A = 'src/a.ts';
const A_PATCH = [
  '@@ -1,4 +1,4 @@',
  ' const alpha = 1;',
  '-const beta = needle;',
  '+const beta = haystack;',
  ' const gamma = 3;',
].join('\n');

const B = 'src/b.ts';
const B_PATCH = [
  '@@ -1,3 +1,3 @@',
  ' const delta = 1;',
  '-const epsilon = old;',
  '+const epsilon = new;',
].join('\n');

const FILES = [
  { filename: A, status: 'modified', additions: 1, deletions: 1, changes: 2, patch: A_PATCH },
  { filename: B, status: 'modified', additions: 1, deletions: 1, changes: 2, patch: B_PATCH },
];

let scrolled: HTMLElement[] = [];
let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

/** The live actions the harness exposes, so a test can drive the real thing. */
interface Harness {
  focusLine(filename: string, side: 'left' | 'right', line: number): void;
  selectFile(filename: string): void;
  focusThread(threadId: string): void;
  state(): CodeFlowState;
}
let harness: Harness;

/**
 * Owns real CodeFlow state and wires the real navigation actions into the real
 * DiffViewer. Only the data-loading surface is stubbed; every action under test
 * is the production implementation.
 */
function Host({ initialFile }: { initialFile: string }) {
  const [state, setState] = useState<CodeFlowState>(() => ({
    comparison: { files: FILES, headSha: 'head' },
    selectedFile: initialFile,
    viewMode: 'inline',
    threads: [],
    prKey: 'o/r#1',
    toIndex: 1,
    pr: { coordinates: { owner: 'o', name: 'r', number: 1 } },
  } as unknown as CodeFlowState));

  const { focusLine, consumeLineFocus } = useLineFocus(setState);
  const { selectFile } = useFileSelection('o/r#1', setState);

  // Thread focus only needs to raise a request here; the viewer's handling of
  // it is what these tests are watching.
  const focusThread = useMemo(
    () => (threadId: string) =>
      setState((s) => ({ ...s, focusRequest: { threadId, seq: (s.focusRequest?.seq ?? 0) + 1 } })),
    [],
  );

  // Published after commit rather than during render: a test needs the live
  // actions, but reaching them by writing to an outer variable mid-render is
  // the kind of side effect this codebase lints against.
  useEffect(() => {
    harness = { focusLine, selectFile, focusThread, state: () => state };
  });

  mockUseCodeFlow.mockReturnValue({
    ...state,
    actions: { consumeLineFocus, selectFile, focusLine, setViewMode: vi.fn() },
  } as unknown as ReturnType<typeof useCodeFlow>);

  return <DiffViewer />;
}

async function settle(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitUntil(check: () => boolean, ms = 4000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !check()) {
    await settle(20);
  }
}

/** Wait for the landing loop to run out of retries and give up. */
async function waitForGiveUp(container: HTMLElement) {
  await waitUntil(() => container.querySelector('.diff__linenotice') !== null);
}

function landedOn(): string | undefined {
  return scrolled.at(-1)?.textContent ?? undefined;
}

beforeEach(() => {
  resetSettingsStoreForTests();
  scrolled = [];
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function scrollIntoViewStub(this: HTMLElement) {
    scrolled.push(this);
  };
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.clearAllMocks();
});

describe('a request is retired once the viewer is done with it', () => {
  it('consumes a request it landed on', async () => {
    render(<Host initialFile={A} />);

    act(() => { harness.focusLine(A, 'right', 2); });
    await waitUntil(() => scrolled.length > 0);

    expect(landedOn()).toContain('const beta = haystack;');
    await waitUntil(() => harness.state().lineFocusRequest === undefined);
    expect(harness.state().lineFocusRequest).toBeUndefined();
  });

  it('consumes a request it gave up on', async () => {
    const { container } = render(<Host initialFile={A} />);

    act(() => { harness.focusLine(A, 'right', 999); });
    await waitForGiveUp(container);

    expect(harness.state().lineFocusRequest).toBeUndefined();
  });

  it('consumes a request whose file the reviewer left before it resolved', async () => {
    render(<Host initialFile={A} />);

    act(() => { harness.focusLine(A, 'right', 999); });
    await settle(60);
    act(() => { harness.selectFile(B); });
    await settle(60);

    expect(harness.state().lineFocusRequest).toBeUndefined();
  });
});

describe('manual A -> B -> A return does not replay the jump', () => {
  // The defect this exists for: the landing effect used to depend on
  // selectedFile, so coming back to a file replayed whatever request was still
  // sitting in state — a scroll, and possibly a widened view, that the reviewer
  // never asked for on this visit.
  it('after a successful navigation', async () => {
    render(<Host initialFile={A} />);

    act(() => { harness.focusLine(A, 'right', 2); });
    await waitUntil(() => scrolled.length > 0);
    const afterClick = scrolled.length;

    act(() => { harness.selectFile(B); });
    await settle(60);
    act(() => { harness.selectFile(A); });
    await settle(300);

    expect(scrolled).toHaveLength(afterClick);
  });

  it('after a failed navigation', async () => {
    const { container } = render(<Host initialFile={A} />);

    act(() => { harness.focusLine(A, 'right', 999); });
    await waitForGiveUp(container);

    act(() => { harness.selectFile(B); });
    await settle(60);
    act(() => { harness.selectFile(A); });
    await settle(300);

    expect(scrolled).toHaveLength(0);
    // Nor does the old warning come back with the file.
    expect(container.querySelector('.diff__linenotice')).toBeNull();
  });

  it('after a navigation that widened the view to reveal a hidden line', async () => {
    updateSettings({ diffSide: 'right' });
    const { container } = render(<Host initialFile={A} />);

    act(() => { harness.focusLine(A, 'left', 2); });
    await waitUntil(() => scrolled.length > 0);
    expect(landedOn()).toContain('const beta = needle;');
    const afterClick = scrolled.length;

    act(() => { harness.selectFile(B); });
    await settle(60);
    act(() => { harness.selectFile(A); });
    await settle(300);

    // The widening is a per-file override, so it is still in force — that is
    // the reviewer's own view of this file now, not a replay. What must not
    // happen is the scroll: they came back under their own steam.
    expect(container.textContent).toContain('const beta = needle;');
    expect(scrolled).toHaveLength(afterClick);
  });

  it('still honours a genuinely new click on the same result', async () => {
    render(<Host initialFile={A} />);

    act(() => { harness.focusLine(A, 'right', 2); });
    await waitUntil(() => scrolled.length > 0);

    act(() => { harness.selectFile(B); });
    await settle(60);

    // Back via the search result rather than the file tree: this is a new
    // request, and it must land.
    act(() => { harness.focusLine(A, 'right', 2); });
    await waitUntil(() => scrolled.length > 1);

    expect(scrolled.length).toBeGreaterThan(1);
    expect(landedOn()).toContain('const beta = haystack;');
  });
});

describe('an unavailable warning belongs to the file that raised it', () => {
  it('does not follow the reviewer to another file', async () => {
    const { container } = render(<Host initialFile={A} />);

    act(() => { harness.focusLine(A, 'right', 999); });
    await waitForGiveUp(container);
    expect(container.querySelector('.diff__linenotice')).not.toBeNull();

    act(() => { harness.selectFile(B); });
    await settle(60);

    expect(container.querySelector('.diff__linenotice')).toBeNull();
  });

  it('is superseded by navigating to a thread', async () => {
    const { container } = render(<Host initialFile={A} />);

    act(() => { harness.focusLine(A, 'right', 999); });
    await waitForGiveUp(container);

    act(() => { harness.focusThread('t1'); });
    await settle(120);

    expect(container.querySelector('.diff__linenotice')).toBeNull();
  });

  // Two give-up cycles at 40 retries apiece do not fit in the default budget.
  it('is replaced, not stacked, by a second failed result', async () => {
    const { container } = render(<Host initialFile={A} />);

    act(() => { harness.focusLine(A, 'right', 999); });
    await waitForGiveUp(container);

    act(() => { harness.focusLine(A, 'left', 888); });
    await settle(60);
    // The old warning goes the moment the new attempt starts.
    expect(container.querySelector('.diff__linenotice')).toBeNull();

    await waitForGiveUp(container);
    expect(container.querySelectorAll('.diff__linenotice')).toHaveLength(1);
    expect(container.querySelector('.diff__linenotice')?.textContent).toContain('888');
  }, 15000);
});
