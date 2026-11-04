import { describe, it, expect } from 'vitest';
import { getRenameInfo, noDiffMessage } from '../renameInfo';
import type { FileChange } from '../../types';

function file(overrides: Partial<FileChange> = {}): FileChange {
  return {
    filename: 'src/app.ts',
    status: 'renamed',
    additions: 0,
    deletions: 0,
    changes: 0,
    ...overrides,
  };
}

describe('getRenameInfo — is there a path change at all', () => {
  it('says nothing about a file that did not move', () => {
    expect(getRenameInfo(file({ status: 'modified', additions: 2, changes: 2 }))).toBeUndefined();
  });

  it('ignores a previous filename identical to the current one', () => {
    expect(getRenameInfo(file({ previousFilename: 'src/app.ts' }))).toBeUndefined();
  });

  it('reports the move even when the status is not "renamed"', () => {
    // The old path is the fact that matters; some payloads pair it with a
    // 'modified' status, and a reviewer still needs to be told.
    const info = getRenameInfo(file({ status: 'modified', previousFilename: 'docs/app.ts' }));
    expect(info?.kind).toBe('moved');
  });
});

describe('getRenameInfo — telling the three kinds apart', () => {
  it('calls a change of directory a move', () => {
    const info = getRenameInfo(
      file({ filename: 'dashboards/adx/kpi.json', previousFilename: 'docs/adx/kpi.json' }),
    );
    expect(info?.kind).toBe('moved');
    expect(info?.verb).toBe('Moved');
    expect(info?.badge).toBe('Moved');
    expect(info?.fromDir).toBe('docs/adx');
    expect(info?.toDir).toBe('dashboards/adx');
  });

  it('calls a change of basename in the same folder a rename', () => {
    const info = getRenameInfo(
      file({ filename: 'docs/kpi.json', previousFilename: 'docs/metrics.json' }),
    );
    expect(info?.kind).toBe('renamed');
    expect(info?.verb).toBe('Renamed');
  });

  it('names both when the file changed folder and name', () => {
    const info = getRenameInfo(
      file({ filename: 'dashboards/kpi.json', previousFilename: 'docs/metrics.json' }),
    );
    expect(info?.kind).toBe('moved-and-renamed');
    expect(info?.verb).toBe('Moved and renamed');
    expect(info?.badge).toBe('Moved + renamed');
  });

  it('treats the repository root as a directory of its own', () => {
    const info = getRenameInfo(file({ filename: 'kpi.json', previousFilename: 'docs/kpi.json' }));
    expect(info?.kind).toBe('moved');
    expect(info?.fromDir).toBe('docs');
    expect(info?.toDir).toBe('');
  });
});

describe('getRenameInfo — was the path the only change', () => {
  it('flags a pure move, which is the case that otherwise looks like nothing', () => {
    const info = getRenameInfo(file({ filename: 'a/x.ts', previousFilename: 'b/x.ts' }));
    expect(info?.pathOnly).toBe(true);
    expect(info?.summary).toContain('path change only');
  });

  it('does not flag one when lines changed as well', () => {
    const info = getRenameInfo(
      file({ filename: 'a/x.ts', previousFilename: 'b/x.ts', additions: 3, deletions: 1, changes: 4 }),
    );
    expect(info?.pathOnly).toBe(false);
    expect(info?.summary).toContain('contents changed too');
  });

  it('trusts additions and deletions when "changes" is missing', () => {
    const info = getRenameInfo({
      filename: 'a/x.ts',
      previousFilename: 'b/x.ts',
      additions: 1,
      deletions: 0,
      changes: 0,
    });
    expect(info?.pathOnly).toBe(false);
  });

  it('names both paths in the summary, so a tooltip is enough on its own', () => {
    const info = getRenameInfo(file({ filename: 'a/x.ts', previousFilename: 'b/x.ts' }));
    expect(info?.summary).toContain('b/x.ts');
    expect(info?.summary).toContain('a/x.ts');
  });
});

describe('noDiffMessage', () => {
  it('explains an empty diff as a path change when that is what it is', () => {
    const info = getRenameInfo(file({ filename: 'a/x.ts', previousFilename: 'b/x.ts' }));
    expect(noDiffMessage(info)).toBe('No content changes — only the file path changed.');
  });

  it('falls back to the generic reason for a file that did not move', () => {
    expect(noDiffMessage(undefined)).toContain('No textual diff available');
  });

  it('does not blame the path when a moved file also changed but has no patch', () => {
    const info = getRenameInfo(
      file({ filename: 'a/x.ts', previousFilename: 'b/x.ts', additions: 9, changes: 9 }),
    );
    expect(noDiffMessage(info)).toContain('No textual diff available');
  });
});
