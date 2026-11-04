import { render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentThread, GitUserRef } from '../../../types';
import { MentionCandidatesProvider } from '../MentionCandidatesProvider';
import { MentionContext } from '../mentionContext';

const mockCtx: {
  pr: { author?: GitUserRef; coordinates: { owner: string; name: string; number: number } } | null;
  reviewers: { user: GitUserRef }[];
  threads: CommentThread[];
} = { pr: null, reviewers: [], threads: [] };

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => mockCtx,
}));

const getAuthenticatedUser = vi.fn(async (): Promise<GitUserRef | null> => ({ login: 'me' }));
const listCollaborators = vi.fn(async (_repo: { owner: string; name: string }): Promise<GitUserRef[]> => []);
const isCollaborator = vi.fn(async () => false);

vi.mock('../../../services/githubService', () => ({
  GitHubService: {
    getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...(a as [])),
    listCollaborators: (...a: unknown[]) => listCollaborators(...(a as [{ owner: string; name: string }])),
    isCollaborator: (...a: unknown[]) => isCollaborator(...(a as [])),
  },
}));

/** Renders the provider's candidate logins as a stable, assertable string. */
function Probe() {
  const source = useContext(MentionContext);
  return <div data-testid="logins">{source.candidates.map((u) => u.login).join(',')}</div>;
}

function logins() {
  return screen.getByTestId('logins').textContent;
}

function pr(owner: string, name: string) {
  return { coordinates: { owner, name, number: 1 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ login: 'me' });
  listCollaborators.mockResolvedValue([]);
  mockCtx.pr = null;
  mockCtx.reviewers = [];
  mockCtx.threads = [];
});

describe('MentionCandidatesProvider', () => {
  it('offers no candidates before a PR is loaded', () => {
    render(
      <MentionCandidatesProvider>
        <Probe />
      </MentionCandidatesProvider>,
    );
    expect(logins()).toBe('');
    expect(listCollaborators).not.toHaveBeenCalled();
  });

  it('loads the repo collaborator pool and includes the authenticated user', async () => {
    mockCtx.pr = pr('o', 'r');
    listCollaborators.mockResolvedValue([{ login: 'alice' }]);

    render(
      <MentionCandidatesProvider>
        <Probe />
      </MentionCandidatesProvider>,
    );

    await waitFor(() => expect(logins()).toContain('alice'));
    expect(logins()).toContain('me');
  });

  it('does not offer one repo pool while a different repo is showing', async () => {
    mockCtx.pr = pr('o', 'repo-a');
    listCollaborators.mockResolvedValue([{ login: 'alice' }]);

    const { rerender } = render(
      <MentionCandidatesProvider>
        <Probe />
      </MentionCandidatesProvider>,
    );
    await waitFor(() => expect(logins()).toContain('alice'));

    // Switch PRs to a different repo and hold the fetch open. The previous
    // repo's collaborators must not be offered in the meantime.
    let release: (users: GitUserRef[]) => void = () => {};
    listCollaborators.mockReturnValue(
      new Promise<GitUserRef[]>((resolve) => {
        release = resolve;
      }),
    );
    mockCtx.pr = pr('o', 'repo-b');
    rerender(
      <MentionCandidatesProvider>
        <Probe />
      </MentionCandidatesProvider>,
    );

    expect(logins()).not.toContain('alice');

    release([{ login: 'bob' }]);
    await waitFor(() => expect(logins()).toContain('bob'));
    expect(logins()).not.toContain('alice');
  });

  it('always offers PR participants, even before the pool resolves', async () => {
    mockCtx.pr = { ...pr('o', 'r'), author: { login: 'author' } };
    mockCtx.reviewers = [{ user: { login: 'reviewer' } }];
    listCollaborators.mockReturnValue(new Promise<GitUserRef[]>(() => {}));

    render(
      <MentionCandidatesProvider>
        <Probe />
      </MentionCandidatesProvider>,
    );

    expect(logins()).toContain('author');
    expect(logins()).toContain('reviewer');
  });

  it('ignores a fetch that resolves after the PR moved on', async () => {
    mockCtx.pr = pr('o', 'repo-a');
    let release: (users: GitUserRef[]) => void = () => {};
    listCollaborators.mockReturnValue(
      new Promise<GitUserRef[]>((resolve) => {
        release = resolve;
      }),
    );

    const { rerender } = render(
      <MentionCandidatesProvider>
        <Probe />
      </MentionCandidatesProvider>,
    );

    mockCtx.pr = pr('o', 'repo-b');
    listCollaborators.mockResolvedValue([{ login: 'bob' }]);
    rerender(
      <MentionCandidatesProvider>
        <Probe />
      </MentionCandidatesProvider>,
    );

    release([{ login: 'stale' }]);
    await waitFor(() => expect(logins()).toContain('bob'));
    expect(logins()).not.toContain('stale');
  });
});
