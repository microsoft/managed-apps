import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ReviewLayout } from '../Layout';
import {
  SUMMARY_HEIGHT_KEY,
  DEFAULT_SUMMARY_HEIGHT,
  MIN_SUMMARY_HEIGHT,
  MIN_WORKAREA_HEIGHT,
} from '../../../utils/preferences';

vi.mock('../../../state/useCodeFlow', () => ({ useCodeFlow: vi.fn() }));
vi.mock('../../../settings/settingsStore', () => ({
  getSettings: () => ({ summaryOpenByDefault: true }),
}));

/*
 * `@microsoft/managed-apps` re-exports its subpaths without file extensions,
 * which Node's ESM resolver cannot follow, so *any* import chain that reaches
 * the connector takes this whole suite down at load time — 0 tests collected,
 * no clue which component pulled it in. Stubbing the package cuts that chain
 * once, at the boundary that is actually broken, instead of depending on every
 * topbar child being mocked out by name before it can be added.
 */
vi.mock('@microsoft/managed-apps/data', () => ({ getClient: () => ({}) }));
vi.mock('@microsoft/managed-apps/auth', () => ({ getUser: vi.fn() }));

vi.mock('../../BugSwarm/BugSwarm', () => ({ BugSwarm: () => null }));
vi.mock('../../FeedbackDialog/FeedbackDialog', () => ({ FeedbackDialog: () => null }));
vi.mock('../../SettingsDialog/SettingsDialog', () => ({ SettingsDialog: () => null }));
vi.mock('../../IterationBar/IterationBar', () => ({ IterationBar: () => null }));
vi.mock('../../DiffViewer/DiffViewer', () => ({ DiffViewer: () => <div>diff</div> }));
vi.mock('../../CommentSummary/CommentSummary', () => ({ CommentSummary: () => <div>summary</div> }));
vi.mock('../../CopyLinkButton/CopyLinkButton', () => ({ CopyLinkButton: () => null }));
vi.mock('../../ChecksPill/ChecksPill', () => ({ ChecksPill: () => null }));
vi.mock('../../MergeButton/MergeButton', () => ({ MergeButton: () => null }));
vi.mock('../../PublishDraftButton/PublishDraftButton', () => ({ PublishDraftButton: () => null }));
vi.mock('../RefreshTimer', () => ({ RefreshTimer: () => null }));
// CherryPickButton is deliberately left real: it is the topbar child with the
// deepest reach into the connector, so rendering it for real is what proves the
// stubs above it still hold. Mocking it out would pass either way, and the next
// child to arrive would be the one to discover they don't.

import { useCodeFlow } from '../../../state/useCodeFlow';
import { z } from 'zod';
import { appStorage } from '../../../storage';
const mockUseCodeFlow = vi.mocked(useCodeFlow);

/** Where the bottom of the window is in this fake layout. */
const VIEWPORT_BOTTOM = 800;

function mockCtx() {
  mockUseCodeFlow.mockReturnValue({
    pr: {
      title: 'A pull request',
      state: 'open',
      draft: false,
      merged: false,
      baseRef: 'main',
      headRef: 'topic',
      coordinates: { owner: 'o', name: 'r', number: 1 },
    },
    prKey: 'o/r#1',
    comparison: { files: [] },
    selectedFile: undefined,
    selectedFolder: undefined,
    seen: {},
    threads: [],
    actions: {
      reset: vi.fn(),
      submitReview: vi.fn(),
      selectFile: vi.fn(),
      selectFolder: vi.fn(),
      toggleSeen: vi.fn(),
      markAllSeen: vi.fn(),
    },
    commentBackendLabel: 'GitHub',
    reviewers: [],
    currentUser: undefined,
  } as unknown as ReturnType<typeof useCodeFlow>);
}

function renderLayout() {
  const { container } = render(<ReviewLayout />);
  const panel = container.querySelector('.bottompanel') as HTMLElement;
  // jsdom lays nothing out, so the panel's anchored bottom edge is fabricated.
  panel.getBoundingClientRect = () =>
    ({ bottom: VIEWPORT_BOTTOM, top: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
  const handle = container.querySelector('.bottompanel__resizer') as HTMLElement;
  if (handle) {
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
  }
  return { container, panel, handle };
}

/** Drag the handle to a y position, in viewport coordinates. */
function dragTo(handle: HTMLElement, clientY: number) {
  fireEvent.pointerDown(handle, { pointerId: 1, clientY: VIEWPORT_BOTTOM - DEFAULT_SUMMARY_HEIGHT });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY });
  fireEvent.pointerUp(handle, { pointerId: 1 });
}

describe('resizing the comment summary', () => {
  beforeEach(() => {
    mockCtx();
    window.innerHeight = VIEWPORT_BOTTOM;
  });

  it('opens at the default height, with no stored preference', () => {
    const { panel, handle } = renderLayout();

    expect(handle).not.toBeNull();
    expect(panel.style.height).toBe(`${DEFAULT_SUMMARY_HEIGHT}px`);
  });

  it('drops the handle and the fixed height when collapsed', () => {
    const { container, panel } = renderLayout();

    fireEvent.click(screen.getByRole('button', { name: /Comment summary/ }));

    expect(container.querySelector('.bottompanel__resizer')).toBeNull();
    expect(panel.style.height).toBe('');
  });

  it('grows the panel when dragged upwards, and remembers it', () => {
    const { panel, handle } = renderLayout();

    dragTo(handle, VIEWPORT_BOTTOM - 400);

    expect(panel.style.height).toBe('400px');
    expect(appStorage().ui.get(SUMMARY_HEIGHT_KEY, z.unknown())).toBe(400);
  });

  it('shrinks the panel when dragged downwards', () => {
    const { panel, handle } = renderLayout();

    dragTo(handle, VIEWPORT_BOTTOM - 150);

    expect(panel.style.height).toBe('150px');
  });

  it('never drags away the diff, or the panel itself', () => {
    const { panel, handle } = renderLayout();

    dragTo(handle, 0);
    expect(panel.style.height).toBe(`${VIEWPORT_BOTTOM - MIN_WORKAREA_HEIGHT}px`);

    dragTo(handle, VIEWPORT_BOTTOM + 200);
    expect(panel.style.height).toBe(`${MIN_SUMMARY_HEIGHT}px`);
  });

  it('ignores pointer movement that is not a drag', () => {
    const { panel, handle } = renderLayout();

    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 100 });

    expect(panel.style.height).toBe(`${DEFAULT_SUMMARY_HEIGHT}px`);
  });

  it('reopens at the height it was left at', () => {
    appStorage().ui.set(SUMMARY_HEIGHT_KEY, 365);

    const { panel } = renderLayout();

    expect(panel.style.height).toBe('365px');
  });

  it('resizes with the arrow keys, for reviewers without a pointer', () => {
    const { panel, handle } = renderLayout();

    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(panel.style.height).toBe(`${DEFAULT_SUMMARY_HEIGHT + 24}px`);

    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(panel.style.height).toBe(`${DEFAULT_SUMMARY_HEIGHT - 24}px`);
    expect(appStorage().ui.get(SUMMARY_HEIGHT_KEY, z.unknown())).toBe(DEFAULT_SUMMARY_HEIGHT - 24);
  });

  it('puts the panel back with a double-click, or Home', () => {
    const { panel, handle } = renderLayout();

    dragTo(handle, VIEWPORT_BOTTOM - 500);
    fireEvent.doubleClick(handle);
    expect(panel.style.height).toBe(`${DEFAULT_SUMMARY_HEIGHT}px`);

    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(panel.style.height).toBe(`${DEFAULT_SUMMARY_HEIGHT}px`);
    expect(appStorage().ui.get(SUMMARY_HEIGHT_KEY, z.unknown())).toBe(DEFAULT_SUMMARY_HEIGHT);
  });

  it('is announced as a resizable separator', () => {
    const { handle } = renderLayout();

    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle.getAttribute('aria-valuenow')).toBe(String(DEFAULT_SUMMARY_HEIGHT));
  });
});
