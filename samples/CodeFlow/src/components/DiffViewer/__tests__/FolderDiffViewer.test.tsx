import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FolderDiffViewer } from '../FolderDiffViewer';
import type { CommentThread, FileChange } from '../../../types';

// Stub the heavy diff renderers — this suite only cares about the per-file
// header structure that the sticky "pin & replace" behaviour relies on.
vi.mock('../InlineDiff', () => ({ InlineDiff: () => <div data-testid="inline-diff" /> }));
vi.mock('../SplitDiff', () => ({ SplitDiff: () => <div data-testid="split-diff" /> }));

const mockCtx: {
  comparison: { files: FileChange[]; headSha?: string } | null;
  selectedFolder: string | null;
  viewMode: 'inline' | 'split';
  threads: CommentThread[];
  toIndex: number;
  actions: { selectFile: (f: string) => void; createThread: (input: unknown) => Promise<void> };
} = {
  comparison: null,
  selectedFolder: null,
  viewMode: 'inline',
  threads: [],
  toIndex: 1,
  actions: { selectFile: vi.fn(), createThread: vi.fn() },
};

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => mockCtx,
  useFileThreads: (filename: string | undefined) =>
    filename ? mockCtx.threads.filter((t) => t.filename === filename) : [],
}));

function file(overrides: Partial<FileChange> & Pick<FileChange, 'filename'>): FileChange {
  return {
    status: 'modified',
    additions: 3,
    deletions: 1,
    changes: 4,
    patch: '@@ -1,2 +1,3 @@\n context\n+added line\n',
    ...overrides,
  };
}

describe('FolderDiffViewer sticky headers', () => {
  beforeEach(() => {
    mockCtx.threads = [];
  });

  it('renders a sticky header carrying the full path for each changed file in the folder', () => {
    mockCtx.comparison = {
      files: [
        file({ filename: 'src/deploy/Alpha.tsx' }),
        file({ filename: 'src/deploy/Beta.tsx' }),
        file({ filename: 'src/other/Gamma.tsx' }), // outside the folder
        file({ filename: 'src/deploy/Unchanged.tsx', status: 'unchanged' }),
      ],
    };
    mockCtx.selectedFolder = 'src/deploy';

    const { container } = render(<FolderDiffViewer />);

    // One header per changed file under the folder (Alpha + Beta only).
    const headers = container.querySelectorAll('.folder-file__header');
    expect(headers).toHaveLength(2);

    // Each header exposes the full path element that gets pinned to the top.
    const paths = [...container.querySelectorAll('.folder-file__path')].map((el) => el.textContent);
    expect(paths).toEqual(['src/deploy/Alpha.tsx', 'src/deploy/Beta.tsx']);

    // Files outside the folder or unchanged are excluded.
    expect(screen.queryByText('src/other/Gamma.tsx')).toBeNull();
    expect(screen.queryByText('src/deploy/Unchanged.tsx')).toBeNull();
  });

  it('shows an empty state when the folder has no changed files', () => {
    mockCtx.comparison = { files: [file({ filename: 'src/deploy/Unchanged.tsx', status: 'unchanged' })] };
    mockCtx.selectedFolder = 'src/deploy';

    render(<FolderDiffViewer />);
    expect(screen.getByText('No changed files in this folder.')).toBeTruthy();
  });
});

describe('FolderDiffViewer scroll reset', () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  let pane: HTMLElement;

  beforeEach(() => {
    mockCtx.threads = [];
    mockCtx.viewMode = 'inline';
    mockCtx.comparison = {
      files: [
        file({ filename: 'src/deploy/Alpha.tsx' }),
        file({ filename: 'src/other/Gamma.tsx' }),
      ],
    };
    // The diff has no scroll container of its own — this pane is the one that
    // scrolls, and jsdom gives it neither layout nor a working scrollTo.
    pane = document.createElement('div');
    pane.className = 'workarea__center';
    scrollTo = vi.fn();
    (pane as unknown as { scrollTo: unknown }).scrollTo = scrollTo;
    document.body.appendChild(pane);
  });

  afterEach(() => {
    pane.remove();
  });

  it('scrolls the pane to the top when the folder view opens', () => {
    mockCtx.selectedFolder = 'src/deploy';

    render(<FolderDiffViewer />);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it('scrolls back to the top again when a different folder is picked', () => {
    mockCtx.selectedFolder = 'src/deploy';
    const { rerender } = render(<FolderDiffViewer />);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    mockCtx.selectedFolder = 'src/other';
    rerender(<FolderDiffViewer />);

    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('leaves the scroll position alone on re-renders that keep the same folder', () => {
    mockCtx.selectedFolder = 'src/deploy';
    const { rerender } = render(<FolderDiffViewer />);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    // A refresh landing new comments must not yank the reviewer back to the top.
    rerender(<FolderDiffViewer />);

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('resets even when the folder turns out to have nothing to show', () => {
    mockCtx.comparison = { files: [file({ filename: 'src/deploy/Unchanged.tsx', status: 'unchanged' })] };
    mockCtx.selectedFolder = 'src/deploy';

    render(<FolderDiffViewer />);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });
});
