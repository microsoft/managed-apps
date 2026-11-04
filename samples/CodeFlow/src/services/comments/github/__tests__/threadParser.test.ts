import { describe, it, expect } from 'vitest';
import {
  toComment,
  parseReviewThreads,
  groupFlatComments,
  parseIssueComments,
  pickLine,
} from '../threadParser';
import { encodeIssueReplyBody, decodeIssueReplyParent } from '../issueReplyMarker';
import { encodeAnchoredBody, decodeAnchor } from '../anchorMarker';

describe('pickLine', () => {
  it('returns the first positive numeric candidate', () => {
    expect(pickLine(5)).toBe(5);
    expect(pickLine(null, 0, 7)).toBe(7);
    expect(pickLine('12')).toBe(12);
  });

  it('skips null, undefined, and non-positive values', () => {
    expect(pickLine(null, undefined)).toBe(0);
    expect(pickLine(0, -3)).toBe(0);
    expect(pickLine(null, 0, null, 42)).toBe(42);
  });

  it('prefers current line over the original anchor', () => {
    expect(pickLine(3, 99)).toBe(3);
    // current line null (outdated) => fall through to original
    expect(pickLine(null, 99)).toBe(99);
  });
});

describe('toComment', () => {
  it('extracts login from author string', () => {
    const c = toComment({ author: 'octocat', body: 'hi', id: '1' });
    expect(c.author.login).toBe('octocat');
    expect(c.body).toBe('hi');
    expect(c.id).toBe('1');
  });

  it('extracts login from author object', () => {
    const c = toComment({
      author: { login: 'user', avatar_url: 'http://a.png' },
      body: 'test',
      id: '2',
    });
    expect(c.author.login).toBe('user');
    expect(c.author.avatarUrl).toBe('http://a.png');
  });

  it('falls back to user object when no author', () => {
    const c = toComment({
      user: { login: 'fallback', avatarUrl: 'http://b.png' },
      body: 'x',
      id: '3',
    });
    expect(c.author.login).toBe('fallback');
    expect(c.author.avatarUrl).toBe('http://b.png');
  });

  it('derives id from html_url when id fields are missing', () => {
    const c = toComment({
      body: 'test',
      html_url: 'https://github.com/org/repo/pull/1#discussion_r12345',
    });
    expect(c.id).toBe('12345');
  });

  it('generates a fallback id when nothing is available', () => {
    const c = toComment({ body: 'orphan' });
    expect(c.id).toBeTruthy();
    expect(c.id.startsWith('c-')).toBe(true);
  });

  it('keeps GitHub’s own permalink for the comment', () => {
    const url = 'https://github.com/org/repo/pull/1#discussion_r12345';
    expect(toComment({ id: '1', body: '', html_url: url }).htmlUrl).toBe(url);
    expect(toComment({ id: '1', body: '', htmlUrl: url }).htmlUrl).toBe(url);
  });

  it('leaves htmlUrl unset when GitHub gave none', () => {
    expect(toComment({ id: '1', body: '' }).htmlUrl).toBeUndefined();
    expect(toComment({ id: '1', body: '', html_url: '' }).htmlUrl).toBeUndefined();
  });

  it('uses created_at or createdAt', () => {
    const c1 = toComment({ id: '1', body: '', created_at: '2024-01-01T00:00:00Z' });
    expect(c1.createdAt).toBe('2024-01-01T00:00:00Z');
    const c2 = toComment({ id: '2', body: '', createdAt: '2024-02-02T00:00:00Z' });
    expect(c2.createdAt).toBe('2024-02-02T00:00:00Z');
  });
});

describe('parseReviewThreads', () => {
  it('parses array of thread objects with comments', () => {
    const data = [
      {
        id: 'thread-1',
        is_resolved: false,
        comments: [
          { id: '100', path: 'src/app.ts', line: 5, side: 'RIGHT', body: 'nit', author: 'alice', created_at: '2024-01-01T00:00:00Z' },
          { id: '101', body: 'reply', author: 'bob', created_at: '2024-01-02T00:00:00Z' },
        ],
      },
    ];
    const threads = parseReviewThreads('owner/repo#1', data);
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('thread-1');
    expect(threads[0].filename).toBe('src/app.ts');
    expect(threads[0].line).toBe(5);
    expect(threads[0].side).toBe('right');
    expect(threads[0].status).toBe('active');
    expect(threads[0].comments).toHaveLength(2);
  });

  it('marks threads as resolved', () => {
    const data = [{ id: 't1', is_resolved: true, comments: [{ id: '1', body: 'x', path: 'a.ts', line: 1 }] }];
    const threads = parseReviewThreads('o/r#1', data);
    expect(threads[0].status).toBe('resolved');
  });

  it('reads GraphQL isResolved on the thread', () => {
    const row = {
      id: 'PRRT_1',
      isResolved: true,
      comments: { nodes: [{ id: 'PRRC_1', databaseId: 1, body: 'x', path: 'a.ts', line: 1 }] },
    };
    expect(parseReviewThreads('o/r#1', [row])[0].status).toBe('resolved');
  });

  it('handles wrapped data with review_threads key', () => {
    const data = {
      review_threads: [
        { id: 't1', comments: [{ id: '1', body: 'x', path: 'b.ts', line: 2, side: 'LEFT' }] },
      ],
    };
    const threads = parseReviewThreads('o/r#1', data);
    expect(threads).toHaveLength(1);
    expect(threads[0].side).toBe('left');
  });

  it('handles comments nested in {nodes: [...]}', () => {
    const data = [
      { id: 't1', comments: { nodes: [{ id: '1', body: 'nested', path: 'c.ts', line: 3 }] } },
    ];
    const threads = parseReviewThreads('o/r#1', data);
    expect(threads).toHaveLength(1);
    expect(threads[0].comments[0].body).toBe('nested');
  });

  it('skips threads with no comments', () => {
    const data = [{ id: 't1', comments: [] }];
    expect(parseReviewThreads('o/r#1', data)).toHaveLength(0);
  });

  it('uses originalLine (camelCase) when line is null for outdated comments', () => {
    const data = [
      {
        id: 't-outdated',
        comments: [
          { id: '1', path: 'src/a.ts', line: null, originalLine: 12, side: 'RIGHT', body: 'stale' },
        ],
      },
    ];
    const threads = parseReviewThreads('o/r#1', data);
    expect(threads[0].line).toBe(12);
  });

  it('uses original_line (snake_case) when line is null', () => {
    const data = [
      {
        id: 't-outdated2',
        comments: [
          { id: '1', path: 'src/a.ts', line: null, original_line: 8, body: 'stale' },
        ],
      },
    ];
    const threads = parseReviewThreads('o/r#1', data);
    expect(threads[0].line).toBe(8);
  });

  it('falls back to thread-level originalLine when comment lines are null', () => {
    const data = [
      {
        id: 't-outdated3',
        originalLine: 20,
        comments: [{ id: '1', path: 'src/a.ts', line: null, body: 'stale' }],
      },
    ];
    const threads = parseReviewThreads('o/r#1', data);
    expect(threads[0].line).toBe(20);
  });

  describe('outdated GraphQL threads', () => {
    /** GitHub reports `line: null` for an outdated thread and keeps `originalLine`. */
    const outdatedRow = (over: Record<string, unknown> = {}) => [
      {
        id: 'PRRT_kwDOExample0001',
        isResolved: true,
        isOutdated: true,
        path: 'src/a.cs',
        diffSide: 'RIGHT',
        line: null,
        originalLine: 857,
        comments: { nodes: [{ id: 'PRRC_1', databaseId: 1, body: 'stale', author: { login: 'octocat' } }] },
        ...over,
      },
    ];

    it('takes the line from originalLine', () => {
      expect(parseReviewThreads('o/r#1', outdatedRow())[0].line).toBe(857);
    });

    it('marks the thread outdated so the UI can caveat the line', () => {
      expect(parseReviewThreads('o/r#1', outdatedRow())[0].outdated).toBe(true);
    });

    it('leaves a live thread unmarked', () => {
      const data = [{ id: 't', comments: [{ id: '1', path: 'a.ts', line: 5, body: 'x' }] }];
      expect(parseReviewThreads('o/r#1', data)[0].outdated).toBeUndefined();
    });

    it('still prefers a current line over the original one', () => {
      const thread = parseReviewThreads('o/r#1', outdatedRow({ isOutdated: false, line: 813, originalLine: 718 }))[0];
      expect(thread.line).toBe(813);
    });

    it('takes side and path from the thread when the comment omits them', () => {
      const thread = parseReviewThreads('o/r#1', outdatedRow({ diffSide: 'LEFT', path: 'src/Controller.cs' }))[0];
      expect(thread.side).toBe('left');
      expect(thread.filename).toBe('src/Controller.cs');
    });

    it('still reports 0 when nothing anywhere knows the line', () => {
      const thread = parseReviewThreads('o/r#1', outdatedRow({ originalLine: null }))[0];
      expect(thread.line).toBe(0);
    });
  });

  it('falls back to groupFlatComments when data has no threads structure', () => {
    // An object with just a "comments" field (flat list)
    const data = {
      comments: [
        { id: '10', path: 'a.ts', line: 1, body: 'root', side: 'RIGHT', created_at: '2024-01-01' },
        { id: '11', in_reply_to_id: 10, body: 'reply', created_at: '2024-01-02' },
      ],
    };
    const threads = parseReviewThreads('o/r#1', data);
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('10');
    expect(threads[0].comments).toHaveLength(2);
  });

  it('returns empty for non-object data', () => {
    expect(parseReviewThreads('o/r#1', null)).toEqual([]);
    expect(parseReviewThreads('o/r#1', 'string')).toEqual([]);
  });
});

describe('groupFlatComments', () => {
  it('groups comments by in_reply_to_id', () => {
    const data = [
      { id: '10', path: 'x.ts', line: 1, side: 'RIGHT', body: 'root', created_at: '2024-01-01' },
      { id: '11', in_reply_to_id: 10, path: 'x.ts', line: 1, body: 'reply1', created_at: '2024-01-02' },
      { id: '12', in_reply_to_id: 10, path: 'x.ts', line: 1, body: 'reply2', created_at: '2024-01-03' },
      { id: '20', path: 'y.ts', line: 5, body: 'standalone', created_at: '2024-01-01' },
    ];
    const threads = groupFlatComments('o/r#1', data);
    expect(threads).toHaveLength(2);
    const t1 = threads.find((t) => t.id === '10');
    expect(t1!.comments).toHaveLength(3);
    const t2 = threads.find((t) => t.id === '20');
    expect(t2!.comments).toHaveLength(1);
  });

  it('sorts comments chronologically within a thread', () => {
    const data = [
      { id: '2', in_reply_to_id: 1, body: 'second', created_at: '2024-01-02' },
      { id: '1', body: 'first', path: 'a.ts', line: 1, created_at: '2024-01-01' },
    ];
    const threads = groupFlatComments('o/r#1', data);
    expect(threads[0].comments[0].body).toBe('first');
    expect(threads[0].comments[1].body).toBe('second');
  });

  it('returns empty for null/string input', () => {
    expect(groupFlatComments('o/r#1', null)).toEqual([]);
    expect(groupFlatComments('o/r#1', 'nope')).toEqual([]);
  });
});

describe('parseIssueComments', () => {
  it('creates one thread per issue comment', () => {
    const data = [
      { id: '100', body: 'PR comment', user: { login: 'alice' }, created_at: '2024-01-01' },
      { id: '101', body: 'Another one', user: { login: 'bob' }, created_at: '2024-01-02' },
    ];
    const threads = parseIssueComments('o/r#5', data);
    expect(threads).toHaveLength(2);
    expect(threads[0].filename).toBe('');
    expect(threads[0].line).toBe(0);
    expect(threads[0].status).toBe('active');
    expect(threads[0].comments[0].body).toBe('PR comment');
    expect(threads[1].comments[0].body).toBe('Another one');
  });

  it('handles wrapped object with comments key', () => {
    const data = { comments: [{ id: '1', body: 'test' }] };
    const threads = parseIssueComments('o/r#1', data);
    expect(threads).toHaveLength(1);
  });

  it('returns empty for non-array/non-object', () => {
    expect(parseIssueComments('o/r#1', null)).toEqual([]);
    expect(parseIssueComments('o/r#1', 42)).toEqual([]);
  });

  it('marks issue comments so replies take the issue-comment route', () => {
    const threads = parseIssueComments('o/r#5', [{ id: '1', body: 'hi' }]);
    expect(threads[0].isIssueComment).toBe(true);
  });

  it('folds a marked reply into the comment it answers', () => {
    const data = [
      { id: '100', body: 'PR comment', user: { login: 'alice' }, created_at: '2024-01-01' },
      {
        id: '101',
        body: encodeIssueReplyBody('my reply', '100', 'alice'),
        user: { login: 'bob' },
        created_at: '2024-01-02',
        updated_at: '2024-01-02',
      },
    ];
    const threads = parseIssueComments('o/r#5', data);
    expect(threads).toHaveLength(1);
    expect(threads[0].comments).toHaveLength(2);
    expect(threads[0].comments[1].body).toBe('my reply');
    expect(threads[0].comments[1].author.login).toBe('bob');
    expect(threads[0].updatedAt).toBe('2024-01-02');
  });

  it('folds a reply that arrives before its parent', () => {
    const data = [
      { id: '101', body: encodeIssueReplyBody('my reply', '100'), created_at: '2024-01-02' },
      { id: '100', body: 'PR comment', created_at: '2024-01-01' },
    ];
    const threads = parseIssueComments('o/r#5', data);
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('100');
    expect(threads[0].comments.map((c) => c.body)).toEqual(['PR comment', 'my reply']);
  });

  it('shows a reply on its own when the parent is gone', () => {
    const data = [
      { id: '101', body: encodeIssueReplyBody('orphaned', '404'), created_at: '2024-01-02' },
    ];
    const threads = parseIssueComments('o/r#5', data);
    expect(threads).toHaveLength(1);
    expect(threads[0].comments[0].body).toBe('orphaned');
  });
});

describe('out-of-diff anchor re-anchoring', () => {
  const marker = '<!-- codeflow:anchor line=42 side=right -->\n> **Line 42** · `const x = y;`\n<!-- /codeflow:anchor -->\n\nNeeds a null check';

  it('re-anchors a file-level thread to the line recorded in the marker', () => {
    // GitHub reports file-level comments at line 1 regardless of intent.
    const data = [
      {
        id: 'PRRT_1',
        comments: [{ id: '1', body: marker, path: 'src/a.ts', line: 1, subjectType: 'FILE' }],
      },
    ];
    const threads = parseReviewThreads('o/r#1', data);

    expect(threads).toHaveLength(1);
    expect(threads[0].line).toBe(42);
    expect(threads[0].side).toBe('right');
    expect(threads[0].filename).toBe('src/a.ts');
  });

  it('strips the marker so only the user text is displayed', () => {
    const data = [{ id: 'PRRT_1', comments: [{ id: '1', body: marker, path: 'src/a.ts', line: 1 }] }];
    const threads = parseReviewThreads('o/r#1', data);

    expect(threads[0].comments[0].body).toBe('Needs a null check');
    expect(threads[0].comments[0].body).not.toContain('codeflow:anchor');
  });

  it('honours a left-side marker over the reported side', () => {
    const leftMarker = '<!-- codeflow:anchor line=8 side=left -->\n<!-- /codeflow:anchor -->\n\nhi';
    const data = [{ id: 'PRRT_2', comments: [{ id: '2', body: leftMarker, path: 'a.ts', line: 1, side: 'RIGHT' }] }];
    const threads = parseReviewThreads('o/r#1', data);

    expect(threads[0].line).toBe(8);
    expect(threads[0].side).toBe('left');
  });

  it('leaves ordinary line threads alone', () => {
    const data = [{ id: 'PRRT_3', comments: [{ id: '3', body: 'plain comment', path: 'a.ts', line: 12 }] }];
    const threads = parseReviewThreads('o/r#1', data);

    expect(threads[0].line).toBe(12);
    expect(threads[0].comments[0].body).toBe('plain comment');
  });

  it('re-anchors in the flat-comment grouping path too', () => {
    const threads = groupFlatComments('o/r#1', [
      { id: 1, body: marker, path: 'src/a.ts', line: 1 },
    ]);

    expect(threads[0].line).toBe(42);
    expect(threads[0].comments[0].body).toBe('Needs a null check');
  });
});

describe('GraphQL comment bodies', () => {
  it('keeps the body exactly as GitHub stored it', () => {
    const body = "Until you read this method, you don't know what if (a && b) does.";
    expect(toComment({ id: 'PRRC_1', databaseId: 1, body }).body).toBe(body);
  });

  it('leaves an entity the author typed by hand alone', () => {
    expect(toComment({ id: '1', body: 'write &#39; for an apostrophe' }).body).toBe(
      'write &#39; for an apostrophe',
    );
  });
});

describe('preserving hidden markers across an edit', () => {
  // An edit writes `bodyPrefix + newBody` back to GitHub. If the prefix were
  // lost, saving an out-of-diff comment would drop its anchor (the thread jumps
  // to line 1) and saving a Description reply would drop its parent id (the
  // reply detaches). So the invariant that matters is that prefix + body is
  // exactly what was stored.
  it('keeps the anchor preamble off the body but available for a write-back', () => {
    const stored = encodeAnchoredBody('Looks wrong', { line: 42, side: 'right' }, 'const x = 1;');

    const c = toComment({ id: '1', body: stored });

    expect(c.body).toBe('Looks wrong');
    expect(c.bodyPrefix).toBeDefined();
    expect(c.bodyPrefix! + c.body).toBe(stored);
    expect(decodeAnchor(c.bodyPrefix!)).toEqual({ line: 42, side: 'right' });
  });

  it('keeps the reply preamble off the body but available for a write-back', () => {
    const stored = encodeIssueReplyBody('Agreed', '99', 'octodev');

    const [thread] = parseIssueComments('o/r#1', [
      { id: '99', body: 'Parent', user: { login: 'someone' } },
      { id: '100', body: stored, user: { login: 'octodev' } },
    ]);
    const reply = thread.comments[1];

    expect(reply.body).toBe('Agreed');
    expect(reply.bodyPrefix! + reply.body).toBe(stored);
    expect(decodeIssueReplyParent(reply.bodyPrefix!)).toBe('99');
  });

  it('keeps both preambles when a Description reply is also anchored', () => {
    // The two markers stack, and they have to be put back in the order they
    // were stripped or the outer one stops matching its own regex.
    const stored = encodeAnchoredBody(
      encodeIssueReplyBody('Agreed', '99', 'octodev'),
      { line: 7, side: 'left' },
    );

    const [thread] = parseIssueComments('o/r#1', [
      { id: '99', body: 'Parent', user: { login: 'someone' } },
      { id: '100', body: stored, user: { login: 'octodev' } },
    ]);
    const reply = thread.comments[1];

    expect(reply.body).toBe('Agreed');
    expect(reply.bodyPrefix! + reply.body).toBe(stored);
  });

  it('records no prefix for an ordinary comment', () => {
    // Nothing was stripped, so there is nothing to put back and the field stays
    // absent rather than an empty string nobody has to reason about.
    expect(toComment({ id: '1', body: 'just text' }).bodyPrefix).toBeUndefined();
  });
});

describe('carrying the node id an edit needs', () => {
  it('uses the GraphQL node id and keeps the database id as the identity', () => {
    const c = toComment({
      id: 'PRRC_kwDOnode',
      databaseId: 12345,
      body: 'x',
      url: 'https://github.com/octo-org/octo-repo/pull/7#discussion_r12345',
    });
    expect(c.nodeId).toBe('PRRC_kwDOnode');
    expect(c.id).toBe('12345');
    expect(c.htmlUrl).toBe('https://github.com/octo-org/octo-repo/pull/7#discussion_r12345');
  });

  it('falls back to REST node_id', () => {
    expect(toComment({ id: '12345', node_id: 'PRRC_rest', body: 'x' }).nodeId).toBe('PRRC_rest');
  });

  it('leaves nodeId unset when neither is available', () => {
    expect(toComment({ id: '12345', body: 'x' }).nodeId).toBeUndefined();
  });
});
