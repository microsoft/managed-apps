import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ReviewLayout } from '../Layout';

vi.mock('../../../state/useCodeFlow', () => ({ useCodeFlow: vi.fn() }));
// Only `summaryOpenByDefault` is read directly; the rest of the store has to
// stay real because the search panel subscribes to it through `useSettings`.
vi.mock('../../../settings/settingsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../settings/settingsStore')>();
  return {
    ...actual,
    getSettings: () => ({ ...actual.getSettings(), summaryOpenByDefault: true }),
  };
});

// See resizeSummary.test.tsx: the connector package cannot be resolved by
// Node's ESM loader, so it is stubbed once at the boundary.
vi.mock('@microsoft/managed-apps/data', () => ({ getClient: () => ({}) }));
vi.mock('@microsoft/managed-apps/auth', () => ({ getUser: vi.fn() }));

vi.mock('../../BugSwarm/BugSwarm', () => ({ BugSwarm: () => null }));
vi.mock('../../FeedbackDialog/FeedbackDialog', () => ({ FeedbackDialog: () => null }));
vi.mock('../../SettingsDialog/SettingsDialog', () => ({ SettingsDialog: () => null }));
vi.mock('../../IterationBar/IterationBar', () => ({ IterationBar: () => null }));
vi.mock('../../DiffViewer/DiffViewer', () => ({ DiffViewer: () => <div>diff</div> }));
vi.mock('../../CommentSummary/CommentSummary', () => ({
  CommentSummary: () => <div>comment summary body</div>,
}));
vi.mock('../../CopyLinkButton/CopyLinkButton', () => ({ CopyLinkButton: () => null }));
vi.mock('../../ChecksPill/ChecksPill', () => ({ ChecksPill: () => null }));
vi.mock('../../MergeButton/MergeButton', () => ({ MergeButton: () => null }));
vi.mock('../../AutoMergeButton/AutoMergeButton', () => ({ AutoMergeButton: () => null }));
vi.mock('../../CherryPickButton/CherryPickButton', () => ({ CherryPickButton: () => null }));
vi.mock('../../PublishDraftButton/PublishDraftButton', () => ({ PublishDraftButton: () => null }));
vi.mock('../RefreshTimer', () => ({ RefreshTimer: () => null }));

import { useCodeFlow } from '../../../state/useCodeFlow';
const mockUseCodeFlow = vi.mocked(useCodeFlow);

const PATCH = ['@@ -1,2 +1,2 @@', ' keep me', '+add a needle here'].join('\n');

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
    comparison: {
      files: [
        { filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: PATCH },
      ],
    },
    selectedFile: undefined,
    selectedFolder: undefined,
    seen: {},
    threads: [],
    lineFocusRequest: undefined,
    actions: {
      reset: vi.fn(),
      submitReview: vi.fn(),
      selectFile: vi.fn(),
      selectFolder: vi.fn(),
      toggleSeen: vi.fn(),
      markAllSeen: vi.fn(),
      focusLine: vi.fn(),
    },
    commentBackendLabel: 'GitHub',
    reviewers: [],
    currentUser: undefined,
  } as unknown as ReturnType<typeof useCodeFlow>);
}

const searchTab = () => screen.getByRole('button', { name: /Search in files/ });
const commentsTab = () => screen.getByRole('button', { name: /Comment summary/ });
const searchInput = () =>
  screen.queryByLabelText('Search all files in the diff') as HTMLInputElement | null;

beforeEach(() => {
  mockCtx();
});

describe('the bottom panel tabs', () => {
  it('starts on the comment summary', () => {
    render(<ReviewLayout />);

    expect(screen.getByText('comment summary body')).toBeTruthy();
    expect(searchInput()).toBeNull();
  });

  it('switches to search results without collapsing the panel', () => {
    render(<ReviewLayout />);

    fireEvent.click(searchTab());

    expect(searchInput()).not.toBeNull();
    expect(screen.queryByText('comment summary body')).toBeNull();
  });

  it('collapses when the tab already showing is clicked again', () => {
    const { container } = render(<ReviewLayout />);

    fireEvent.click(searchTab());
    fireEvent.click(searchTab());

    expect(searchInput()).toBeNull();
    expect(container.querySelector('.bottompanel__resizer')).toBeNull();
  });

  it('reopens on the other tab when the panel is away', () => {
    render(<ReviewLayout />);

    fireEvent.click(commentsTab()); // collapse
    fireEvent.click(searchTab()); // reopen, on search

    expect(searchInput()).not.toBeNull();
  });
});

describe('Ctrl+Shift+F', () => {
  it('opens the search panel and focuses its input', () => {
    render(<ReviewLayout />);

    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true });

    const input = searchInput();
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('opens it even when the panel was collapsed', () => {
    render(<ReviewLayout />);
    fireEvent.click(commentsTab());

    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true });

    expect(searchInput()).not.toBeNull();
  });

  it('works on a Mac, with Cmd', () => {
    render(<ReviewLayout />);

    fireEvent.keyDown(window, { key: 'F', metaKey: true, shiftKey: true });

    expect(searchInput()).not.toBeNull();
  });

  it('seeds the query from the selection', () => {
    render(<ReviewLayout />);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '  needle  ',
    } as unknown as Selection);

    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true });

    expect(searchInput()?.value).toBe('needle');
    vi.restoreAllMocks();
  });

  it('keeps the previous query when nothing is selected', () => {
    render(<ReviewLayout />);
    fireEvent.click(searchTab());
    fireEvent.change(searchInput()!, { target: { value: 'kept' } });

    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true });

    expect(searchInput()?.value).toBe('kept');
  });

  it('is not triggered by plain Ctrl+F, which belongs to find-in-file', () => {
    render(<ReviewLayout />);

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });

    expect(searchInput()).toBeNull();
  });

  it('is not triggered by Ctrl+Alt+Shift+F', () => {
    render(<ReviewLayout />);

    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true, altKey: true });

    expect(searchInput()).toBeNull();
  });

  it('collapses the panel again on Escape', () => {
    render(<ReviewLayout />);
    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true });

    fireEvent.keyDown(searchInput()!, { key: 'Escape' });

    expect(searchInput()).toBeNull();
  });
});
