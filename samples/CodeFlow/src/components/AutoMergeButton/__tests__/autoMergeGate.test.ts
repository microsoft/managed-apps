import { describe, it, expect } from 'vitest';
import type { AutoMergeStatus } from '../../../services/autoMerge';
import type { PrSummary } from '../../../types';
import {
  describeAutoMerge,
  evaluateAutoMergeGate,
  shouldTrackAutoMerge,
} from '../autoMergeGate';

function pr(over: Partial<PrSummary> = {}): PrSummary {
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

const ALICE = { login: 'alice' };
const OFF: AutoMergeStatus = { enabled: false, viewerCanEnable: true };

describe('shouldTrackAutoMerge', () => {
  it('reads the state for the author, who is the only one offered the control', () => {
    expect(shouldTrackAutoMerge(pr(), ALICE)).toBe(true);
  });

  it('spends nothing on a reviewer’s session', () => {
    expect(shouldTrackAutoMerge(pr(), { login: 'bob' })).toBe(false);
  });

  it('ignores case, the way GitHub does', () => {
    expect(shouldTrackAutoMerge(pr({ author: { login: 'Alice' } }), ALICE)).toBe(true);
  });

  it('stops once the pull request is finished', () => {
    expect(shouldTrackAutoMerge(pr({ merged: true }), ALICE)).toBe(false);
    expect(shouldTrackAutoMerge(pr({ state: 'closed' }), ALICE)).toBe(false);
  });

  it('answers no before a pull request or a user is known', () => {
    expect(shouldTrackAutoMerge(undefined, ALICE)).toBe(false);
    expect(shouldTrackAutoMerge(pr(), undefined)).toBe(false);
  });
});

describe('evaluateAutoMergeGate', () => {
  it('hides the control from anyone but the author', () => {
    expect(
      evaluateAutoMergeGate({ pr: pr(), currentUser: { login: 'bob' }, autoMerge: OFF }),
    ).toMatchObject({ visible: false });
  });

  it('hides it once the pull request is merged or closed', () => {
    expect(
      evaluateAutoMergeGate({ pr: pr({ merged: true }), currentUser: ALICE, autoMerge: OFF }),
    ).toMatchObject({ visible: false });
    expect(
      evaluateAutoMergeGate({ pr: pr({ state: 'closed' }), currentUser: ALICE, autoMerge: OFF }),
    ).toMatchObject({ visible: false });
  });

  it('offers it when GitHub says the author could turn it on', () => {
    expect(evaluateAutoMergeGate({ pr: pr(), currentUser: ALICE, autoMerge: OFF })).toEqual({
      visible: true,
      ready: true,
    });
  });

  it('waits rather than guessing while the state is still loading', () => {
    const gate = evaluateAutoMergeGate({ pr: pr(), currentUser: ALICE, autoMergeLoading: true });
    expect(gate).toMatchObject({ visible: true, ready: false });
    expect(gate.reason).toMatch(/reading/i);
  });

  it('stays disabled when the state could not be read at all', () => {
    expect(evaluateAutoMergeGate({ pr: pr(), currentUser: ALICE })).toMatchObject({
      visible: true,
      ready: false,
    });
  });

  it('explains that a draft cannot be auto-merged', () => {
    const gate = evaluateAutoMergeGate({
      pr: pr({ draft: true }),
      currentUser: ALICE,
      autoMerge: OFF,
    });
    expect(gate).toMatchObject({ visible: true, ready: false });
    expect(gate.reason).toMatch(/draft/i);
  });

  it('points a mergeable pull request at the merge button instead', () => {
    const gate = evaluateAutoMergeGate({
      pr: pr({ mergeableState: 'clean' }),
      currentUser: ALICE,
      autoMerge: { enabled: false, viewerCanEnable: false },
    });
    expect(gate.ready).toBe(false);
    expect(gate.reason).toMatch(/merge it now/i);
  });

  it('blames the repository when GitHub refuses for any other reason', () => {
    const gate = evaluateAutoMergeGate({
      pr: pr({ mergeableState: 'blocked' }),
      currentUser: ALICE,
      autoMerge: { enabled: false, viewerCanEnable: false },
    });
    expect(gate.ready).toBe(false);
    expect(gate.reason).toMatch(/repository/i);
  });

  it('always lets the author turn it back off — even on a draft', () => {
    expect(
      evaluateAutoMergeGate({
        pr: pr({ draft: true, mergeableState: 'clean' }),
        currentUser: ALICE,
        autoMerge: { enabled: true, method: 'squash' },
      }),
    ).toEqual({ visible: true, ready: true });
  });

  it('lets it be turned off even while a refresh is in flight', () => {
    expect(
      evaluateAutoMergeGate({
        pr: pr(),
        currentUser: ALICE,
        autoMerge: { enabled: true },
        autoMergeLoading: true,
      }),
    ).toEqual({ visible: true, ready: true });
  });
});

describe('describeAutoMerge', () => {
  it('says nothing when auto-merge is off', () => {
    expect(describeAutoMerge(undefined)).toBeUndefined();
    expect(describeAutoMerge({ enabled: false })).toBeUndefined();
  });

  it('names the strategy and who armed it', () => {
    const text = describeAutoMerge({ enabled: true, method: 'squash', enabledBy: 'bob' });
    expect(text).toMatch(/squash/);
    expect(text).toMatch(/@bob/);
  });

  it('still says what will happen when the strategy is unreadable', () => {
    const text = describeAutoMerge({ enabled: true });
    expect(text).toMatch(/will merge/);
    expect(text).not.toMatch(/undefined/);
  });
});
