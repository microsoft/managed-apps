import { describe, it, expect } from 'vitest';
import { evaluatePublishGate } from '../publishGate';
import type { PrSummary } from '../../../types';

function pr(over: Partial<PrSummary> = {}): PrSummary {
  return {
    coordinates: { owner: 'octo-org', name: 'octo-repo', number: 123 },
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

const AUTHOR = { login: 'octocat' };

describe('evaluatePublishGate', () => {
  it('shows the button on the author’s own draft', () => {
    expect(evaluatePublishGate({ pr: pr(), currentUser: AUTHOR })).toEqual({ visible: true });
  });

  it('stays hidden on a pull request that is already open for review', () => {
    expect(evaluatePublishGate({ pr: pr({ draft: false }), currentUser: AUTHOR }).visible).toBe(
      false,
    );
  });

  it('stays hidden on someone else’s draft', () => {
    // Publishing announces the work as finished on the author's behalf, which
    // is not a reviewer's call to make.
    expect(
      evaluatePublishGate({ pr: pr(), currentUser: { login: 'someone-else' } }).visible,
    ).toBe(false);
  });

  it('matches logins case-insensitively, the way GitHub does', () => {
    expect(
      evaluatePublishGate({ pr: pr({ author: { login: 'OctoCat' } }), currentUser: AUTHOR }).visible,
    ).toBe(true);
  });

  it('stays hidden when the pull request is closed or merged', () => {
    expect(evaluatePublishGate({ pr: pr({ state: 'closed' }), currentUser: AUTHOR }).visible).toBe(
      false,
    );
    expect(evaluatePublishGate({ pr: pr({ merged: true }), currentUser: AUTHOR }).visible).toBe(
      false,
    );
  });

  it('stays hidden while the pull request or the viewer is still unknown', () => {
    // Failing closed: an unresolved identity must not be treated as the author.
    expect(evaluatePublishGate({ pr: undefined, currentUser: AUTHOR }).visible).toBe(false);
    expect(evaluatePublishGate({ pr: pr(), currentUser: undefined }).visible).toBe(false);
    expect(evaluatePublishGate({ pr: pr({ author: undefined }), currentUser: AUTHOR }).visible).toBe(
      false,
    );
  });
});
