import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommentThreadView } from '../CommentThread';
import type { CommentThread, PrSummary } from '../../../types';

const copyToClipboard = vi.fn(async (_text: string) => true);

// Only the clipboard is stubbed: the link the button hands it is exactly what
// this is testing, so `buildDeepLink` and friends stay real.
vi.mock('../../../utils/deepLink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/deepLink')>();
  return { ...actual, copyToClipboard: (text: string) => copyToClipboard(text) };
});

const pr = {
  coordinates: { owner: 'octo', name: 'repo', number: 42 },
  htmlUrl: 'https://github.com/octo/repo/pull/42',
} as PrSummary;

const mockCtx = {
  pr,
  commentBackendLabel: 'GitHub',
  currentUser: { login: 'alice' },
  prKey: 'octo/repo#42',
  actions: {
    addComment: vi.fn(),
    setThreadStatus: vi.fn(),
    editComment: vi.fn(),
    setThreadClosed: vi.fn(),
    deleteThread: vi.fn(),
  },
};

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => mockCtx,
}));

const NOW = '2024-01-01T00:00:00Z';

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 'PRRT_kwDOAbc',
    prKey: 'octo/repo#42',
    filename: 'src/app.ts',
    side: 'right',
    line: 12,
    status: 'active',
    comments: [{ id: '97166796', author: { login: 'alice' }, body: 'please fix', createdAt: NOW }],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function clickGithubLink() {
  fireEvent.click(screen.getByRole('button', { name: 'Copy the GitHub link to this comment' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  copyToClipboard.mockResolvedValue(true);
});

describe('GitHub comment link button', () => {
  it('sits alongside the CodeFlow deep-link button', () => {
    render(<CommentThreadView thread={thread()} />);
    expect(screen.getByRole('button', { name: 'Copy link to this comment' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Copy the GitHub link to this comment' }),
    ).toBeTruthy();
  });

  it('copies the GitHub URL rather than the CodeFlow deep link', async () => {
    render(<CommentThreadView thread={thread()} />);
    clickGithubLink();

    await waitFor(() =>
      expect(copyToClipboard).toHaveBeenCalledWith(
        'https://github.com/octo/repo/pull/42#discussion_r97166796',
      ),
    );
  });

  it('prefers the permalink GitHub gave the comment', async () => {
    render(
      <CommentThreadView
        thread={thread({
          comments: [
            {
              id: 'PRRC_kwDOAbc',
              author: { login: 'alice' },
              body: 'please fix',
              createdAt: NOW,
              htmlUrl: 'https://github.com/octo/repo/pull/42#discussion_r55',
            },
          ],
        })}
      />,
    );
    clickGithubLink();

    await waitFor(() =>
      expect(copyToClipboard).toHaveBeenCalledWith(
        'https://github.com/octo/repo/pull/42#discussion_r55',
      ),
    );
  });

  it('anchors a PR-level conversation comment as an issue comment', async () => {
    render(
      <CommentThreadView
        thread={thread({
          isIssueComment: true,
          filename: '',
          line: 0,
          comments: [
            { id: '225307116', author: { login: 'alice' }, body: 'ship it', createdAt: NOW },
          ],
        })}
      />,
    );
    clickGithubLink();

    await waitFor(() =>
      expect(copyToClipboard).toHaveBeenCalledWith(
        'https://github.com/octo/repo/pull/42#issuecomment-225307116',
      ),
    );
  });
});
