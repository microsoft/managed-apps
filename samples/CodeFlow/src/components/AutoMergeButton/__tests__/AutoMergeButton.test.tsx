import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AutoMergeButton } from '../AutoMergeButton';
import type { AutoMergeStatus } from '../../../services/autoMerge';
import type { GitUserRef, PrSummary } from '../../../types';

const enableAutoMerge = vi.fn(async () => {});
const disableAutoMerge = vi.fn(async () => {});

let pr: PrSummary | undefined;
let currentUser: GitUserRef | undefined;
let autoMerge: AutoMergeStatus | undefined;
let autoMergeLoading = false;

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ({
    pr,
    currentUser,
    autoMerge,
    autoMergeLoading,
    actions: { enableAutoMerge, disableAutoMerge },
  }),
}));

function makePr(over: Partial<PrSummary> = {}): PrSummary {
  return {
    coordinates: { owner: 'octo', name: 'repo', number: 7 },
    title: 'Do the thing',
    state: 'open',
    draft: false,
    merged: false,
    author: { login: 'alice' },
    baseRef: 'main',
    baseSha: 'base',
    headRef: 'feature',
    headSha: 'head',
    ...over,
  };
}

const trigger = () => screen.getByRole('button', { name: /auto-merge/i });

beforeEach(() => {
  enableAutoMerge.mockClear();
  enableAutoMerge.mockResolvedValue(undefined);
  disableAutoMerge.mockClear();
  disableAutoMerge.mockResolvedValue(undefined);
  pr = makePr();
  currentUser = { login: 'alice' };
  autoMerge = { enabled: false, viewerCanEnable: true };
  autoMergeLoading = false;
});

describe('AutoMergeButton', () => {
  it('renders nothing for someone who is not the author', () => {
    currentUser = { login: 'bob' };
    const { container } = render(<AutoMergeButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the author a way to arm it', () => {
    render(<AutoMergeButton />);
    expect(trigger()).toBeEnabled();
  });

  it('stays disabled, with GitHub’s reason, when it cannot be armed', () => {
    autoMerge = { enabled: false, viewerCanEnable: false };
    pr = makePr({ mergeableState: 'clean' });
    render(<AutoMergeButton />);
    expect(trigger()).toBeDisabled();
    expect(trigger().getAttribute('title')).toMatch(/merge it now/i);
  });

  it('does not arm on the first click — it asks first', () => {
    render(<AutoMergeButton />);
    fireEvent.click(trigger());
    expect(enableAutoMerge).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /enable auto-merge/i })).toBeInTheDocument();
  });

  it('names both branches, so the direction is unambiguous', () => {
    render(<AutoMergeButton />);
    fireEvent.click(trigger());
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('feature');
    expect(dialog.textContent).toContain('main');
  });

  it('arms it with a merge commit by default', async () => {
    render(<AutoMergeButton />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: /^Enable auto-merge$/ }));
    await waitFor(() => expect(enableAutoMerge).toHaveBeenCalledWith('merge'));
  });

  it('arms it with the strategy the author picked', async () => {
    render(<AutoMergeButton />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('radio', { name: /squash/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Enable auto-merge$/ }));
    await waitFor(() => expect(enableAutoMerge).toHaveBeenCalledWith('squash'));
  });

  it('lets the author back out', () => {
    render(<AutoMergeButton />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(enableAutoMerge).not.toHaveBeenCalled();
  });

  it('surfaces GitHub’s own refusal rather than a generic failure', async () => {
    enableAutoMerge.mockRejectedValue(new Error('Pull request is in clean status'));
    render(<AutoMergeButton />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: /^Enable auto-merge$/ }));
    await waitFor(() =>
      expect(screen.getByText(/Pull request is in clean status/)).toBeInTheDocument(),
    );
  });

  it('shows it as armed once auto-merge is on, and says what will happen', () => {
    autoMerge = { enabled: true, method: 'squash', enabledBy: 'alice' };
    render(<AutoMergeButton />);
    expect(trigger()).toHaveAttribute('aria-pressed', 'true');
    expect(trigger().textContent).toMatch(/auto-merge on/i);
    expect(trigger().getAttribute('title')).toMatch(/squash/);
  });

  it('turns it off from the same control', async () => {
    autoMerge = { enabled: true, method: 'merge' };
    render(<AutoMergeButton />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: /turn auto-merge off/i }));
    await waitFor(() => expect(disableAutoMerge).toHaveBeenCalled());
  });

  it('lets the author keep it on after opening the panel', () => {
    autoMerge = { enabled: true, method: 'merge' };
    render(<AutoMergeButton />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: /keep it on/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(disableAutoMerge).not.toHaveBeenCalled();
  });

  it('waits rather than offering a control it cannot yet honour', () => {
    autoMerge = undefined;
    autoMergeLoading = true;
    render(<AutoMergeButton />);
    expect(trigger()).toBeDisabled();
  });

  it('disappears once the PR is merged', () => {
    pr = makePr({ merged: true });
    const { container } = render(<AutoMergeButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
