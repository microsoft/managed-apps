import { describe, expect, it } from 'vitest';
import { describeCheckWarning, evaluateMergeGate, MERGE_METHODS } from '../mergeGate';
import type { ChecksSummary, PrCheck, PrSummary } from '../../../types';
import { tally } from '../../../services/checks/checksQuery';

function makePr(overrides: Partial<PrSummary> = {}): PrSummary {
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
    ...overrides,
  };
}

function check(outcome: PrCheck['outcome'], overrides: Partial<PrCheck> = {}): PrCheck {
  return { id: outcome, name: outcome, outcome, rawState: outcome, kind: 'check', isRequired: true, ...overrides };
}

function makeChecks(checks: PrCheck[] = []): ChecksSummary {
  return { checks, sha: 'head', ...tally(checks) };
}

const alice = { login: 'alice' };

describe('evaluateMergeGate — who may see it', () => {
  it('hides the button from everyone but the author', () => {
    const gate = evaluateMergeGate({ pr: makePr(), currentUser: { login: 'bob' } });
    expect(gate).toEqual({ visible: false, ready: false });
  });

  it('shows it to the author', () => {
    expect(evaluateMergeGate({ pr: makePr(), currentUser: alice }).visible).toBe(true);
  });

  it('matches the author regardless of how GitHub cased the login', () => {
    const gate = evaluateMergeGate({ pr: makePr({ author: { login: 'Alice' } }), currentUser: { login: 'aLiCe' } });
    expect(gate.visible).toBe(true);
  });

  it('hides it when nobody is signed in, rather than guessing', () => {
    expect(evaluateMergeGate({ pr: makePr() }).visible).toBe(false);
  });

  it('hides it when the PR has no author to compare against', () => {
    const gate = evaluateMergeGate({
      pr: makePr({ author: undefined as unknown as PrSummary['author'] }),
      currentUser: alice,
    });
    expect(gate.visible).toBe(false);
  });

  it('hides it when no PR is loaded', () => {
    expect(evaluateMergeGate({ currentUser: alice }).visible).toBe(false);
  });
});

describe('evaluateMergeGate — nothing left to merge', () => {
  it('hides it once the PR is merged', () => {
    expect(evaluateMergeGate({ pr: makePr({ merged: true }), currentUser: alice }).visible).toBe(false);
  });

  it('hides it on a closed PR', () => {
    expect(evaluateMergeGate({ pr: makePr({ state: 'closed' }), currentUser: alice }).visible).toBe(false);
  });
});

describe('evaluateMergeGate — visible but not yet ready', () => {
  it('blocks a draft and says so', () => {
    const gate = evaluateMergeGate({ pr: makePr({ draft: true }), currentUser: alice });
    expect(gate).toMatchObject({ visible: true, ready: false });
    expect(gate.reason).toMatch(/draft/i);
  });

  it('blocks a conflicting branch', () => {
    const gate = evaluateMergeGate({ pr: makePr({ mergeable: false }), currentUser: alice });
    expect(gate.ready).toBe(false);
    expect(gate.reason).toMatch(/conflict/i);
  });
});

describe('evaluateMergeGate — checks do not gate it', () => {
  it('stays ready when a check is failing, because this is not a CI gate', () => {
    const gate = evaluateMergeGate({ pr: makePr(), currentUser: alice });
    expect(gate).toEqual({ visible: true, ready: true });
  });

  it('has nowhere to pass a check result in, so no edit can quietly regate it', () => {
    const gate = evaluateMergeGate({ pr: makePr(), currentUser: alice });
    expect(gate.ready).toBe(true);
    expect(gate.reason).toBeUndefined();
  });

  it('still blocks a draft, which GitHub itself would refuse', () => {
    const gate = evaluateMergeGate({ pr: makePr({ draft: true }), currentUser: alice });
    expect(gate.reason).toMatch(/draft/i);
  });
});

describe('describeCheckWarning', () => {
  it('says nothing while the checks are still being read', () => {
    expect(describeCheckWarning(makeChecks([check('failure')]), true)).toBeUndefined();
  });

  it('says nothing when there are no checks to report', () => {
    expect(describeCheckWarning(undefined, false)).toBeUndefined();
    expect(describeCheckWarning(makeChecks(), false)).toBeUndefined();
  });

  it('says nothing when everything passed', () => {
    expect(describeCheckWarning(makeChecks([check('success'), check('neutral')]))).toBeUndefined();
  });

  it('counts a single failure in the singular', () => {
    expect(describeCheckWarning(makeChecks([check('failure')]))).toMatch(/^1 required check failing\./);
  });

  it('pluralises several failures', () => {
    expect(describeCheckWarning(makeChecks([check('failure'), check('failure'), check('failure')]))).toMatch(
      /^3 required checks failing\./,
    );
  });

  it('mentions pending checks on their own', () => {
    expect(describeCheckWarning(makeChecks([check('pending'), check('pending')]))).toMatch(
      /^2 required checks still running\./,
    );
  });

  it('reports failures and pending together, failures first', () => {
    const warning = describeCheckWarning(makeChecks([check('failure'), check('pending'), check('pending')]));
    expect(warning).toMatch(/^1 required check failing, 2 required checks still running\./);
  });

  it('makes clear the merge is still allowed, and who has the last word', () => {
    const warning = describeCheckWarning(makeChecks([check('failure')])) ?? '';
    expect(warning).toMatch(/merge anyway/i);
    expect(warning).toMatch(/GitHub will refuse/i);
  });

  it.each(['check', 'status'] as const)('ignores optional or unknown %s outcomes', (kind) => {
    expect(describeCheckWarning(makeChecks([
      check('failure', { kind, isRequired: false }),
      check('pending', { kind, isRequired: false }),
      check('failure', { kind, isRequired: undefined }),
      check('pending', { kind, isRequired: undefined }),
    ]))).toBeUndefined();
  });

  it('warns only about required outcomes in a mixed rollup', () => {
    expect(describeCheckWarning(makeChecks([
      check('failure', { kind: 'status' }),
      check('pending'),
      check('failure', { isRequired: false }),
      check('pending', { kind: 'status', isRequired: false }),
    ]))).toMatch(/^1 required check failing, 1 required check still running\./);
  });
});

describe('evaluateMergeGate — ready', () => {
  it('is ready for an open, non-draft PR owned by the signed-in user', () => {
    const gate = evaluateMergeGate({ pr: makePr(), currentUser: alice });
    expect(gate).toEqual({ visible: true, ready: true });
  });

  it('treats mergeable: undefined as "GitHub has not computed it yet", not as a conflict', () => {
    const gate = evaluateMergeGate({ pr: makePr({ mergeable: undefined }), currentUser: alice });
    expect(gate.ready).toBe(true);
  });
});

describe('MERGE_METHODS', () => {
  it('offers exactly the three strategies GitHub accepts', () => {
    expect(MERGE_METHODS.map((m) => m.value)).toEqual(['merge', 'squash', 'rebase']);
  });

  it('labels and explains each one', () => {
    for (const m of MERGE_METHODS) {
      expect(m.label).toBeTruthy();
      expect(m.hint).toBeTruthy();
    }
  });
});
