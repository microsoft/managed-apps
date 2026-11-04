import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { FileList } from '../FileList';
import type { FileChange } from '../../../types';

vi.mock('../../../state/useCodeFlow', () => ({ useCodeFlow: vi.fn() }));
vi.mock('../../FileCompareDialog/FileCompareDialog', () => ({
  FileCompareDialog: ({ files, initialFile, onClose }: { files: FileChange[]; initialFile?: string; onClose(): void }) => (
    <div role="dialog">
      <span>Initial: {initialFile}</span>
      {files.map((file) => <span key={file.filename}>{file.filename}</span>)}
      <button onClick={onClose}>Close comparison</button>
    </div>
  ),
}));

vi.mock('../../../settings/settingsStore', () => ({
  getSettings: () => ({ hideSeenFiles: false }),
}));

import { useCodeFlow } from '../../../state/useCodeFlow';
const mockUseCodeFlow = vi.mocked(useCodeFlow);

function file(filename: string): FileChange {
  return { filename, status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '' };
}

const selectFolder = vi.fn();

function mockCtx(
  selectedFolder: string | null,
  files = [file('src/deploy/Alpha.tsx'), file('src/other/Gamma.tsx')],
  seen: Record<string, boolean> = {},
) {
  const actions = { selectFile: vi.fn(), selectFolder, toggleSeen: vi.fn(), markAllSeen: vi.fn() };
  mockUseCodeFlow.mockReturnValue({
    comparison: { files },
    selectedFile: undefined,
    selectedFolder,
    seen,
    threads: [],
    actions,
  } as unknown as ReturnType<typeof useCodeFlow>);
  return actions;
}

/** Click the sidebar row for a folder, found by the name it renders. */
function clickFolder(container: HTMLElement, name: string) {
  const row = [...container.querySelectorAll('li.ffolder')].find(
    (li) => li.querySelector('.ffolder__name')?.textContent === name,
  );
  if (!row) throw new Error(`no folder row for ${name}`);
  fireEvent.click(row);
}

describe('FileList folder clicks', () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  let pane: HTMLElement;

  beforeEach(() => {
    selectFolder.mockClear();
    // The diff has no scroll container of its own — this pane is the one that
    // scrolls, and jsdom gives it neither layout nor a working scrollTo.
    pane = document.createElement('div');
    pane.className = 'workarea__center';
    scrollTo = vi.fn();
    (pane as unknown as { scrollTo: unknown }).scrollTo = scrollTo;
    document.body.appendChild(pane);
  });

  describe('FileList cross-file comparison', () => {
    function setup() {
      mockCtx(null);
      const existing = mockUseCodeFlow();
      const state = {
        ...existing,
        pr: {
          coordinates: { owner: 'o', name: 'r', number: 1 },
          title: '', body: '', state: 'open' as const, draft: false, merged: false,
          baseSha: 'base', headSha: 'head', baseRef: 'main', headRef: 'feature',
          htmlUrl: '', author: { login: 'author' },
        },
        comparisonLoading: false,
        comparison: {
          baseSha: 'base', headSha: 'head', commits: [],
          files: [file('sql/procs/UpdateSales_V2.sql'), file('UpdateSales_V3.sql')],
        },
      };
      mockUseCodeFlow.mockReturnValue(state);
      return state;
    }

    it('provides exactly one entry point without per-file actions or instructions', () => {
      const state = setup();
      mockUseCodeFlow.mockReturnValue({ ...state, selectedFile: 'UpdateSales_V3.sql' });
      const { container } = render(<FileList />);
      expect(screen.getAllByRole('button', { name: /compare/i })).toHaveLength(1);
      expect(container.querySelector('.frow__compare')).toBeNull();
      expect(container.querySelector('.filelist__compare')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Compare files' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('Initial: UpdateSales_V3.sql');
      expect(screen.getByRole('dialog')).toHaveTextContent('sql/procs/UpdateSales_V2.sql');
      expect(state.actions.selectFile).not.toHaveBeenCalled();
      expect(state.actions.toggleSeen).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Close comparison' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Compare files' })).toBeInTheDocument();
    });

    it('offers all changed files even when the main tree filters and seen marks hide them', () => {
      const state = setup();
      mockUseCodeFlow.mockReturnValue({
        ...state, seen: { 'UpdateSales_V3.sql': true },
        comparison: { ...state.comparison, files: [...state.comparison.files, { ...file('unchanged.sql'), status: 'unchanged' }] },
      });
      render(<FileList />);
      fireEvent.change(screen.getByPlaceholderText('Filter by file name'), { target: { value: 'V3' } });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Hide seen' }));
      expect(screen.getByText('No files match.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Compare files' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('sql/procs/UpdateSales_V2.sql');
      expect(screen.getByRole('dialog')).toHaveTextContent('UpdateSales_V3.sql');
      expect(screen.getByRole('dialog')).not.toHaveTextContent('unchanged.sql');
    });

    it.each(['PR', 'range', 'loading'] as const)('clears comparison selection when the %s changes and does not resurrect it', (kind) => {
      const state = setup();
      const { rerender } = render(<FileList />);
      fireEvent.click(screen.getByRole('button', { name: 'Compare files' }));
      const changed = kind === 'PR' ? { pr: { ...state.pr, coordinates: { ...state.pr.coordinates, number: 2 } } }
        : kind === 'range' ? { comparison: { ...state.comparison, headSha: 'next' } }
          : { comparisonLoading: true };
      mockUseCodeFlow.mockReturnValue({ ...state, ...changed });
      rerender(<FileList />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      mockUseCodeFlow.mockReturnValue(state);
      rerender(<FileList />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps comparison choices independent of inverse filtering and marking shown files seen', () => {
      const state = setup();
      render(<FileList />);
      fireEvent.change(screen.getByRole('textbox', { name: 'Filter by file name' }), { target: { value: 'V2' } });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Invert' }));
      fireEvent.click(screen.getByRole('button', { name: 'Shown' }));
      expect(state.actions.toggleSeen).toHaveBeenCalledExactlyOnceWith('UpdateSales_V3.sql');
      fireEvent.click(screen.getByRole('button', { name: 'Compare files' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('sql/procs/UpdateSales_V2.sql');
      expect(screen.getByRole('dialog')).toHaveTextContent('UpdateSales_V3.sql');
    });

    it('disables the entry point when fewer than two changed files are available', () => {
      const state = setup();
      mockUseCodeFlow.mockReturnValue({ ...state, comparison: { ...state.comparison, files: [state.comparison.files[0]] } });
      render(<FileList />);
      expect(screen.getByRole('button', { name: 'Compare files' })).toBeDisabled();
    });
  });

  describe('FileList shown seen marks', () => {
    const files = [
      file('tests/Alpha.ts'),
      file('tests/nested/Beta.ts'),
      file('tests/Seen.ts'),
      file('src/App.ts'),
      file('src/Seen.ts'),
      { ...file('tests/Unchanged.ts'), status: 'unchanged' as const },
    ];
    const seen = { 'tests/Seen.ts': true, 'src/Seen.ts': true };

    it('marks only filter matches, without toggling existing marks or unchanged files', () => {
      const actions = mockCtx(null, files, seen);
      const { getByPlaceholderText, getByRole } = render(<FileList />);

      fireEvent.change(getByPlaceholderText('Filter by file name'), { target: { value: ' TESTS ' } });
      fireEvent.click(getByRole('button', { name: 'Shown' }));

      expect(actions.toggleSeen.mock.calls).toEqual([['tests/Alpha.ts'], ['tests/nested/Beta.ts']]);
      expect(actions.markAllSeen).not.toHaveBeenCalled();
      expect(actions.selectFile).not.toHaveBeenCalled();
    });

    it('marks remaining matches with Hide seen enabled and removes them from the tree', () => {
      const actions = mockCtx(null, files, seen);
      const { getByPlaceholderText, getByRole, getByText, rerender } = render(<FileList />);

      fireEvent.change(getByPlaceholderText('Filter by file name'), { target: { value: 'tests' } });
      fireEvent.click(getByRole('checkbox', { name: 'Hide seen' }));
      fireEvent.click(getByRole('button', { name: 'Shown' }));

      expect(actions.toggleSeen.mock.calls).toEqual([['tests/Alpha.ts'], ['tests/nested/Beta.ts']]);
      const updatedActions = mockCtx(null, files, {
        ...seen,
        'tests/Alpha.ts': true,
        'tests/nested/Beta.ts': true,
      });
      rerender(<FileList />);

      expect(getByText('No files match.')).toBeInTheDocument();
      expect(getByRole('button', { name: 'Shown' })).toBeDisabled();

      fireEvent.change(getByPlaceholderText('Filter by file name'), { target: { value: '' } });
      expect(getByRole('checkbox', { name: 'Mark src/App.ts as seen' })).not.toBeChecked();
      fireEvent.click(getByRole('button', { name: 'Shown' }));
      expect(updatedActions.toggleSeen.mock.calls).toEqual([['src/App.ts']]);
    });

    it('marks all displayed changed files without a name filter', () => {
      const actions = mockCtx(null, files, seen);
      const { getByRole } = render(<FileList />);

      fireEvent.click(getByRole('button', { name: 'Shown' }));

      expect(actions.toggleSeen.mock.calls).toEqual([
        ['tests/Alpha.ts'], ['tests/nested/Beta.ts'], ['src/App.ts'],
      ]);
    });

    it('includes filter matches inside collapsed folders', () => {
      const actions = mockCtx(null, files, seen);
      const { container, getByPlaceholderText, getByRole, queryByRole } = render(<FileList />);
      fireEvent.change(getByPlaceholderText('Filter by file name'), { target: { value: 'tests' } });
      const chevron = container.querySelector('.ffolder__chevron');
      if (!chevron) throw new Error('Missing tests folder chevron');
      fireEvent.click(chevron);
      expect(queryByRole('checkbox', { name: 'Mark tests/Alpha.ts as seen' })).not.toBeInTheDocument();

      fireEvent.click(getByRole('button', { name: 'Shown' }));

      expect(actions.toggleSeen.mock.calls).toEqual([['tests/Alpha.ts'], ['tests/nested/Beta.ts']]);
    });

    it('does not toggle off files that are already all seen', () => {
      const actions = mockCtx(null, [file('tests/Seen.ts')], seen);
      const { getByRole } = render(<FileList />);

      fireEvent.click(getByRole('button', { name: 'Shown' }));
      fireEvent.click(getByRole('button', { name: 'Shown' }));

      expect(actions.toggleSeen).not.toHaveBeenCalled();
      expect(actions.markAllSeen).not.toHaveBeenCalled();
    });

    it.each([
      { name: 'empty comparison', files: [] },
      { name: 'nonmatching filter', files },
    ])('does nothing for a $name', ({ files: comparisonFiles }) => {
      const actions = mockCtx(null, comparisonFiles, seen);
      const { getByPlaceholderText, getByRole } = render(<FileList />);
      fireEvent.change(getByPlaceholderText('Filter by file name'), { target: { value: 'not-a-file' } });

      expect(getByRole('button', { name: 'Shown' })).toBeDisabled();
      fireEvent.click(getByRole('button', { name: 'Shown' }));

      expect(actions.toggleSeen).not.toHaveBeenCalled();
      expect(actions.markAllSeen).not.toHaveBeenCalled();
    });

    it('keeps All and None global even when name and seen filters are active', () => {
      const actions = mockCtx(null, files, seen);
      const { getByPlaceholderText, getByRole } = render(<FileList />);
      fireEvent.change(getByPlaceholderText('Filter by file name'), { target: { value: 'tests' } });
      fireEvent.click(getByRole('checkbox', { name: 'Hide seen' }));

      fireEvent.click(getByRole('button', { name: 'All' }));
      fireEvent.click(getByRole('button', { name: 'None' }));

      expect(actions.markAllSeen.mock.calls).toEqual([[true], [false]]);
      expect(actions.toggleSeen).not.toHaveBeenCalled();
    });
  });

  afterEach(() => {
    pane.remove();
  });

  it('selects a folder you are not already in, and leaves the scrolling to it', () => {
    mockCtx(null);
    const { container } = render(<FileList />);

    clickFolder(container, 'deploy');

    expect(selectFolder).toHaveBeenCalledWith('src/deploy');
    // The selection changed, so the folder view resets the scroll itself.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls back to the top when the folder you are already in is clicked again', () => {
    mockCtx('src/deploy');
    const { container } = render(<FileList />);

    clickFolder(container, 'deploy');

    // Nothing downstream re-runs, because the selection is unchanged.
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(selectFolder).toHaveBeenCalledWith('src/deploy');
  });
});
