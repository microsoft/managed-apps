import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileCompareDialog } from '../FileCompareDialog';
import { GitHubService } from '../../../services/githubService';
import type { FileChange } from '../../../types';

vi.mock('../../../services/githubService', () => ({ GitHubService: { getFileContent: vi.fn() } }));

const file = (filename: string, status: FileChange['status'] = 'modified'): FileChange => ({
  filename, status, additions: 99, deletions: 99, changes: 198, patch: '@@ -1 +1 @@\n-unrelated\n+patch',
});
const props = {
  repo: { owner: 'o', name: 'r' }, baseSha: 'base', headSha: 'head',
  files: [file('sql/UpdateSales_V2.sql'), file('sql/UpdateSales_V3.sql', 'added')],
  onClose: vi.fn(),
};

function startComparison(files = props.files) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Left file' }), { target: { value: files[0].filename } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Right file' }), { target: { value: files[1].filename } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
}

const dialogMethods = ['showModal', 'close'] as const;
const originalMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
beforeAll(() => {
  // jsdom does not implement the native dialog's modal lifecycle.
  for (const name of dialogMethods) {
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true, writable: true,
      value: function (this: HTMLDialogElement) { this.open = name === 'showModal'; },
    });
  }
});
afterAll(() => {
  dialogMethods.forEach((name, i) => {
    const original = originalMethods[i];
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(GitHubService.getFileContent).mockImplementation(async (_, path) =>
    path.includes('V2') ? 'AS\nSELECT amount\nGO\n' : 'AS\nSELECT amount * 2\nGO\n');
});
afterEach(() => vi.restoreAllMocks());

describe('FileCompareDialog', () => {
  it('opens a compact picker and fetches nothing until two different files are submitted', () => {
    render(<FileCompareDialog {...props} />);
    expect(screen.getByRole('dialog')).toHaveClass('filecompare--picker');
    expect(screen.getByRole('combobox', { name: 'Left file' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Left file' }), { target: { value: props.files[0].filename } });
    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled();
    const rightSelect = screen.getByRole('combobox', { name: 'Right file' });
    expect(rightSelect.querySelector(`option[value="${props.files[0].filename}"]`)).toBeDisabled();
    fireEvent.change(rightSelect, { target: { value: props.files[1].filename } });
    expect(screen.getByRole('button', { name: 'Compare' })).toBeEnabled();
    expect(GitHubService.getFileContent).not.toHaveBeenCalled();
    fireEvent.change(rightSelect, { target: { value: props.files[0].filename } });
    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Compare' }).closest('form')!);
    expect(GitHubService.getFileContent).not.toHaveBeenCalled();
  });

  it.each([props.files[0].filename, '(description)', undefined])('preselects only a real currently open file: %s', (initialFile) => {
    render(<FileCompareDialog {...props} initialFile={initialFile} />);
    expect(screen.getByRole('combobox', { name: 'Left file' })).toHaveValue(initialFile === props.files[0].filename ? initialFile : '');
    expect(screen.getByRole('combobox', { name: 'Right file' })).toHaveValue('');
    expect(GitHubService.getFileContent).not.toHaveBeenCalled();
  });

  it('loads real contents at the ending SHA and renders a read-only split/inline diff', async () => {
    const { container } = render(<FileCompareDialog {...props} />);
    startComparison();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await screen.findByText('+1 / -1 lines');
    expect(GitHubService.getFileContent).toHaveBeenCalledWith(props.repo, props.files[0].filename, 'head');
    expect(GitHubService.getFileContent).toHaveBeenCalledWith(props.repo, props.files[1].filename, 'head');
    expect(container.querySelector('.diff__half--left.diff__line--del')).toHaveTextContent('SELECT amount');
    expect(container.querySelector('.diff__half--right.diff__line--add')).toHaveTextContent('SELECT amount * 2');
    expect(container.querySelector('.diff__addcomment')).toBeNull();
    expect(screen.queryByText('unrelated')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inline' }));
    expect(container.querySelector('.diff__table--inline')).toBeInTheDocument();
    expect(container.querySelector('.diff__addcomment')).toBeNull();
    expect(GitHubService.getFileContent).toHaveBeenCalledTimes(2);
  });

  it('uses the starting SHA for deleted files, and current paths for renamed files', async () => {
    const files = [file('old.sql', 'removed'), { ...file('new.sql', 'renamed'), previousFilename: 'previous.sql' }];
    render(<FileCompareDialog {...props} files={files} />);
    startComparison(files);
    await waitFor(() => expect(screen.queryByText('Loading file comparison...')).not.toBeInTheDocument());
    expect(GitHubService.getFileContent).toHaveBeenCalledWith(props.repo, 'old.sql', 'base');
    expect(GitHubService.getFileContent).toHaveBeenCalledWith(props.repo, 'new.sql', 'head');
    expect(screen.getByText(/range start, deleted file/)).toHaveTextContent('base');
  });

  it('treats empty strings as real content and reports identical files', async () => {
    vi.mocked(GitHubService.getFileContent).mockResolvedValue('');
    render(<FileCompareDialog {...props} />);
    startComparison();
    await screen.findByText('No differences (ignoring CRLF versus LF).');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports unavailable content without treating it as an empty file and permits retry', async () => {
    vi.mocked(GitHubService.getFileContent).mockResolvedValue(undefined);
    const { container } = render(<FileCompareDialog {...props} />);
    startComparison();
    expect(await screen.findByRole('alert')).toHaveTextContent(`Could not load ${props.files[0].filename}`);
    expect(container.querySelector('.diff__table')).toBeNull();
    vi.mocked(GitHubService.getFileContent).mockResolvedValue('recovered\n');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('No differences (ignoring CRLF versus LF).');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['access denied', () => Promise.reject(new Error('access denied'))],
    ['Binary files', () => Promise.resolve('\0')],
    ['too large', () => Promise.resolve('x'.repeat(1_000_001))],
  ])('surfaces %s instead of a success-shaped comparison', async (message, response) => {
    vi.mocked(GitHubService.getFileContent).mockImplementation(response);
    const { container } = render(<FileCompareDialog {...props} />);
    startComparison();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(container.querySelector('.diff__table')).toBeNull();
  });

  it('swaps the files and never displays old content under the new labels', async () => {
    const { container } = render(<FileCompareDialog {...props} />);
    startComparison();
    await screen.findByText('+1 / -1 lines');
    fireEvent.click(screen.getByRole('button', { name: 'Swap sides' }));
    expect(container.querySelector('.diff__table')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await screen.findByText('+1 / -1 lines');
    expect(container.querySelector('.filecompare__paths > div')).toHaveTextContent(props.files[1].filename);
    expect(container.querySelector('.diff__half--left.diff__line--del')).toHaveTextContent('SELECT amount * 2');
  });

  it.each(['repository', 'ref'] as const)('discards pending results after a %s change', async (kind) => {
    const pending: Array<(content: string) => void> = [];
    vi.mocked(GitHubService.getFileContent).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { container, rerender } = render(<FileCompareDialog {...props} />);
    startComparison();
    const changed = kind === 'repository' ? { repo: { owner: 'other', name: 'repo' } }
      : { headSha: 'new-head' };
    rerender(<FileCompareDialog {...props} {...changed} />);
    await act(async () => { pending[0]('stale\n'); pending[1]('stale\n'); });
    expect(container.querySelector('.diff__table')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await act(async () => { pending[2]('fresh\n'); pending[3]('fresh\n'); });
    expect(container.querySelector('.diff__table')).toHaveTextContent('fresh');
    expect(container.querySelector('.diff__table')).not.toHaveTextContent('stale');
  });

  it('changes the pair without leaving the dialog or showing an abandoned request', async () => {
    const pending: Array<(content: string) => void> = [];
    vi.mocked(GitHubService.getFileContent).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const files = [...props.files, file('another.sql')];
    const { container } = render(<FileCompareDialog {...props} files={files} />);
    startComparison();
    fireEvent.click(screen.getByRole('button', { name: 'Change files' }));
    expect(screen.getByRole('combobox', { name: 'Left file' })).toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Right file' })).toHaveValue(props.files[1].filename);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => { pending[0]('stale\n'); pending[1]('stale\n'); });
    expect(container.querySelector('.diff__table')).toBeNull();
    startComparison([props.files[0], files[2]]);
    expect(GitHubService.getFileContent).toHaveBeenLastCalledWith(props.repo, 'another.sql', 'head');
    await act(async () => { pending[2]('fresh\n'); pending[3]('fresh\n'); });
    expect(container.querySelector('.diff__table')).toHaveTextContent('fresh');
    expect(container.querySelector('.diff__table')).not.toHaveTextContent('stale');
  });

  it('does not retain swap orientation when choosing a new pair', async () => {
    render(<FileCompareDialog {...props} />);
    startComparison();
    await screen.findByText('+1 / -1 lines');
    fireEvent.click(screen.getByRole('button', { name: 'Swap sides' }));
    await screen.findByText('+1 / -1 lines');
    fireEvent.click(screen.getByRole('button', { name: 'Change files' }));
    startComparison();
    await screen.findByText('+1 / -1 lines');
    expect(document.querySelector('.filecompare__paths > div')).toHaveTextContent(props.files[0].filename);
  });

  it.each([false, true])('closes from either picker or comparison without leaking shortcuts (comparing: %s)', (comparing) => {
    const documentKey = vi.fn();
    document.addEventListener('keydown', documentKey);
    const { unmount } = render(<FileCompareDialog {...props} />);
    if (comparing) startComparison();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(documentKey).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close file comparison' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    unmount();
    document.removeEventListener('keydown', documentKey);
  });

  it('focuses the picker and returns focus to the launcher on unmount', () => {
    const launcher = document.createElement('button');
    document.body.appendChild(launcher);
    launcher.focus();
    const { unmount } = render(<FileCompareDialog {...props} />);
    expect(screen.getByRole('combobox', { name: 'Left file' })).toHaveFocus();
    unmount();
    expect(launcher).toHaveFocus();
    launcher.remove();
  });
});
