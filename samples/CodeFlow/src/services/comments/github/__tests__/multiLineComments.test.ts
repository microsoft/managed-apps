import { describe, expect, it } from 'vitest';
import { LocalCommentStore } from '../../LocalCommentStore';
import { decodeAnchor, encodeAnchoredBody, stripAnchor } from '../anchorMarker';
import { groupFlatComments, parseReviewThreads } from '../threadParser';
import { sameThreads } from '../../../../utils/sameThreads';
import { threadAnchorLabel, threadAnchorTitle } from '../../../../utils/threadAnchor';
import { findLineDraftAnchor, lineDraftKey, readDraft, writeDraft } from '../../../../utils/commentDrafts';
import type { CreateThreadInput } from '../../CommentStore';

const input: CreateThreadInput = {
  prKey: 'o/r#1', filename: 'src/a.ts', side: 'left', startLine: 3, line: 5,
  body: 'Consider simplifying this block', author: { login: 'alice' },
};

describe('multi-line thread persistence', () => {
  it('retains the range in local storage, replies, edits and status changes', async () => {
    const store = new LocalCommentStore();
    const thread = await store.createThread(input);
    await store.addComment(input.prKey, thread.id, 'reply', input.author);
    await store.editComment(input.prKey, thread.id, thread.comments[0].id, 'updated');
    await store.setStatus(input.prKey, thread.id, 'resolved');
    const [restored] = await store.listThreads(input.prKey);
    expect(restored).toMatchObject({ startLine: 3, line: 5, side: 'left', status: 'resolved' });
    expect(restored.comments.map((c) => c.body)).toEqual(['updated', 'reply']);
    expect(sameThreads([restored], [{ ...restored, startLine: 4 }])).toBe(false);
    expect(threadAnchorLabel(restored)).toBe('L3-5');
    expect(threadAnchorTitle({ ...restored, outdated: true })).toContain('Lines 3-5 on the left side when');
  });

  it('restores distinct range and single-line drafts without confusing filename separators', () => {
    const file = 'src/a|b.ts';
    const single = lineDraftKey(input.prKey, file, 'right', 5);
    const range = lineDraftKey(input.prKey, file, 'right', 5, 3);
    expect(single).not.toBe(range);
    writeDraft(range, 'range draft');
    expect(findLineDraftAnchor(input.prKey, file)).toEqual({ side: 'right', startLine: 3, line: 5 });
    expect(readDraft(range)).toBe('range draft');
    expect(findLineDraftAnchor('other/r#1', file)).toBeNull();
  });

  it('round-trips an out-of-diff range and quotes every selected line', () => {
    const body = encodeAnchoredBody(input.body, input, 'one\n  two\nthree');
    expect(body).toContain('**Lines 3-5**');
    expect(body).toContain('`one`\n> `  two`\n> `three`');
    expect(decodeAnchor(body)).toEqual({ line: 5, startLine: 3, side: 'left' });
    expect(stripAnchor(body)).toBe(input.body);
    const [thread] = parseReviewThreads(input.prKey, [{
      id: 'PRRT_1', line: 1, side: 'RIGHT', comments: [{ id: 1, body, path: input.filename }],
    }]);
    expect(thread).toMatchObject({ line: 5, startLine: 3, side: 'left' });
    expect(thread.comments[0].bodyPrefix + thread.comments[0].body).toBe(body);
  });

  it('rejects invalid ranges before storing anything', async () => {
    const store = new LocalCommentStore();
    await expect(store.createThread({ ...input, startLine: 5 })).rejects.toThrow('must start before');
    expect(await store.listThreads(input.prKey)).toEqual([]);
  });
});

describe('GitHub range reads', () => {
  it.each([
    { line: 12, start_line: 9, side: 'LEFT', start_side: 'LEFT' },
    { line: 12, startLine: 9, side: 'LEFT', startSide: 'LEFT' },
    { line: null, original_line: 12, original_start_line: 9, side: 'LEFT' },
    { line: null, originalLine: 12, originalStartLine: 9, side: 'LEFT' },
  ])('parses paired endpoints from grouped and flat responses: %j', (position) => {
    const comment = { id: 1, path: 'a.ts', body: 'range', ...position };
    for (const threads of [
      parseReviewThreads(input.prKey, [{ id: 'PRRT_1', comments: [comment] }]),
      groupFlatComments(input.prKey, [comment]),
    ]) {
      expect(threads[0]).toMatchObject({ side: 'left', startLine: 9, line: 12 });
    }
  });

  it('reads range endpoints from the thread envelope', () => {
    const [thread] = parseReviewThreads(input.prKey, [{
      id: 'PRRT_1', diffSide: 'LEFT', startDiffSide: 'LEFT', startLine: 9, line: 12,
      comments: [{ id: 1, body: 'range', path: 'a.ts' }],
    }]);
    expect(thread).toMatchObject({ side: 'left', startLine: 9, line: 12 });
  });

  it.each([false, true])('reads both endpoints from a GraphQL thread (outdated=%s)', (outdated) => {
    const [thread] = parseReviewThreads(input.prKey, [{
      id: 'PRRT_1', diffSide: 'LEFT', startDiffSide: 'LEFT', isOutdated: outdated,
      line: outdated ? null : 20, startLine: outdated ? null : 17,
      originalLine: 12, originalStartLine: 9,
      comments: { nodes: [{ id: 'PRRC_1', databaseId: 1, body: 'range', path: 'a.ts' }] },
    }]);
    expect(thread).toMatchObject({
      side: 'left', line: outdated ? 12 : 20, startLine: outdated ? 9 : 17,
    });
  });

  it('never pairs an original start with a current end', () => {
    const [thread] = groupFlatComments(input.prKey, [{
      id: 1, line: 20, start_line: null, original_line: 12, original_start_line: 9,
    }]);
    expect(thread.line).toBe(20);
    expect(thread.startLine).toBeUndefined();
  });

  it.each([0, -1, 12, 13, 1.5, 'bad'])('ignores invalid incoming start %s', (start_line) => {
    const [thread] = groupFlatComments(input.prKey, [{ id: 1, line: 12, start_line }]);
    expect(thread.startLine).toBeUndefined();
  });

  it('does not reinterpret an opposite-side start as same-side coordinates', () => {
    const [thread] = groupFlatComments(input.prKey, [{
      id: 1, side: 'RIGHT', line: 12, start_line: 9, start_side: 'LEFT',
    }]);
    expect(thread.startLine).toBeUndefined();
  });
});
