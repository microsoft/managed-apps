import { describe, it, expect } from 'vitest';
import {
  countIssues,
  filterIssues,
  ISSUE_FILTERS,
  STATUS_HINTS,
  STATUS_LABELS,
} from '../issueFilter';
import type { Issue } from '../../../types';

const issue = (over: Partial<Issue> & { id: string }): Issue => ({
  title: 'x',
  body: '',
  kind: 'bug',
  status: 'open',
  authorId: 'gh:1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const list: Issue[] = [
  issue({ id: 'a', status: 'open', updatedAt: '2026-01-02T00:00:00Z' }),
  issue({ id: 'b', status: 'closed', updatedAt: '2026-01-05T00:00:00Z' }),
  issue({ id: 'c', status: 'open', updatedAt: '2026-01-04T00:00:00Z' }),
  issue({ id: 'd', status: 'pending', updatedAt: '2026-01-03T00:00:00Z' }),
  issue({ id: 'e', status: 'blocked', updatedAt: '2026-01-01T00:00:00Z' }),
];

describe('countIssues', () => {
  it('counts each tab, with pending counted under open too', () => {
    expect(countIssues(list)).toEqual({ open: 3, pending: 1, blocked: 1, closed: 1, all: 5 });
  });

  it('handles an empty list', () => {
    expect(countIssues([])).toEqual({ open: 0, pending: 0, blocked: 0, closed: 0, all: 0 });
  });

  it('reports zero for a status nobody is using', () => {
    expect(countIssues([issue({ id: 'z' })])).toEqual({
      open: 1,
      pending: 0,
      blocked: 0,
      closed: 0,
      all: 1,
    });
  });
});

describe('filterIssues', () => {
  it('keeps open and pending issues, so in-flight work is visible', () => {
    expect(filterIssues(list, 'open').map((i) => i.id)).toEqual(['c', 'd', 'a']);
  });

  it('keeps only closed issues', () => {
    expect(filterIssues(list, 'closed').map((i) => i.id)).toEqual(['b']);
  });

  it('keeps only pending issues', () => {
    expect(filterIssues(list, 'pending').map((i) => i.id)).toEqual(['d']);
  });

  it('keeps blocked out of the open list', () => {
    expect(filterIssues(list, 'open').map((i) => i.id)).not.toContain('e');
  });

  it('keeps closed out of the open list', () => {
    expect(filterIssues(list, 'open').map((i) => i.id)).not.toContain('b');
  });

  it('keeps only blocked issues', () => {
    expect(filterIssues(list, 'blocked').map((i) => i.id)).toEqual(['e']);
  });

  it('keeps everything, newest activity first', () => {
    expect(filterIssues(list, 'all').map((i) => i.id)).toEqual(['b', 'c', 'd', 'a', 'e']);
  });

  it('does not mutate the input', () => {
    const input = [...list];
    filterIssues(input, 'all');
    expect(input.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('tolerates a missing timestamp', () => {
    const withBlank = [...list, issue({ id: 'f', updatedAt: '' })];
    expect(filterIssues(withBlank, 'all').map((i) => i.id)).toEqual([
      'b',
      'c',
      'd',
      'a',
      'e',
      'f',
    ]);
  });
});

describe("won't fix", () => {
  const declined = issue({ id: 'w', status: 'wontfix', updatedAt: '2026-01-06T00:00:00Z' });
  const withDeclined = [...list, declined];

  it('shows under the closed tab, alongside the ordinary closures', () => {
    expect(filterIssues(withDeclined, 'closed').map((i) => i.id)).toEqual(['w', 'b']);
  });

  it('counts towards closed rather than a bucket of its own', () => {
    expect(countIssues(withDeclined)).toEqual({
      open: 3,
      pending: 1,
      blocked: 1,
      closed: 2,
      all: 6,
    });
  });

  it('stays out of the live tabs', () => {
    for (const tab of ['open', 'pending', 'blocked'] as const) {
      expect(filterIssues(withDeclined, tab).map((i) => i.id)).not.toContain('w');
    }
  });

  it('is still reachable from All', () => {
    expect(filterIssues(withDeclined, 'all').map((i) => i.id)).toContain('w');
  });

  it('gets no tab of its own', () => {
    expect(ISSUE_FILTERS.map((f) => f.value)).not.toContain('wontfix');
  });

  it('has a label and a hint, since it is still shown as a badge', () => {
    expect(STATUS_LABELS.wontfix).toBe('Won’t fix');
    expect(STATUS_HINTS.wontfix).toBeTruthy();
  });
});
