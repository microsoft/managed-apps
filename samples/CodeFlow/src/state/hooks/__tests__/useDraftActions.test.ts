import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CodeFlowState } from '../../codeFlowContext';
import type { PrSummary } from '../../../types';

const publishDraftPr = vi.fn();
vi.mock('../../../services/draft', () => ({
  publishDraft: (...args: unknown[]) => publishDraftPr(...args),
}));
vi.mock('../../../lib/logger', () => ({ createLogger: () => ({ info: vi.fn() }) }));

const { useDraftActions } = await import('../useDraftActions');

function pr(over: Partial<PrSummary> = {}): PrSummary {
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

/** A state container that applies updater functions the way `useState` does. */
function harness(initial: PrSummary | undefined) {
  let current = { pr: initial } as unknown as CodeFlowState;
  const setState = ((fn: unknown) => {
    if (typeof fn === 'function') {
      current = (fn as (prev: CodeFlowState) => CodeFlowState)(current);
    }
  }) as unknown as React.Dispatch<React.SetStateAction<CodeFlowState>>;
  return {
    setState,
    get state() {
      return current;
    },
  };
}

beforeEach(() => {
  publishDraftPr.mockReset();
  publishDraftPr.mockImplementation(async () => {});
});

describe('useDraftActions', () => {
  it('publishes the loaded pull request by its node id', async () => {
    const h = harness(pr());
    const { result } = renderHook(() => useDraftActions(h.state, h.setState));

    await act(async () => {
      await result.current.publishDraft();
    });

    expect(publishDraftPr).toHaveBeenCalledWith(
      { owner: 'octo-org', name: 'octo-repo', number: 123 },
      'PR_abc',
    );
  });

  it('clears the draft flag locally instead of waiting for a refresh', async () => {
    // The poll only re-reads the summary when the head sha moves, and
    // publishing pushes no commit — so without this the chip would keep saying
    // "Draft" until the pull request was reopened.
    const h = harness(pr());
    const { result } = renderHook(() => useDraftActions(h.state, h.setState));

    await act(async () => {
      await result.current.publishDraft();
    });

    expect(h.state.pr?.draft).toBe(false);
  });

  it('leaves the draft flag alone when the publish fails', async () => {
    publishDraftPr.mockImplementation(async () => {
      throw new Error('Resource not accessible');
    });
    const h = harness(pr());
    const { result } = renderHook(() => useDraftActions(h.state, h.setState));

    let caught: unknown;
    await act(async () => {
      caught = await result.current.publishDraft().then(
        () => undefined,
        (e: unknown) => e,
      );
    });

    expect((caught as Error).message).toBe('Resource not accessible');
    expect(h.state.pr?.draft).toBe(true);
  });

  it('does not touch a different pull request that loaded while the call was in flight', async () => {
    const h = harness(pr());
    const { result } = renderHook(() => useDraftActions(h.state, h.setState));
    const other = pr({ coordinates: { owner: 'octo-org', name: 'Other', number: 9 } });

    // The user navigates away before GitHub answers.
    publishDraftPr.mockImplementation(async () => {
      h.setState(() => ({ pr: other }) as unknown as CodeFlowState);
    });

    await act(async () => {
      await result.current.publishDraft();
    });

    expect(h.state.pr?.draft).toBe(true);
    expect(h.state.pr?.coordinates.name).toBe('Other');
  });

  it('does nothing at all when no pull request is loaded', async () => {
    const h = harness(undefined);
    const { result } = renderHook(() => useDraftActions(h.state, h.setState));

    await act(async () => {
      await result.current.publishDraft();
    });

    expect(publishDraftPr).not.toHaveBeenCalled();
  });
});
