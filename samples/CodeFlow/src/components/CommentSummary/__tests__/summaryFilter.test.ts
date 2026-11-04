import { describe, it, expect } from 'vitest';
import {
  countScopes,
  countThreads,
  filterThreadAuthors,
  filterThreads,
  scopeThreads,
  summaryAuthors,
  threadScope,
  type SummaryFilters,
} from '../summaryFilter';
import { DESCRIPTION_FILE, type CommentThread, type CommentThreadStatus } from '../../../types';

interface ThreadOpts {
  id: string;
  status?: CommentThreadStatus;
  closed?: boolean;
  filename?: string;
  body?: string;
  updatedAt?: string;
  isIssueComment?: boolean;
}

function makeThread(o: ThreadOpts): CommentThread {
  return {
    id: o.id,
    prKey: 'owner/repo#1',
    filename: o.filename ?? 'src/app.ts',
    side: 'right',
    line: 1,
    status: o.status ?? 'active',
    closed: o.closed,
    isIssueComment: o.isIssueComment,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: o.updatedAt ?? '2024-01-01T00:00:00Z',
    comments: [
      {
        id: `${o.id}-c1`,
        author: { login: 'alice' },
        body: o.body ?? 'a comment',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ],
  } as CommentThread;
}

const ALL: SummaryFilters = { active: true, resolved: true, closed: true };

describe('summary author filtering', () => {
  const authored = (id: string, login: string, name?: string): CommentThread => {
    const thread = makeThread({ id });
    thread.comments[0].author = { login, name };
    return thread;
  };

  it('deduplicates case-insensitive logins, keeps display names, and sorts the picker', () => {
    const threads = [
      authored('bot', 'copilot[bot]'),
      authored('alice1', 'alice'),
      authored('alice2', 'Alice', 'Alice Ng'),
      authored('alice3', 'ALICE'),
      authored('bob', 'bob', 'Bob'),
    ];
    expect(summaryAuthors(threads)).toEqual([
      { key: 'alice', login: 'Alice', label: 'Alice Ng' },
      { key: 'bob', login: 'bob', label: 'Bob' },
      { key: 'copilot[bot]', login: 'copilot[bot]', label: 'copilot[bot]' },
    ]);
  });

  it('distinguishes accounts with the same display name', () => {
    const threads = [authored('a', 'alex1', 'Alex'), authored('b', 'alex2', 'Alex')];
    expect(summaryAuthors(threads).map((author) => author.key)).toEqual(['alex1', 'alex2']);
    expect(filterThreadAuthors(threads, new Set(['alex1'])).map((thread) => thread.id))
      .toEqual(['b']);
  });

  it('filters whole threads by the starter, not the last reply', () => {
    const human = authored('human', 'Alice');
    human.comments.push(authored('bot-reply', 'copilot[bot]').comments[0]);
    const bot = authored('bot', 'copilot[bot]');
    bot.comments.push(authored('human-reply', 'bob').comments[0]);
    const threads = [human, bot];

    expect(summaryAuthors(threads).map((author) => author.key)).toEqual(['alice', 'copilot[bot]']);
    expect(filterThreadAuthors(threads, new Set(['copilot[bot]']))).toEqual([human]);
    expect(filterThreadAuthors(threads, new Set(['alice']))).toEqual([bot]);
    expect(human.comments).toHaveLength(2);
  });

  it('defaults to all authors and supports excluding every author', () => {
    const threads = [authored('a', 'alice'), authored('b', 'bob'), authored('c', 'carol')];
    expect(filterThreadAuthors(threads, new Set())).toEqual(threads);
    expect(filterThreadAuthors(threads, new Set(['alice', 'bob'])).map((thread) => thread.id))
      .toEqual(['c']);
    expect(filterThreadAuthors(threads, new Set(['alice', 'bob', 'carol']))).toEqual([]);
    expect(summaryAuthors([])).toEqual([]);
  });

  it('includes unknown authors and empty threads without crashing or hiding them by default', () => {
    const unknown = authored('unknown', '');
    const empty = { ...makeThread({ id: 'empty' }), comments: [] };
    const threads = [unknown, empty];
    expect(summaryAuthors(threads)).toEqual([{ key: '', login: '', label: 'Unknown author' }]);
    expect(filterThreadAuthors(threads, new Set())).toEqual(threads);
    expect(filterThreadAuthors(threads, new Set(['']))).toEqual([]);
  });

  it('leaves new authors selected while preserving exclusions', () => {
    const threads = [authored('bot', 'copilot[bot]'), authored('new', 'new-reviewer')];
    expect(filterThreadAuthors(threads, new Set(['copilot[bot]'])).map((thread) => thread.id))
      .toEqual(['new']);
  });
});

describe('countThreads', () => {
  it('buckets by GitHub status when not closed', () => {
    const counts = countThreads([
      makeThread({ id: '1', status: 'active' }),
      makeThread({ id: '2', status: 'active' }),
      makeThread({ id: '3', status: 'resolved' }),
    ]);
    expect(counts).toEqual({ active: 2, resolved: 1, closed: 0 });
  });

  it('counts closed threads only toward closed, regardless of status', () => {
    const counts = countThreads([
      makeThread({ id: '1', status: 'active', closed: true }),
      makeThread({ id: '2', status: 'resolved', closed: true }),
      makeThread({ id: '3', status: 'active' }),
    ]);
    expect(counts).toEqual({ active: 1, resolved: 0, closed: 2 });
  });
});

describe('filterThreads', () => {
  it('gates closed threads by the closed filter only', () => {
    const threads = [
      makeThread({ id: 'a', status: 'active', closed: true }),
      makeThread({ id: 'b', status: 'active' }),
    ];
    const hidden = filterThreads(threads, { ...ALL, closed: false }, '');
    expect(hidden.map((t) => t.id)).toEqual(['b']);

    const shown = filterThreads(threads, ALL, '');
    expect(shown.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('does not additionally filter a closed thread by its GitHub status', () => {
    const threads = [makeThread({ id: 'a', status: 'active', closed: true })];
    // active filter off, but closed on -> still visible because closed wins
    const result = filterThreads(threads, { active: false, resolved: false, closed: true }, '');
    expect(result.map((t) => t.id)).toEqual(['a']);
  });

  it('filters non-closed threads by their status bucket', () => {
    const threads = [
      makeThread({ id: 'a', status: 'active' }),
      makeThread({ id: 'b', status: 'resolved' }),
    ];
    const result = filterThreads(threads, { active: true, resolved: false, closed: true }, '');
    expect(result.map((t) => t.id)).toEqual(['a']);
  });

  it('matches search against filename and comment body', () => {
    const threads = [
      makeThread({ id: 'a', filename: 'src/pipeline.yml', body: 'nothing' }),
      makeThread({ id: 'b', filename: 'src/other.ts', body: 'fix the pipeline trigger' }),
      makeThread({ id: 'c', filename: 'src/misc.ts', body: 'unrelated' }),
    ];
    const result = filterThreads(threads, ALL, 'pipeline');
    expect(result.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('sorts newest updated first', () => {
    const threads = [
      makeThread({ id: 'old', updatedAt: '2024-01-01T00:00:00Z' }),
      makeThread({ id: 'new', updatedAt: '2024-03-01T00:00:00Z' }),
      makeThread({ id: 'mid', updatedAt: '2024-02-01T00:00:00Z' }),
    ];
    const result = filterThreads(threads, ALL, '');
    expect(result.map((t) => t.id)).toEqual(['new', 'mid', 'old']);
  });
});

describe('threadScope', () => {
  it('treats issue comments as top-level even when a filename came along', () => {
    // GitHub hands issue comments an empty filename, but a stale local record
    // could carry one; the explicit flag has to win.
    expect(threadScope(makeThread({ id: 'a', isIssueComment: true, filename: 'src/app.ts' })))
      .toBe('top');
  });

  it('treats an unanchored thread as top-level', () => {
    expect(threadScope(makeThread({ id: 'a', filename: '' }))).toBe('top');
    expect(threadScope(makeThread({ id: 'b', filename: '(unknown)' }))).toBe('top');
    expect(threadScope(makeThread({ id: 'c', filename: DESCRIPTION_FILE }))).toBe('top');
  });

  it('treats a thread anchored to a file as file-level', () => {
    expect(threadScope(makeThread({ id: 'a', filename: 'src/app.ts' }))).toBe('file');
  });
});

describe('countScopes', () => {
  it('counts each scope and the unfiltered total', () => {
    const counts = countScopes([
      makeThread({ id: '1', isIssueComment: true }),
      makeThread({ id: '2', filename: '' }),
      makeThread({ id: '3', filename: 'src/app.ts' }),
      makeThread({ id: '4', filename: 'src/other.ts' }),
    ]);
    expect(counts).toEqual({ all: 4, top: 2, file: 2 });
  });

  it('counts nothing for an empty PR', () => {
    expect(countScopes([])).toEqual({ all: 0, top: 0, file: 0 });
  });
});

describe('scopeThreads', () => {
  const threads = [
    makeThread({ id: 'issue', isIssueComment: true }),
    makeThread({ id: 'unanchored', filename: '' }),
    makeThread({ id: 'inline', filename: 'src/app.ts' }),
  ];

  it('passes everything through for "all"', () => {
    expect(scopeThreads(threads, 'all').map((t) => t.id)).toEqual([
      'issue',
      'unanchored',
      'inline',
    ]);
  });

  it('keeps only top-level threads for "top"', () => {
    expect(scopeThreads(threads, 'top').map((t) => t.id)).toEqual(['issue', 'unanchored']);
  });

  it('keeps only file-level threads for "file"', () => {
    expect(scopeThreads(threads, 'file').map((t) => t.id)).toEqual(['inline']);
  });

  it('narrows the status counts to the chosen scope', () => {
    const mixed = [
      makeThread({ id: 'a', isIssueComment: true, status: 'active' }),
      makeThread({ id: 'b', filename: 'src/app.ts', status: 'active' }),
      makeThread({ id: 'c', filename: 'src/app.ts', status: 'resolved' }),
    ];
    expect(countThreads(scopeThreads(mixed, 'file'))).toEqual({
      active: 1,
      resolved: 1,
      closed: 0,
    });
    expect(countThreads(scopeThreads(mixed, 'top'))).toEqual({
      active: 1,
      resolved: 0,
      closed: 0,
    });
  });

  it('composes with the status filters and the search', () => {
    const mixed = [
      makeThread({ id: 'a', isIssueComment: true, body: 'pipeline chatter' }),
      makeThread({ id: 'b', filename: 'src/app.ts', body: 'pipeline fix' }),
      makeThread({ id: 'c', filename: 'src/app.ts', body: 'unrelated' }),
      makeThread({ id: 'd', filename: 'src/app.ts', body: 'pipeline fix', closed: true }),
    ];
    const result = filterThreads(
      scopeThreads(mixed, 'file'),
      { ...ALL, closed: false },
      'pipeline',
    );
    expect(result.map((t) => t.id)).toEqual(['b']);
  });
});
