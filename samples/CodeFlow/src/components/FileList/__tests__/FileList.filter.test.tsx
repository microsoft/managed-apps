import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { FileList } from '../FileList';
import type { CodeFlowActions, CodeFlowState } from '../../../state/codeFlowContext';
import type { FileChange } from '../../../types';

let context: Pick<CodeFlowState, 'comparison' | 'selectedFile' | 'selectedFolder' | 'seen' | 'threads'> & {
  actions: Pick<CodeFlowActions, 'selectFile' | 'selectFolder' | 'toggleSeen' | 'markAllSeen'>;
};

vi.mock('../../../state/useCodeFlow', () => ({ useCodeFlow: () => context }));
vi.mock('../../FileCompareDialog/FileCompareDialog', () => ({ FileCompareDialog: () => null }));
vi.mock('../../../settings/settingsStore', () => ({
  getSettings: () => ({ hideSeenFiles: false }),
}));

function file(filename: string): FileChange {
  return { filename, status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '' };
}

function mockFilterContext(files: FileChange[], seen: Record<string, boolean> = {}) {
  context = {
    comparison: { baseSha: 'base', headSha: 'head', commits: [], files },
    seen,
    threads: [],
    actions: { selectFile: vi.fn(), selectFolder: vi.fn(), toggleSeen: vi.fn(), markAllSeen: vi.fn() },
  };
}

function visibleFiles(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.frow__main')]
    .map((button) => button.title)
    .sort();
}

function setFilter(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Filter by file name'), { target: { value } });
}

describe('FileList filename filtering', () => {
  const matching = ['src/Widget.test.tsx', 'tests/helper.ts'];
  const nonmatching = ['docs/guide.md', 'src/Widget.tsx'];
  const changed = [...matching, ...nonmatching].sort();

  beforeEach(() => {
    mockFilterContext([
      ...changed.map(file),
      { ...file('src/unchanged.ts'), status: 'unchanged' },
    ], { 'docs/guide.md': true });
  });

  it('keeps inclusive matching as the default and matches trimmed, case-insensitive paths', () => {
    const { container } = render(<FileList />);

    expect(visibleFiles(container)).toEqual(changed);
    setFilter('  TeSt  ');
    expect(visibleFiles(container)).toEqual(matching);
  });

  it('excludes matching paths when inverted and restores them when toggled off', () => {
    const { container } = render(<FileList />);
    const invert = screen.getByRole('checkbox', { name: 'Invert' });
    expect(invert).not.toBeChecked();

    setFilter('  TeSt  ');
    fireEvent.click(invert);
    expect(invert).toBeChecked();
    expect(visibleFiles(container)).toEqual(nonmatching);
    expect(screen.queryByTitle('tests')).not.toBeInTheDocument();

    fireEvent.click(invert);
    expect(invert).not.toBeChecked();
    expect(visibleFiles(container)).toEqual(matching);
  });

  it('recomputes inverted results when the filter text changes', () => {
    const { container } = render(<FileList />);
    setFilter('test');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Invert' }));

    setFilter('docs/');
    expect(visibleFiles(container)).toEqual(changed.filter((path) => !path.startsWith('docs/')));
  });

  it.each(['', '   '])('shows all changed files for an inverted blank filter (%j)', (blank) => {
    const { container } = render(<FileList />);
    setFilter('test');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Invert' }));

    setFilter(blank);
    expect(visibleFiles(container)).toEqual(changed);
    expect(screen.getByRole('checkbox', { name: 'Invert' })).toBeChecked();
  });

  it('applies Hide seen independently of inversion and keeps unchanged files hidden', () => {
    const { container } = render(<FileList />);
    setFilter('test');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Invert' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide seen' }));
    expect(visibleFiles(container)).toEqual(['src/Widget.tsx']);

    setFilter('');
    expect(visibleFiles(container)).toEqual(changed.filter((path) => path !== 'docs/guide.md'));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide seen' }));
    expect(visibleFiles(container)).toEqual(changed);
  });

  it('shows the empty state when everything is excluded, without hiding Description', () => {
    const { container } = render(<FileList />);
    setFilter('not-present');
    expect(screen.getByText('No files match.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Invert' }));
    expect(visibleFiles(container)).toEqual(changed);
    expect(screen.queryByText('No files match.')).not.toBeInTheDocument();

    setFilter('/');
    expect(visibleFiles(container)).toEqual([]);
    expect(screen.getByText('No files match.')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
  });

  it('treats special characters literally in both filter modes', () => {
    mockFilterContext([file('!notes[1].md'), file('notes.md')]);
    const { container } = render(<FileList />);
    setFilter('!notes[1]');
    expect(visibleFiles(container)).toEqual(['!notes[1].md']);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Invert' }));
    expect(visibleFiles(container)).toEqual(['notes.md']);
  });

  it('keeps file selection and folder seen actions scoped to displayed files', () => {
    const { container } = render(<FileList />);
    setFilter('test');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Invert' }));

    fireEvent.click(screen.getByTitle('src/Widget.tsx'));
    expect(context.actions.selectFile).toHaveBeenCalledWith('src/Widget.tsx');

    const folder = [...container.querySelectorAll('li.ffolder')].find(
      (row) => row.querySelector('.ffolder__name')?.textContent === 'src',
    );
    const seenCheckbox = folder?.querySelector('.ffolder__seen');
    if (!seenCheckbox) throw new Error('no seen checkbox for src folder');
    fireEvent.click(seenCheckbox);
    expect(context.actions.toggleSeen).toHaveBeenCalledExactlyOnceWith('src/Widget.tsx');
  });
});
