import { describe, it, expect } from 'vitest';
import {
  getSeenFiles,
  setFileSeen,
  setManyFilesSeen,
  computePatchHashes,
  savePatchHashes,
  getLastRangeId,
  migrateSeenByContent,
  getClosedThreads,
  setThreadClosed,
  getRecentPrs,
  pushRecentPr,
  getPinnedRepos,
  isRepoPinned,
  addPinnedRepo,
  removePinnedRepo,
  getFlaggedPrs,
  isPrFlagged,
  toggleFlaggedPr,
  addFlaggedPr,
  pruneFlaggedPrs,
  getInProgressReviews,
  addInProgressReview,
  removeInProgressReview,
  isInProgressExpired,
  IN_PROGRESS_MAX_AGE_DAYS,
  getIterationHistory,
  recordIterationShas,
  getLastReviewed,
  recordLastReviewed,
} from '../storage';
import type { FileChange, Iteration } from '../../types';
import { appStorage, reviewStateCollection } from '../../storage';

describe('seen state', () => {
  it('returns empty object for unseen range', () => {
    expect(getSeenFiles('owner/repo#1', 'abc..def')).toEqual({});
  });

  it('sets a file as seen and retrieves it', () => {
    const seen = setFileSeen('owner/repo#1', 'range1', 'src/app.ts', true);
    expect(seen['src/app.ts']).toBe(true);
    expect(getSeenFiles('owner/repo#1', 'range1')).toEqual({ 'src/app.ts': true });
  });

  it('unsets a file seen mark', () => {
    setFileSeen('owner/repo#1', 'range1', 'src/app.ts', true);
    const seen = setFileSeen('owner/repo#1', 'range1', 'src/app.ts', false);
    expect(seen['src/app.ts']).toBeUndefined();
  });

  it('setManyFilesSeen marks multiple files', () => {
    const files = ['a.ts', 'b.ts', 'c.ts'];
    const seen = setManyFilesSeen('owner/repo#1', 'range1', files, true);
    expect(seen).toEqual({ 'a.ts': true, 'b.ts': true, 'c.ts': true });
  });

  it('setManyFilesSeen unmarks all', () => {
    setManyFilesSeen('owner/repo#1', 'range1', ['a.ts', 'b.ts'], true);
    const seen = setManyFilesSeen('owner/repo#1', 'range1', ['a.ts', 'b.ts'], false);
    expect(seen).toEqual({});
  });

  it('keeps different ranges isolated', () => {
    setFileSeen('owner/repo#1', 'range1', 'a.ts', true);
    setFileSeen('owner/repo#1', 'range2', 'b.ts', true);
    expect(getSeenFiles('owner/repo#1', 'range1')).toEqual({ 'a.ts': true });
    expect(getSeenFiles('owner/repo#1', 'range2')).toEqual({ 'b.ts': true });
  });
});

describe('patch hashes & migration', () => {
  const makeFile = (filename: string, patch?: string): FileChange => ({
    filename,
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch,
  });

  it('computePatchHashes creates consistent hashes', () => {
    const files = [makeFile('a.ts', 'diff content'), makeFile('b.ts', 'other diff')];
    const h1 = computePatchHashes(files);
    const h2 = computePatchHashes(files);
    expect(h1).toEqual(h2);
    expect(h1['a.ts']).not.toBe(h1['b.ts']);
  });

  it('computePatchHashes falls back to status+stats when no patch', () => {
    const files = [makeFile('binary.png')];
    const hashes = computePatchHashes(files);
    expect(hashes['binary.png']).toBeDefined();
    expect(typeof hashes['binary.png']).toBe('string');
  });

  it('savePatchHashes records the last range', () => {
    const files = [makeFile('a.ts', 'patch')];
    savePatchHashes('owner/repo#1', 'range-abc', files);
    expect(getLastRangeId('owner/repo#1')).toBe('range-abc');
  });

  it('migrateSeenByContent carries forward seen marks for unchanged files', () => {
    const files = [makeFile('a.ts', 'same patch'), makeFile('b.ts', 'changed patch')];
    // Save initial state
    savePatchHashes('owner/repo#1', 'range1', files);
    setFileSeen('owner/repo#1', 'range1', 'a.ts', true);
    setFileSeen('owner/repo#1', 'range1', 'b.ts', true);

    // New range: a.ts unchanged, b.ts changed
    const newFiles = [makeFile('a.ts', 'same patch'), makeFile('b.ts', 'different patch now')];
    const seen = migrateSeenByContent('owner/repo#1', 'range1', 'range2', newFiles);

    expect(seen['a.ts']).toBe(true); // carried forward (same hash)
    expect(seen['b.ts']).toBeUndefined(); // NOT carried (different hash)
  });

  it('migrateSeenByContent returns existing seen if ranges are same', () => {
    setFileSeen('owner/repo#1', 'range1', 'x.ts', true);
    const seen = migrateSeenByContent('owner/repo#1', 'range1', 'range1', []);
    expect(seen['x.ts']).toBe(true);
  });
});

describe('closed thread state', () => {
  it('returns empty object when nothing is closed', () => {
    expect(getClosedThreads('owner/repo#1')).toEqual({});
  });

  it('marks a thread as closed and retrieves it', () => {
    const map = setThreadClosed('owner/repo#1', 'thread-1', true);
    expect(map['thread-1']).toBe(true);
    expect(getClosedThreads('owner/repo#1')).toEqual({ 'thread-1': true });
  });

  it('reopening removes the thread from the map', () => {
    setThreadClosed('owner/repo#1', 'thread-1', true);
    const map = setThreadClosed('owner/repo#1', 'thread-1', false);
    expect(map['thread-1']).toBeUndefined();
    expect(getClosedThreads('owner/repo#1')).toEqual({});
  });

  it('keeps closed state isolated per PR', () => {
    setThreadClosed('owner/repo#1', 'thread-1', true);
    setThreadClosed('owner/repo#2', 'thread-2', true);
    expect(getClosedThreads('owner/repo#1')).toEqual({ 'thread-1': true });
    expect(getClosedThreads('owner/repo#2')).toEqual({ 'thread-2': true });
  });

  it('returns a fresh copy (not a live reference)', () => {
    const a = setThreadClosed('owner/repo#1', 't1', true);
    const b = setThreadClosed('owner/repo#1', 't2', true);
    expect(a).not.toBe(b);
    expect(a).toEqual({ t1: true });
    expect(b).toEqual({ t1: true, t2: true });
  });
});

describe('recent PRs', () => {
  it('returns an empty list initially', () => {
    expect(getRecentPrs()).toEqual([]);
  });

  it('pushes newest first and dedupes by coordinates', () => {
    pushRecentPr({ owner: 'o', name: 'r', number: 1, viewedAt: '2024-01-01T00:00:00Z' });
    pushRecentPr({ owner: 'o', name: 'r', number: 2, viewedAt: '2024-01-02T00:00:00Z' });
    // Re-view #1 — should move to front, not duplicate.
    pushRecentPr({ owner: 'o', name: 'r', number: 1, viewedAt: '2024-01-03T00:00:00Z' });
    const recent = getRecentPrs();
    expect(recent.map((r) => r.number)).toEqual([1, 2]);
  });

  it('caps the list at 10 entries', () => {
    for (let i = 0; i < 15; i++) {
      pushRecentPr({ owner: 'o', name: 'r', number: i, viewedAt: '2024-01-01T00:00:00Z' });
    }
    expect(getRecentPrs()).toHaveLength(10);
  });
});

describe('pinned repos', () => {
  it('returns empty initially and reports not pinned', () => {
    expect(getPinnedRepos()).toEqual([]);
    expect(isRepoPinned('o', 'r')).toBe(false);
  });

  it('adds a repo newest-first and marks it pinned', () => {
    addPinnedRepo('o', 'first');
    addPinnedRepo('o', 'second');
    const pins = getPinnedRepos();
    expect(pins.map((p) => p.name)).toEqual(['second', 'first']);
    expect(isRepoPinned('o', 'first')).toBe(true);
    expect(pins[0].pinnedAt).toBeTruthy();
  });

  it('is idempotent — adding the same repo twice does not duplicate', () => {
    addPinnedRepo('o', 'r');
    addPinnedRepo('o', 'r');
    expect(getPinnedRepos()).toHaveLength(1);
  });

  it('removes a pinned repo', () => {
    addPinnedRepo('o', 'a');
    addPinnedRepo('o', 'b');
    removePinnedRepo('o', 'a');
    expect(getPinnedRepos().map((p) => p.name)).toEqual(['b']);
    expect(isRepoPinned('o', 'a')).toBe(false);
  });
});

describe('flagged PRs', () => {
  it('returns empty initially and reports not flagged', () => {
    expect(getFlaggedPrs()).toEqual([]);
    expect(isPrFlagged('o', 'r', 1)).toBe(false);
  });

  it('toggles a PR on and off', () => {
    toggleFlaggedPr({ owner: 'o', name: 'r', number: 1, title: 'Fix' });
    expect(isPrFlagged('o', 'r', 1)).toBe(true);
    expect(getFlaggedPrs()[0]).toMatchObject({ owner: 'o', name: 'r', number: 1, title: 'Fix' });

    toggleFlaggedPr({ owner: 'o', name: 'r', number: 1 });
    expect(isPrFlagged('o', 'r', 1)).toBe(false);
    expect(getFlaggedPrs()).toEqual([]);
  });

  it('adds newest-first and distinguishes PRs by number', () => {
    toggleFlaggedPr({ owner: 'o', name: 'r', number: 1 });
    toggleFlaggedPr({ owner: 'o', name: 'r', number: 2 });
    expect(getFlaggedPrs().map((f) => f.number)).toEqual([2, 1]);
    expect(isPrFlagged('o', 'r', 2)).toBe(true);
  });

  it('pruneFlaggedPrs removes matching entries and keeps the rest', () => {
    toggleFlaggedPr({ owner: 'o', name: 'r', number: 1 });
    toggleFlaggedPr({ owner: 'o', name: 'r', number: 2 });
    toggleFlaggedPr({ owner: 'o', name: 'r', number: 3 });
    const next = pruneFlaggedPrs((f) => f.number === 2);
    expect(next.map((f) => f.number)).toEqual([3, 1]);
    expect(getFlaggedPrs().map((f) => f.number)).toEqual([3, 1]);
    expect(isPrFlagged('o', 'r', 2)).toBe(false);
  });

  it('pruneFlaggedPrs can remove several entries at once', () => {
    toggleFlaggedPr({ owner: 'o', name: 'r', number: 1 });
    toggleFlaggedPr({ owner: 'o', name: 'r', number: 2 });
    toggleFlaggedPr({ owner: 'o', name: 'r', number: 3 });
    const resolved = new Set([1, 3]);
    pruneFlaggedPrs((f) => resolved.has(f.number));
    expect(getFlaggedPrs().map((f) => f.number)).toEqual([2]);
  });

  it('pruneFlaggedPrs is a no-op when nothing matches', () => {
    toggleFlaggedPr({ owner: 'o', name: 'r', number: 1 });
    const next = pruneFlaggedPrs(() => false);
    expect(next.map((f) => f.number)).toEqual([1]);
    expect(getFlaggedPrs().map((f) => f.number)).toEqual([1]);
  });

  it('addFlaggedPr flags a PR that is not flagged yet', () => {
    addFlaggedPr({ owner: 'o', name: 'r', number: 1, title: 'Fix' });
    expect(isPrFlagged('o', 'r', 1)).toBe(true);
    expect(getFlaggedPrs()[0]).toMatchObject({ owner: 'o', name: 'r', number: 1, title: 'Fix' });
  });

  it('addFlaggedPr never unflags or duplicates an existing entry', () => {
    addFlaggedPr({ owner: 'o', name: 'r', number: 1, title: 'Fix' });
    const first = getFlaggedPrs()[0];

    addFlaggedPr({ owner: 'o', name: 'r', number: 1, title: 'Renamed' });

    const flags = getFlaggedPrs();
    expect(flags).toHaveLength(1);
    // The original entry survives untouched, including when it was flagged.
    expect(flags[0].title).toBe('Fix');
    expect(flags[0].flaggedAt).toBe(first.flaggedAt);
  });
});

describe('in-progress reviews', () => {
  it('returns empty initially', () => {
    expect(getInProgressReviews()).toEqual([]);
  });

  it('adds a review with a startedAt timestamp', () => {
    addInProgressReview({ owner: 'o', name: 'r', number: 1, title: 'Feature' });
    const list = getInProgressReviews();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ owner: 'o', name: 'r', number: 1, title: 'Feature' });
    expect(list[0].startedAt).toBeTruthy();
  });

  it('re-adding preserves the original startedAt and moves to front', () => {
    addInProgressReview({ owner: 'o', name: 'r', number: 1 });
    const firstStarted = getInProgressReviews()[0].startedAt;
    addInProgressReview({ owner: 'o', name: 'r', number: 2 });
    // Re-open #1 — keeps its original start time, jumps to front.
    addInProgressReview({ owner: 'o', name: 'r', number: 1, title: 'Updated' });
    const list = getInProgressReviews();
    expect(list.map((r) => r.number)).toEqual([1, 2]);
    expect(list[0].startedAt).toBe(firstStarted);
    expect(list[0].title).toBe('Updated');
  });

  it('removes a review on completion', () => {
    addInProgressReview({ owner: 'o', name: 'r', number: 1 });
    addInProgressReview({ owner: 'o', name: 'r', number: 2 });
    removeInProgressReview('o', 'r', 1);
    expect(getInProgressReviews().map((r) => r.number)).toEqual([2]);
  });

  it('caps the list at 30 entries', () => {
    for (let i = 0; i < 35; i++) {
      addInProgressReview({ owner: 'o', name: 'r', number: i });
    }
    expect(getInProgressReviews()).toHaveLength(30);
  });

  describe('expiry on read', () => {
    const aged = (days: number) =>
      new Date(Date.now() - days * 86400000).toISOString();

    function seed(entries: { number: number; startedAt: string }[]) {
      for (const e of entries) {
        appStorage().reviewState.set(`o/r#${e.number}`, {
          owner: 'o', repo: 'r', number: e.number, seen: {}, patchHashes: {}, comments: [],
          inProgressSince: e.startedAt,
        });
      }
    }

    it('drops entries older than the max age', () => {
      seed([
        { number: 1, startedAt: aged(IN_PROGRESS_MAX_AGE_DAYS + 1) },
        { number: 2, startedAt: aged(1) },
      ]);
      expect(getInProgressReviews().map((r) => r.number)).toEqual([2]);
    });

    it('persists the pruned list so it only happens once', () => {
      seed([{ number: 1, startedAt: aged(IN_PROGRESS_MAX_AGE_DAYS + 1) }]);
      getInProgressReviews();
      expect(appStorage().reviewState.get('o/r#1')?.inProgressSince).toBeUndefined();
    });

    it('leaves storage untouched when nothing has expired', () => {
      seed([{ number: 1, startedAt: aged(1) }]);
      const before = appStorage().reviewState.revision();
      getInProgressReviews();
      expect(appStorage().reviewState.revision()).toBe(before);
    });

    it('keeps entries with a missing or unparseable timestamp', () => {
      seed([{ number: 1, startedAt: 'not-a-date' }]);
      expect(getInProgressReviews()).toHaveLength(1);
      expect(isInProgressExpired({}, Date.now())).toBe(false);
    });
  });
});

describe('iteration history', () => {
  const PR = 'owner/repo#1';

  it('returns undefined before anything is recorded', () => {
    expect(getIterationHistory(PR)).toBeUndefined();
  });

  it('records the current SHAs with no losses on the first visit', () => {
    const history = recordIterationShas(PR, ['aaa', 'bbb']);
    expect(history.knownShas).toEqual(['aaa', 'bbb']);
    expect(history.lostShas).toEqual([]);
    expect(getIterationHistory(PR)).toEqual(history);
  });

  it('reports SHAs that vanished since the last visit', () => {
    recordIterationShas(PR, ['aaa', 'bbb']);
    const history = recordIterationShas(PR, ['ccc']);
    expect(history.knownShas).toEqual(['ccc']);
    expect(history.lostShas).toEqual(['aaa', 'bbb']);
  });

  it('accumulates losses across repeated force-pushes', () => {
    recordIterationShas(PR, ['aaa']);
    recordIterationShas(PR, ['bbb']);
    const history = recordIterationShas(PR, ['ccc']);
    expect(history.lostShas).toEqual(['aaa', 'bbb']);
  });

  it('keeps reporting losses on a later visit where nothing changed', () => {
    recordIterationShas(PR, ['aaa']);
    recordIterationShas(PR, ['bbb']);
    const history = recordIterationShas(PR, ['bbb']);
    expect(history.lostShas).toEqual(['aaa']);
  });

  it('does not treat added commits as losses', () => {
    recordIterationShas(PR, ['aaa']);
    const history = recordIterationShas(PR, ['aaa', 'bbb']);
    expect(history.lostShas).toEqual([]);
  });

  it('clears a SHA from the lost list when it reappears', () => {
    recordIterationShas(PR, ['aaa', 'bbb']);
    expect(recordIterationShas(PR, ['aaa']).lostShas).toEqual(['bbb']);
    expect(recordIterationShas(PR, ['aaa', 'bbb']).lostShas).toEqual([]);
  });

  it('keeps history separate per PR', () => {
    recordIterationShas(PR, ['aaa']);
    recordIterationShas('owner/repo#2', ['zzz']);
    expect(recordIterationShas(PR, ['aaa']).lostShas).toEqual([]);
    expect(getIterationHistory('owner/repo#2')?.knownShas).toEqual(['zzz']);
  });
});

describe('last reviewed iteration', () => {
  const PR = 'owner/repo#1';

  function iter(index: number, sha: string, isBase = false): Iteration {
    return { index, sha, shortSha: sha.slice(0, 6), label: `Iteration ${index}`, isBase };
  }

  const iterations = [iter(0, 'base000', true), iter(1, 'aaa111'), iter(2, 'bbb222')];

  it('returns undefined before the reviewer has done anything', () => {
    expect(getLastReviewed(PR)).toBeUndefined();
  });

  it('remembers the iteration being compared to', () => {
    const rec = recordLastReviewed(PR, iterations, 1);
    expect(rec).toMatchObject({ sha: 'aaa111', index: 1 });
    expect(getLastReviewed(PR)).toEqual(rec);
  });

  it('reports the stored record again when nothing moved', () => {
    // StrictMode replays the updater; both passes must agree on the record.
    const first = recordLastReviewed(PR, iterations, 2);
    const second = recordLastReviewed(PR, iterations, 2);
    expect(second).toEqual(first);
  });

  it('does not rewind when the reviewer goes back to an older iteration', () => {
    recordLastReviewed(PR, iterations, 2);
    recordLastReviewed(PR, iterations, 1);
    expect(getLastReviewed(PR)?.sha).toBe('bbb222');
  });

  it('keeps the marker separate per PR', () => {
    recordLastReviewed(PR, iterations, 1);
    recordLastReviewed('owner/repo#2', iterations, 2);
    expect(getLastReviewed(PR)?.sha).toBe('aaa111');
    expect(getLastReviewed('owner/repo#2')?.sha).toBe('bbb222');
  });

  it('ignores a stored value that is not a record', () => {
    appStorage().reviewState.set(PR, {
      owner: 'owner', repo: 'repo', number: 1, seen: {}, patchHashes: {}, comments: [],
      lastReviewed: { sha: '', index: 0, at: '' },
    });
    expect(getLastReviewed(PR)).toBeUndefined();
  });

  it('is stored in the PR\'s reviewState record', async () => {
    recordLastReviewed(PR, iterations, 1);
    await appStorage().reviewState.flush();
    const stored = await appStorage().provider.collection(reviewStateCollection).get(PR);
    expect(stored?.lastReviewed?.sha).toBe('aaa111');
  });
});
