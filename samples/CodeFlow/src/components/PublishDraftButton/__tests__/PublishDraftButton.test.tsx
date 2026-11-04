import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { PublishDraftButton } from '../PublishDraftButton';
import type { GitUserRef, PrSummary } from '../../../types';

const publishDraft = vi.fn();

let pr: PrSummary | undefined;
let currentUser: GitUserRef | undefined;

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ({ pr, currentUser, actions: { publishDraft } }),
}));

function summary(over: Partial<PrSummary> = {}): PrSummary {
  return {
    coordinates: { owner: 'octo-org', name: 'octo-repo', number: 123 },
    nodeId: 'PR_abc',
    title: 'Add a thing',
    state: 'open',
    draft: true,
    merged: false,
    author: { login: 'octocat' },
    baseRef: 'main',
    baseSha: 'base',
    headRef: 'feature',
    headSha: 'head',
    ...over,
  };
}

beforeEach(() => {
  publishDraft.mockReset();
  publishDraft.mockImplementation(async () => {});
  pr = summary();
  currentUser = { login: 'octocat' };
});

describe('PublishDraftButton', () => {
  it('offers the author a way out of draft', () => {
    render(<PublishDraftButton />);
    expect(screen.getByRole('button', { name: /publish/i })).toBeTruthy();
  });

  it('renders nothing when the gate says this is not the viewer’s draft', () => {
    currentUser = { login: 'someone-else' };
    const { container } = render(<PublishDraftButton />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing on a pull request that is already open for review', () => {
    pr = summary({ draft: false });
    const { container } = render(<PublishDraftButton />);
    expect(container.innerHTML).toBe('');
  });

  it('publishes on click', async () => {
    render(<PublishDraftButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /publish/i }));
    });

    expect(publishDraft).toHaveBeenCalledTimes(1);
  });

  it('disables itself while the call is in flight, so one click is one publish', async () => {
    let finish = () => {};
    publishDraft.mockImplementation(
      () =>
        new Promise<void>((r) => {
          finish = () => r();
        }),
    );
    render(<PublishDraftButton />);
    const button = screen.getByRole('button', { name: /publish/i }) as HTMLButtonElement;

    act(() => {
      fireEvent.click(button);
    });
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(publishDraft).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it('shows why it failed rather than silently doing nothing', async () => {
    publishDraft.mockImplementation(async () => {
      throw new Error('Resource not accessible by integration');
    });
    render(<PublishDraftButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /publish/i }));
    });

    expect(screen.getByText(/Resource not accessible by integration/)).toBeTruthy();
    // And it stays clickable, because the fix may be outside the app.
    expect((screen.getByRole('button', { name: /publish/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('falls back to a readable message when the failure is not an Error', async () => {
    publishDraft.mockImplementation(async () => {
      throw 'nope';
    });
    render(<PublishDraftButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /publish/i }));
    });

    expect(screen.getByText(/Could not publish this pull request/)).toBeTruthy();
  });

  it('says nothing on success, because the state chip already changed', async () => {
    render(<PublishDraftButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /publish/i }));
    });

    expect(document.querySelector('.topbar__review-toast')).toBeNull();
  });
});
