import { describe, it, expect } from 'vitest';
import {
  ariaSort,
  DEFAULT_SUMMARY_SORT,
  nextSort,
  sortHint,
  sortThreads,
  threadAuthor,
  type SummarySort,
} from '../summarySort';
import type { CommentThread, CommentThreadStatus, GitUserRef } from '../../../types';

interface ThreadOpts {
  id: string;
  author?: GitUserRef | null;
  filename?: string;
  line?: number;
  status?: CommentThreadStatus;
  closed?: boolean;
  updatedAt?: string;
}

function makeThread(o: ThreadOpts): CommentThread {
  const author = o.author === undefined ? { login: 'alice' } : o.author;
  return {
    id: o.id,
    prKey: 'owner/repo#1',
    filename: o.filename ?? 'src/app.ts',
    side: 'right',
    line: o.line ?? 1,
    status: o.status ?? 'active',
    closed: o.closed,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: o.updatedAt ?? '2024-01-01T00:00:00Z',
    comments: author
      ? [{ id: `${o.id}-c1`, author, body: 'a comment', createdAt: '2024-01-01T00:00:00Z' }]
      : [],
  } as CommentThread;
}

const by = (sort: SummarySort, threads: CommentThread[]) =>
  sortThreads(threads, sort).map((t) => t.id);

describe('threadAuthor', () => {
  it('prefers the display name, so the column and the order agree', () => {
    expect(threadAuthor(makeThread({ id: 'a', author: { login: 'jamie', name: 'Jesse Parsons' } })))
      .toBe('Jesse Parsons');
  });

  it('falls back to the login when there is no display name', () => {
    expect(threadAuthor(makeThread({ id: 'a', author: { login: 'jamie' } }))).toBe('jamie');
  });

  it('attributes a thread to whoever opened it, not whoever replied last', () => {
    const thread = makeThread({ id: 'a', author: { login: 'alice' } });
    thread.comments.push({
      id: 'a-c2',
      author: { login: 'zoe' },
      body: 'a reply',
      createdAt: '2024-01-02T00:00:00Z',
    });
    expect(threadAuthor(thread)).toBe('alice');
  });

  it('is empty when the thread has no comments to attribute it to', () => {
    expect(threadAuthor(makeThread({ id: 'a', author: null }))).toBe('');
  });
});

describe('sortThreads by author', () => {
  const cast = () => [
    makeThread({ id: 'carol', author: { login: 'carol' }, updatedAt: '2024-03-01T00:00:00Z' }),
    makeThread({ id: 'alice', author: { login: 'alice' }, updatedAt: '2024-02-01T00:00:00Z' }),
    makeThread({ id: 'bob', author: { login: 'Bob' }, updatedAt: '2024-01-01T00:00:00Z' }),
  ];

  it('orders A→Z, ignoring case', () => {
    expect(by({ key: 'author', dir: 'asc' }, cast())).toEqual(['alice', 'bob', 'carol']);
  });

  it('reverses to Z→A', () => {
    expect(by({ key: 'author', dir: 'desc' }, cast())).toEqual(['carol', 'bob', 'alice']);
  });

  it('keeps one author\u2019s threads newest first, so their list still reads chronologically', () => {
    const threads = [
      makeThread({ id: 'old', author: { login: 'alice' }, updatedAt: '2024-01-01T00:00:00Z' }),
      makeThread({ id: 'new', author: { login: 'alice' }, updatedAt: '2024-03-01T00:00:00Z' }),
      makeThread({ id: 'mid', author: { login: 'alice' }, updatedAt: '2024-02-01T00:00:00Z' }),
    ];
    expect(by({ key: 'author', dir: 'asc' }, threads)).toEqual(['new', 'mid', 'old']);
  });

  it('sinks unattributed threads to the bottom in both directions', () => {
    const threads = [
      makeThread({ id: 'anon', author: null }),
      makeThread({ id: 'zoe', author: { login: 'zoe' } }),
      makeThread({ id: 'alice', author: { login: 'alice' } }),
    ];
    expect(by({ key: 'author', dir: 'asc' }, threads)).toEqual(['alice', 'zoe', 'anon']);
    expect(by({ key: 'author', dir: 'desc' }, threads)).toEqual(['zoe', 'alice', 'anon']);
  });

  it('leaves the caller\u2019s array untouched', () => {
    const threads = cast();
    const ids = threads.map((t) => t.id);
    sortThreads(threads, { key: 'author', dir: 'asc' });
    expect(threads.map((t) => t.id)).toEqual(ids);
  });
});

describe('sortThreads by the other columns', () => {
  it('defaults to newest updated first', () => {
    const threads = [
      makeThread({ id: 'old', updatedAt: '2024-01-01T00:00:00Z' }),
      makeThread({ id: 'new', updatedAt: '2024-03-01T00:00:00Z' }),
      makeThread({ id: 'mid', updatedAt: '2024-02-01T00:00:00Z' }),
    ];
    expect(by(DEFAULT_SUMMARY_SORT, threads)).toEqual(['new', 'mid', 'old']);
    expect(by({ key: 'updated', dir: 'asc' }, threads)).toEqual(['old', 'mid', 'new']);
  });

  it('groups a file together and walks it down the lines', () => {
    const threads = [
      makeThread({ id: 'b-40', filename: 'src/b.ts', line: 40 }),
      makeThread({ id: 'a-90', filename: 'src/a.ts', line: 90 }),
      makeThread({ id: 'a-10', filename: 'src/a.ts', line: 10 }),
    ];
    expect(by({ key: 'file', dir: 'asc' }, threads)).toEqual(['a-10', 'a-90', 'b-40']);
  });

  it('puts unresolved work first, then resolved, then closed', () => {
    const threads = [
      makeThread({ id: 'closed', status: 'active', closed: true }),
      makeThread({ id: 'resolved', status: 'resolved' }),
      makeThread({ id: 'active', status: 'active' }),
    ];
    expect(by({ key: 'status', dir: 'asc' }, threads)).toEqual(['active', 'resolved', 'closed']);
    expect(by({ key: 'status', dir: 'desc' }, threads)).toEqual(['closed', 'resolved', 'active']);
  });
});

describe('nextSort', () => {
  it('starts a name column at A→Z', () => {
    expect(nextSort(DEFAULT_SUMMARY_SORT, 'author')).toEqual({ key: 'author', dir: 'asc' });
    expect(nextSort(DEFAULT_SUMMARY_SORT, 'file')).toEqual({ key: 'file', dir: 'asc' });
  });

  it('starts the time column at newest first', () => {
    expect(nextSort({ key: 'author', dir: 'asc' }, 'updated')).toEqual({
      key: 'updated',
      dir: 'desc',
    });
  });

  it('flips the direction when the column is already the one in force', () => {
    expect(nextSort({ key: 'author', dir: 'asc' }, 'author')).toEqual({
      key: 'author',
      dir: 'desc',
    });
    expect(nextSort({ key: 'author', dir: 'desc' }, 'author')).toEqual({
      key: 'author',
      dir: 'asc',
    });
  });
});

describe('sort announcements', () => {
  it('marks only the column actually in force', () => {
    const sort: SummarySort = { key: 'author', dir: 'asc' };
    expect(ariaSort(sort, 'author')).toBe('ascending');
    expect(ariaSort({ ...sort, dir: 'desc' }, 'author')).toBe('descending');
    expect(ariaSort(sort, 'updated')).toBe('none');
  });

  it('tells you what the next click would do', () => {
    expect(sortHint(DEFAULT_SUMMARY_SORT, 'author', 'Author')).toBe('Sort by author, ascending');
    expect(sortHint({ key: 'author', dir: 'asc' }, 'author', 'Author')).toBe(
      'Sort by author, descending',
    );
  });
});
