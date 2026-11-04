import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ReviewLayout } from '../Layout';
import { SIDEBAR_COLLAPSED_KEY } from '../../../utils/preferences';

vi.mock('../../../state/useCodeFlow', () => ({ useCodeFlow: vi.fn() }));
vi.mock('../../../settings/settingsStore', () => ({
  getSettings: () => ({ summaryOpenByDefault: false }),
}));

/*
 * `@microsoft/managed-apps` re-exports its subpaths without file extensions,
 * which Node's ESM resolver cannot follow, so *any* import chain that reaches
 * the connector takes this whole suite down at load time. Stubbing the package
 * cuts that chain at the boundary that is actually broken, so a new topbar
 * child cannot break this suite before someone thinks to mock it by name.
 */
vi.mock('@microsoft/managed-apps/data', () => ({ getClient: () => ({}) }));
vi.mock('@microsoft/managed-apps/auth', () => ({ getUser: vi.fn() }));

// The panels around the file explorer all want the real context; none of them
// are what this test is about.
vi.mock('../../BugSwarm/BugSwarm', () => ({ BugSwarm: () => null }));
vi.mock('../../FeedbackDialog/FeedbackDialog', () => ({ FeedbackDialog: () => null }));
vi.mock('../../SettingsDialog/SettingsDialog', () => ({ SettingsDialog: () => null }));
vi.mock('../../IterationBar/IterationBar', () => ({ IterationBar: () => null }));
vi.mock('../../DiffViewer/DiffViewer', () => ({ DiffViewer: () => <div>diff</div> }));
vi.mock('../../CommentSummary/CommentSummary', () => ({ CommentSummary: () => null }));
vi.mock('../../CopyLinkButton/CopyLinkButton', () => ({ CopyLinkButton: () => null }));
vi.mock('../../ChecksPill/ChecksPill', () => ({ ChecksPill: () => null }));
vi.mock('../../MergeButton/MergeButton', () => ({ MergeButton: () => null }));
vi.mock('../../CherryPickButton/CherryPickButton', () => ({ CherryPickButton: () => null }));
vi.mock('../../PublishDraftButton/PublishDraftButton', () => ({ PublishDraftButton: () => null }));
vi.mock('../RefreshTimer', () => ({ RefreshTimer: () => null }));

import { useCodeFlow } from '../../../state/useCodeFlow';
import { z } from 'zod';
import { appStorage } from '../../../storage';
const mockUseCodeFlow = vi.mocked(useCodeFlow);

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

const hideBtn = () => screen.getByRole('button', { name: 'Hide the file explorer' });
const showBtn = () => screen.getByRole('button', { name: 'Show the file explorer' });

describe('collapsing the file explorer', () => {
  beforeEach(() => {
    mockCtx();
  });

  it('starts open, with no stored preference', () => {
    const { container } = render(<ReviewLayout />);

    expect(container.querySelector('.workarea__side')).not.toBeNull();
    expect(container.querySelector('.workarea__rail')).toBeNull();
  });

  it('collapses the panel outright and offers a way back', () => {
    const { container } = render(<ReviewLayout />);

    fireEvent.click(hideBtn());

    expect(container.querySelector('.workarea__side')).toBeNull();
    // The drag handle goes with it — there is nothing left to resize.
    expect(container.querySelector('.workarea__resizer')).toBeNull();
    expect(showBtn()).toBeTruthy();
  });

  it('re-expands from the rail', () => {
    const { container } = render(<ReviewLayout />);

    fireEvent.click(hideBtn());
    fireEvent.click(showBtn());

    expect(container.querySelector('.workarea__side')).not.toBeNull();
    expect(container.querySelector('.workarea__rail')).toBeNull();
  });

  it('remembers the collapse on this screen', () => {
    render(<ReviewLayout />);
    fireEvent.click(hideBtn());
    expect(appStorage().ui.get(SIDEBAR_COLLAPSED_KEY, z.unknown())).toBe(true);

    const second = render(<ReviewLayout />);
    expect(second.container.querySelector('.workarea__rail')).not.toBeNull();
  });
});
