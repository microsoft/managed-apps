import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffViewer } from '../DiffViewer';
import { useCodeFlow } from '../../../state/useCodeFlow';
import { GitHubService } from '../../../services/githubService';
import { resetSettingsStoreForTests, updateSettings } from '../../../settings/settingsStore';
import type { ParsedDiff } from '../../../types';

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: vi.fn(),
  useFileThreads: () => [],
}));
vi.mock('../../../services/githubService', () => ({
  GitHubService: { getFileContent: vi.fn() },
}));
vi.mock('../useSyntaxHighlight', () => ({
  useSyntaxHighlight: () => ({ active: false, tokensFor: () => [] }),
}));

const rendered = vi.hoisted(() => [] as ParsedDiff[]);
vi.mock('../InlineDiff', () => ({
  InlineDiff: ({ diff }: { diff: ParsedDiff }) => { rendered.push(diff); return null; },
}));
vi.mock('../SplitDiff', () => ({
  SplitDiff: ({ diff }: { diff: ParsedDiff }) => { rendered.push(diff); return null; },
}));

const files = Array.from({ length: 25 }, (_, i) => ({
  filename: `file${i}.ts`,
  status: 'modified' as const,
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: '@@ -1 +1 @@\n-old\n+new',
}));

function context(selectedFile = files[0].filename): ReturnType<typeof useCodeFlow> {
  return {
    status: 'ready',
    pr: {
      coordinates: { owner: 'o', name: 'r', number: 1 },
      title: 'Test', body: '', state: 'open', draft: false, merged: false,
      baseSha: 'base', headSha: 'head', baseRef: 'main', headRef: 'feature',
      htmlUrl: '', author: { login: 'author' },
    },
    comparison: { files, baseSha: 'base', headSha: 'head', commits: [] },
    selectedFile,
    iterations: [], fromIndex: 0, toIndex: 1,
    comparisonLoading: false, seen: {}, threads: [], threadsLoading: false,
    closed: {}, closedBy: {}, viewMode: 'inline', reviewers: [],
    prKey: 'o/r#1', rangeId: 'base..head', commentBackendLabel: 'test',
    actions: {
      loadPr: vi.fn(), reset: vi.fn(), selectIterations: vi.fn(), selectFile: vi.fn(),
      selectFolder: vi.fn(), focusThread: vi.fn(), focusLine: vi.fn(), consumeLineFocus: vi.fn(),
      toggleSeen: vi.fn(), markAllSeen: vi.fn(), setViewMode: vi.fn(), createThread: vi.fn(),
      addComment: vi.fn(), editComment: vi.fn(), deleteComment: vi.fn(), addIssueComment: vi.fn(), setThreadStatus: vi.fn(),
      setThreadClosed: vi.fn(), deleteThread: vi.fn(), submitReview: vi.fn(), publishDraft: vi.fn(),
      refreshNow: vi.fn(), refreshChecks: vi.fn(), mergePr: vi.fn(),
      enableAutoMerge: vi.fn(), disableAutoMerge: vi.fn(),
    },
  };
}

const pending = new Map<string, (content: string | undefined) => void>();
const rowCount = (diff: ParsedDiff) => diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);

beforeEach(() => {
  vi.clearAllMocks();
  rendered.length = 0;
  pending.clear();
  resetSettingsStoreForTests();
  updateSettings({ defaultFullFile: true, fullFileLineLimit: 0 });
  vi.mocked(GitHubService.getFileContent).mockImplementation(
    (repo, path, ref) => new Promise((resolve) => pending.set(`${repo.owner}/${repo.name}/${path}@${ref}`, resolve)),
  );
});

async function resolveFile(key: string, content: string | undefined) {
  await act(async () => { pending.get(key)!(content); });
}

describe('full-file content ownership', () => {
  it.each(['inline', 'split'] as const)('never expands later files with previous content in %s view', async (viewMode) => {
    let ctx = { ...context(), viewMode };
    vi.mocked(useCodeFlow).mockImplementation(() => ctx);
    const { rerender } = render(<DiffViewer />);
    await resolveFile('o/r/file0.ts@head', Array.from({ length: 1500 }, (_, i) => `previous-${i}`).join('\n'));
    expect(rowCount(rendered.at(-1)!)).toBeGreaterThan(1000);

    for (const file of files.slice(1)) {
      rendered.length = 0;
      ctx = { ...ctx, selectedFile: file.filename };
      rerender(<DiffViewer />);
      // Check every render, including the one before effects/loading state run.
      expect(rendered.map(rowCount)).toEqual([3]);
      await resolveFile(`o/r/${file.filename}@head`, 'new\nown context');
      expect(rowCount(rendered.at(-1)!)).toBe(3);
    }
  });

  it('keeps the size guard effective while the next large file is loading', async () => {
    updateSettings({ fullFileLineLimit: 1000 });
    const farFile = { ...files[1], patch: '@@ -1500 +1500 @@\n-old\n+new' };
    let ctx = context();
    ctx = { ...ctx, comparison: { ...ctx.comparison!, files: [files[0], farFile] } };
    vi.mocked(useCodeFlow).mockImplementation(() => ctx);
    const { rerender } = render(<DiffViewer />);
    await resolveFile('o/r/file0.ts@head', 'new');
    rendered.length = 0;
    ctx = { ...ctx, selectedFile: farFile.filename };
    rerender(<DiffViewer />);
    expect(rendered.every((diff) => rowCount(diff) === 3)).toBe(true);
    await resolveFile('o/r/file1.ts@head', 'large\n'.repeat(1600));
    expect(rowCount(rendered.at(-1)!)).toBe(3);
  });

  it('invalidates content for a changed commit or repository, but not unrelated refreshes', async () => {
    let ctx = context();
    vi.mocked(useCodeFlow).mockImplementation(() => ctx);
    const { rerender } = render(<DiffViewer />);
    await resolveFile('o/r/file0.ts@head', 'new\nfirst context\nmore');
    ctx = { ...ctx, comparison: { ...ctx.comparison! }, pr: { ...ctx.pr! } };
    rerender(<DiffViewer />);
    expect(GitHubService.getFileContent).toHaveBeenCalledTimes(1);

    ctx = { ...ctx, comparison: { ...ctx.comparison!, headSha: 'next' } };
    rendered.length = 0;
    rerender(<DiffViewer />);
    expect(rendered.every((diff) => rowCount(diff) === 3)).toBe(true);
    ctx = { ...ctx, pr: { ...ctx.pr!, coordinates: { owner: 'other', name: 'repo', number: 1 } } };
    rerender(<DiffViewer />);
    await resolveFile('o/r/file0.ts@next', 'stale\n'.repeat(1500));
    expect(rendered.every((diff) => rowCount(diff) === 3)).toBe(true);
    await resolveFile('other/repo/file0.ts@next', 'new\ncorrect');
    await waitFor(() => expect(rendered.at(-1)?.hunks[0].lines.at(-1)?.content).toBe('correct'));
  });

  it('does not reuse an earlier visit or an unavailable response', async () => {
    let ctx = context();
    vi.mocked(useCodeFlow).mockImplementation(() => ctx);
    const { rerender } = render(<DiffViewer />);
    await resolveFile('o/r/file0.ts@head', 'new\nprevious\ncontext');
    ctx = { ...ctx, selectedFile: files[1].filename };
    rerender(<DiffViewer />);
    const obsolete = pending.get('o/r/file1.ts@head')!;
    ctx = { ...ctx, selectedFile: files[0].filename };
    rendered.length = 0;
    rerender(<DiffViewer />);
    await act(async () => { obsolete('stale\n'.repeat(1500)); });
    await resolveFile('o/r/file0.ts@head', undefined);
    expect(rendered.every((diff) => rowCount(diff) === 3)).toBe(true);
  });

  it('drops full content immediately when full-file mode is disabled', async () => {
    vi.mocked(useCodeFlow).mockReturnValue(context());
    render(<DiffViewer />);
    await resolveFile('o/r/file0.ts@head', 'new\nprevious\ncontext');
    rendered.length = 0;
    act(() => { updateSettings({ defaultFullFile: false }); });
    expect(rendered.every((diff) => rowCount(diff) === 3)).toBe(true);
    act(() => { updateSettings({ defaultFullFile: true }); });
    expect(GitHubService.getFileContent).toHaveBeenCalledTimes(2);
    expect(rendered.every((diff) => rowCount(diff) === 3)).toBe(true);
  });
});
