import { describe, it, expect } from 'vitest';
import type { FileChange, PrSummary } from '../../../types';
import {
  cherryPickCommitMessage,
  cherryPickPrBody,
  cherryPickPrTitle,
  cherryPickTargets,
  describeOverlap,
  describeRefusal,
  evaluateCherryPickGate,
  overlappingPaths,
  planCherryPick,
  slugifyRef,
  suggestCherryPickBranch,
  validateBranchName,
} from '../cherryPickPlan';

function makePr(over: Partial<PrSummary> = {}): PrSummary {
  return {
    coordinates: { owner: 'octo', name: 'repo', number: 42 },
    title: 'Fix the crash on startup',
    state: 'open',
    draft: false,
    merged: false,
    author: { login: 'alice' },
    baseRef: 'main',
    baseSha: 'basesha',
    headRef: 'fix/crash',
    headSha: 'headsha1234567',
    ...over,
  };
}

function file(over: Partial<FileChange> & { filename: string }): FileChange {
  return { status: 'modified', additions: 1, deletions: 0, changes: 1, ...over };
}

describe('evaluateCherryPickGate', () => {
  it('shows nothing when no pull request is loaded', () => {
    expect(evaluateCherryPickGate(undefined)).toMatchObject({ visible: false, ready: false });
  });

  // The opposite of the merge gate, and deliberately so: back-porting someone
  // else's fix is the main reason this exists.
  it('offers the cherry-pick to someone who is not the author', () => {
    expect(evaluateCherryPickGate(makePr({ author: { login: 'bob' } }))).toMatchObject({
      visible: true,
      ready: true,
    });
  });

  it('offers it for a merged pull request, which is the usual case', () => {
    expect(evaluateCherryPickGate(makePr({ merged: true, state: 'closed' }))).toMatchObject({
      ready: true,
    });
  });

  it('offers it for a draft, whose commits are just as real', () => {
    expect(evaluateCherryPickGate(makePr({ draft: true }))).toMatchObject({ ready: true });
  });

  it('waits when the head commit is not known yet, and says why', () => {
    const gate = evaluateCherryPickGate(makePr({ headSha: '' }));
    expect(gate).toMatchObject({ visible: true, ready: false });
    expect(gate.reason).toMatch(/head commit/i);
  });
});

describe('slugifyRef', () => {
  it('keeps slashes, because release/1.0 is the common target', () => {
    expect(slugifyRef('release/1.0')).toBe('release/1.0');
  });

  it('folds spaces and punctuation into single hyphens', () => {
    expect(slugifyRef('My Wild   Branch!!')).toBe('my-wild-branch');
  });

  it('never produces the “..” git refuses', () => {
    expect(slugifyRef('a...b')).toBe('a.b');
  });

  it('trims the separators git will not accept at either end', () => {
    expect(slugifyRef('/-.weird.-/')).toBe('weird');
  });
});

describe('suggestCherryPickBranch', () => {
  it('names the pull request and the target', () => {
    expect(suggestCherryPickBranch(makePr(), 'release/1.0')).toBe(
      'cherry-pick/pr-42-to-release/1.0',
    );
  });

  it('still produces a usable name when the target slugs away to nothing', () => {
    expect(validateBranchName(suggestCherryPickBranch(makePr(), '///'))).toBeUndefined();
  });
});

describe('validateBranchName', () => {
  it('accepts an ordinary name', () => {
    expect(validateBranchName('cherry-pick/pr-42-to-release/1.0')).toBeUndefined();
  });

  it.each([
    ['', /name/i],
    ['has space', /space/i],
    ['bad~name', /~/],
    ['a..b', /\.\./],
    ['ref@{0}', /@\{/],
    ['/leading', /start or end/i],
    ['trailing/', /start or end/i],
    ['double//slash', /empty path segment/i],
    ['ends.lock', /\.lock/],
    ['.hidden/branch', /start with/i],
  ])('rejects %s', (name, expected) => {
    expect(validateBranchName(name)).toMatch(expected);
  });
});

describe('planCherryPick', () => {
  it('writes added, modified, changed and copied files', () => {
    const plan = planCherryPick([
      file({ filename: 'a.ts', status: 'added' }),
      file({ filename: 'b.ts', status: 'modified' }),
      file({ filename: 'c.ts', status: 'changed' }),
      file({ filename: 'd.ts', status: 'copied' }),
    ]);
    expect(plan.writes.sort()).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    expect(plan.deletes).toEqual([]);
  });

  it('deletes removed files', () => {
    const plan = planCherryPick([file({ filename: 'gone.ts', status: 'removed' })]);
    expect(plan).toMatchObject({ writes: [], deletes: ['gone.ts'] });
  });

  it('treats a rename as a write plus a delete of the old path', () => {
    const plan = planCherryPick([
      file({ filename: 'new.ts', status: 'renamed', previousFilename: 'old.ts' }),
    ]);
    expect(plan.writes).toEqual(['new.ts']);
    expect(plan.deletes).toEqual(['old.ts']);
  });

  // The order of the file list must not decide whether a file survives.
  it('never deletes a path it also writes', () => {
    const plan = planCherryPick([
      file({ filename: 'a.ts', status: 'renamed', previousFilename: 'b.ts' }),
      file({ filename: 'b.ts', status: 'added' }),
    ]);
    expect(plan.writes.sort()).toEqual(['a.ts', 'b.ts']);
    expect(plan.deletes).toEqual([]);
  });

  it('ignores files the comparison reports as unchanged', () => {
    const plan = planCherryPick([file({ filename: 'same.ts', status: 'unchanged' })]);
    expect(plan).toMatchObject({ writes: [], deletes: [], skipped: [] });
  });

  it('records a change type it does not recognise rather than dropping it', () => {
    const plan = planCherryPick([
      file({ filename: 'odd.ts', status: 'exploded' as FileChange['status'] }),
    ]);
    expect(plan.skipped).toEqual([{ path: 'odd.ts', reason: 'unrecognised change type' }]);
  });
});

describe('overlappingPaths', () => {
  const plan = planCherryPick([
    file({ filename: 'src/a.ts' }),
    file({ filename: 'src/b.ts', status: 'removed' }),
  ]);

  it('finds the files the target has also touched', () => {
    expect(overlappingPaths(plan, ['src/a.ts', 'docs/x.md'])).toEqual(['src/a.ts']);
  });

  it('counts a deletion as a touch, because it clobbers just as hard', () => {
    expect(overlappingPaths(plan, ['src/b.ts'])).toEqual(['src/b.ts']);
  });

  it('is empty when the branches have not met', () => {
    expect(overlappingPaths(plan, ['unrelated.ts'])).toEqual([]);
  });
});

describe('describeOverlap', () => {
  it('says nothing when nothing overlaps', () => {
    expect(describeOverlap([], 'release/1.0')).toBeUndefined();
  });

  it('names the branch and the files', () => {
    const msg = describeOverlap(['a.ts'], 'release/1.0');
    expect(msg).toMatch(/1 file has/);
    expect(msg).toContain('release/1.0');
    expect(msg).toContain('a.ts');
  });

  it('truncates a long list rather than filling the panel', () => {
    const msg = describeOverlap(['a', 'b', 'c', 'd', 'e'], 'main');
    expect(msg).toContain('and 2 more');
  });

  it('frames divergence as something that gets merged, not overwritten', () => {
    const msg = describeOverlap(['a.ts'], 'release/1.0');
    expect(msg).toContain('merged');
    expect(msg).not.toMatch(/replace/i);
  });
});

describe('describeRefusal', () => {
  it('leads with the fact that nothing was changed', () => {
    const msg = describeRefusal([{ path: 'a.ts', reason: 'it conflicts with main in 2 places' }]);
    expect(msg).toContain('nothing was changed');
  });

  it('names each file and its reason', () => {
    const msg = describeRefusal([
      { path: 'a.ts', reason: 'it conflicts with main in 2 places' },
      { path: 'b.ts', reason: 'it is a binary file, which this cherry-pick can’t carry' },
    ]);
    expect(msg).toContain('a.ts — it conflicts with main in 2 places');
    expect(msg).toContain('b.ts — it is a binary file');
    expect(msg).toContain('2 files');
  });

  it('truncates a long list', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ path: `f${i}.ts`, reason: 'conflict' }));
    expect(describeRefusal(many)).toContain('and 4 more');
  });

  it('points the reviewer somewhere they can actually resolve it', () => {
    expect(describeRefusal([{ path: 'a.ts', reason: 'conflict' }])).toContain('locally');
  });

  it('still says something when handed nothing', () => {
    expect(describeRefusal([])).toBeTruthy();
  });
});

describe('messages', () => {
  it('records where the commit came from', () => {
    const msg = cherryPickCommitMessage(makePr());
    expect(msg).toContain('Fix the crash on startup');
    expect(msg).toContain('#42');
    expect(msg).toContain('headsha');
  });

  it('prefixes the pull request title', () => {
    expect(cherryPickPrTitle(makePr())).toBe('Cherry-pick: Fix the crash on startup');
  });

  it('does not stutter when cherry-picking a cherry-pick', () => {
    expect(cherryPickPrTitle(makePr({ title: 'Cherry-pick: Fix it' }))).toBe(
      'Cherry-pick: Fix it',
    );
  });

  it('points the new pull request back at the original', () => {
    expect(cherryPickPrBody(makePr(), 'release/1.0')).toContain('#42');
  });
});

describe('cherryPickTargets', () => {
  it('drops the branches this pull request already lives on', () => {
    expect(cherryPickTargets(['main', 'fix/crash', 'release/1.0'], makePr())).toEqual([
      'release/1.0',
    ]);
  });

  it('de-duplicates and sorts what is left', () => {
    expect(cherryPickTargets(['b', 'a', 'b'], makePr())).toEqual(['a', 'b']);
  });
});
