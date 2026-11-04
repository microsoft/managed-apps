import { describe, it, expect } from 'vitest';
import { sameThreads } from '../sameThreads';
import { canEditComment } from '../commentEdit';
import type { CommentThread } from '../../types';

function thread(over: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 't1',
    prKey: 'o/r#1',
    filename: 'a.ts',
    side: 'right',
    line: 10,
    status: 'active',
    comments: [
      {
        id: 'c1',
        author: { login: 'octocat' },
        body: 'looks good',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...over,
  } as CommentThread;
}

/** What a poll produces: the same conversation, freshly parsed. */
function reparse(list: CommentThread[]): CommentThread[] {
  return JSON.parse(JSON.stringify(list)) as CommentThread[];
}

describe('sameThreads', () => {
  it('is true for the same array', () => {
    const list = [thread()];
    expect(sameThreads(list, list)).toBe(true);
  });

  it('is true for a re-parsed copy — the case the poll actually hits', () => {
    const list = [thread(), thread({ id: 't2', line: 20 })];
    const fresh = reparse(list);
    expect(fresh).not.toBe(list);
    expect(fresh[0]).not.toBe(list[0]);
    expect(sameThreads(list, fresh)).toBe(true);
  });

  it('is true for two empty lists', () => {
    expect(sameThreads([], [])).toBe(true);
  });

  it('notices a thread appearing', () => {
    expect(sameThreads([thread()], [thread(), thread({ id: 't2' })])).toBe(false);
  });

  it('notices a thread disappearing', () => {
    expect(sameThreads([thread(), thread({ id: 't2' })], [thread()])).toBe(false);
  });

  it('notices a reply', () => {
    const before = thread();
    const after = thread({
      comments: [
        ...before.comments,
        { id: 'c2', author: { login: 'other' }, body: 'and another thing', createdAt: 'x' },
      ],
    });
    expect(sameThreads([before], [after])).toBe(false);
  });

  it('notices an edit to a comment body', () => {
    const after = reparse([thread()]);
    after[0].comments[0].body = 'actually, no';
    expect(sameThreads([thread()], after)).toBe(false);
  });

  it('notices a resolve', () => {
    expect(sameThreads([thread()], [thread({ status: 'resolved' })])).toBe(false);
  });

  it('notices a close', () => {
    expect(sameThreads([thread()], [thread({ closed: true })])).toBe(false);
  });

  it('notices a thread going outdated', () => {
    expect(sameThreads([thread()], [thread({ outdated: true })])).toBe(false);
  });

  it('notices a thread moving line', () => {
    expect(sameThreads([thread()], [thread({ line: 11 })])).toBe(false);
  });

  it('notices a thread moving side', () => {
    expect(sameThreads([thread()], [thread({ side: 'left' })])).toBe(false);
  });

  it('notices a thread moving file', () => {
    expect(sameThreads([thread()], [thread({ filename: 'b.ts' })])).toBe(false);
  });

  it('notices a change to updatedAt', () => {
    expect(sameThreads([thread()], [thread({ updatedAt: '2024-06-01T00:00:00Z' })])).toBe(false);
  });

  it('treats a reorder as a change', () => {
    const a = [thread(), thread({ id: 't2' })];
    const b = [thread({ id: 't2' }), thread()];
    expect(sameThreads(a, b)).toBe(false);
  });
});

/**
 * The fields with no text of their own.
 *
 * These decide whether a control is offered or how a thread sorts, so leaving
 * one out doesn't render wrongly — it suppresses the update that would have
 * fixed it, and the reviewer sits looking at a comment they can't edit. Each of
 * these was genuinely missing at one point.
 */
describe('sameThreads — changes with no visible text', () => {
  it('notices a nodeId arriving, so the Edit button can appear', () => {
    // The read path recovers node ids in a later pass, keyed by the comment's
    // own id — so the comment is otherwise byte-identical across the two polls.
    const me = { login: 'octocat' };
    const before = thread();
    const after = reparse([before]);
    after[0].comments[0].nodeId = 'IC_kwDO123';

    expect(canEditComment(before.comments[0], me)).toBe(false);
    expect(canEditComment(after[0].comments[0], me)).toBe(true);

    // If this were true, the state swap would be skipped and the button would
    // never appear.
    expect(sameThreads([before], after)).toBe(false);
  });

  it('notices a comment becoming local, which also gates Edit', () => {
    const after = reparse([thread()]);
    after[0].comments[0].local = true;
    expect(sameThreads([thread()], after)).toBe(false);
  });

  it('notices the author changing, which gates Edit and drives the summary sort', () => {
    const after = reparse([thread()]);
    after[0].comments[0].author = { login: 'someone-else' };
    expect(sameThreads([thread()], after)).toBe(false);
  });

  it('notices a change inside the author, not just a different author object', () => {
    const after = reparse([thread()]);
    after[0].comments[0].author = { login: 'octocat', name: 'Octocat' };
    expect(sameThreads([thread()], after)).toBe(false);
  });

  it('notices an htmlUrl arriving, which is where the GitHub link points', () => {
    const after = reparse([thread()]);
    after[0].comments[0].htmlUrl = 'https://github.com/o/r/pull/1#discussion_r5';
    expect(sameThreads([thread()], after)).toBe(false);
  });

  it('notices bodyPrefix changing even though the body is untouched', () => {
    const after = reparse([thread()]);
    after[0].comments[0].bodyPrefix = '[a.ts:10] ';
    expect(after[0].comments[0].body).toBe(thread().comments[0].body);
    expect(sameThreads([thread()], after)).toBe(false);
  });

  it('notices a threadNodeId arriving, which is what resolve needs', () => {
    expect(sameThreads([thread()], [thread({ threadNodeId: 'PRRT_kwDO1' })])).toBe(false);
  });

  it('notices closedBy changing, which the status tooltip renders', () => {
    const closed = { closed: true, closedBy: { login: 'octocat', at: 'x' } } as Partial<CommentThread>;
    const after = { closed: true, closedBy: { login: 'someone-else', at: 'x' } } as Partial<CommentThread>;
    expect(sameThreads([thread(closed)], [thread(after)])).toBe(false);
  });

  it('still says nothing changed when a poll returns all of them unchanged', () => {
    // The point of the exhaustive compare is that it stays quiet on a no-op
    // poll — otherwise it would defeat itself and re-render every tick.
    const rich = thread({
      threadNodeId: 'PRRT_kwDO1',
      closed: true,
      closedBy: { login: 'octocat', at: 'x' },
      comments: [
        {
          id: 'c1',
          author: { login: 'octocat', name: 'Octocat', avatarUrl: 'a.png' },
          body: 'looks good',
          bodyPrefix: '[a.ts:10] ',
          createdAt: '2024-01-01T00:00:00Z',
          nodeId: 'IC_kwDO123',
          htmlUrl: 'https://github.com/o/r/pull/1#issuecomment-1',
          local: false,
        },
      ],
    } as Partial<CommentThread>);
    expect(sameThreads([rich], reparse([rich]))).toBe(true);
  });
});
