import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { DiffHeader } from '../DiffHeader';
import type { FileChange } from '../../../types';
import type { DiffBlockNav as Nav } from '../useDiffBlockNav';

const file: FileChange = {
  filename: 'src/app.ts',
  status: 'modified',
  additions: 3,
  deletions: 1,
  changes: 4,
};

const nav: Nav = {
  total: 0,
  ordinal: null,
  canPrev: false,
  canNext: false,
  next: vi.fn(),
  prev: vi.fn(),
};

// Deriving the prop bag from the component and spreading it means there is no
// second, hand-maintained argument list to drift out of sync: a new required
// prop on DiffHeader fails to compile right here.
type HeaderProps = ComponentProps<typeof DiffHeader>;

function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const props: HeaderProps = {
    file,
    viewMode: 'inline',
    onViewMode: vi.fn(),
    sideMode: 'both',
    onCycleSide: vi.fn(),
    showFullFile: true,
    onToggleFullFile: vi.fn(),
    fullFileLoading: false,
    fullFileStatus: 'ready',
    fontSize: 12,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    ignoreWhitespace: false,
    onToggleWhitespace: vi.fn(),
    hiddenWhitespace: 0,
    additions: file.additions,
    deletions: file.deletions,
    wordDiff: false,
    onToggleWordDiff: vi.fn(),
    canPreview: false,
    markdownPreview: false,
    onToggleMarkdownPreview: vi.fn(),
    blockNav: nav,
    ...overrides,
  };
  render(<DiffHeader {...props} />);
  return props;
}

describe('DiffHeader — content scope toggle', () => {
  it('reads "Full file" while the whole file is shown', () => {
    renderHeader({ showFullFile: true });
    expect(screen.getByLabelText('Diff content: Full file').textContent).toContain('Full file');
  });

  it('flips to "Diff only" when the whole file is hidden', () => {
    renderHeader({ showFullFile: false, fullFileStatus: 'off' });
    const btn = screen.getByLabelText('Diff content: Diff only');
    expect(btn.textContent).toContain('Diff only');
    expect(screen.queryByLabelText('Diff content: Full file')).toBeNull();
  });

  it('flags an unavailable full file without changing the label', () => {
    renderHeader({ showFullFile: true, fullFileStatus: 'unavailable' });
    const btn = screen.getByLabelText('Diff content: Full file');
    expect(btn.textContent).toContain('⚠️');
    expect(btn.getAttribute('title')).toContain('unavailable');
  });

  it('shows a spinner while the full file loads', () => {
    renderHeader({ showFullFile: true, fullFileLoading: true });
    expect(screen.getByLabelText('Diff content: Full file').textContent).toContain('⏳');
  });

  // When the file is held back, the viewer is genuinely rendering the diff, so
  // the label has to say so — the old "unavailable" case claims "Full file"
  // while showing something else, and that is the mistake not to repeat.
  it('says "Diff only" when a large file is being held back', () => {
    renderHeader({ showFullFile: false, fullFileStatus: 'too-large' });
    const btn = screen.getByLabelText('Diff content: Diff only');
    expect(btn.textContent).toContain('Diff only');
    expect(btn.textContent).toContain('⚠️');
  });

  it('explains why a large file was held back, and that it can be forced', () => {
    renderHeader({ showFullFile: false, fullFileStatus: 'too-large' });
    const title = screen.getByLabelText('Diff content: Diff only').getAttribute('title') ?? '';
    expect(title).toContain('changed lines');
    expect(title.toLowerCase()).toContain('anyway');
  });

  it('toggles on click', () => {
    const { onToggleFullFile } = renderHeader();
    screen.getByLabelText('Diff content: Full file').click();
    expect(onToggleFullFile).toHaveBeenCalledTimes(1);
  });

  it('offers the same button to force a held-back file open', () => {
    const { onToggleFullFile } = renderHeader({
      showFullFile: false,
      fullFileStatus: 'too-large',
    });
    screen.getByLabelText('Diff content: Diff only').click();
    expect(onToggleFullFile).toHaveBeenCalledTimes(1);
  });
});

describe('DiffHeader — layout toggle', () => {
  it('is a single button naming the current layout', () => {
    renderHeader({ viewMode: 'inline' });
    expect(screen.getByLabelText('Diff layout: Inline')).toBeTruthy();
    expect(screen.queryByLabelText('Diff layout: Side by side')).toBeNull();
  });

  it('switches inline → side by side', () => {
    const { onViewMode } = renderHeader({ viewMode: 'inline' });
    screen.getByLabelText('Diff layout: Inline').click();
    expect(onViewMode).toHaveBeenCalledWith('split');
  });

  it('switches side by side → inline', () => {
    const { onViewMode } = renderHeader({ viewMode: 'split' });
    screen.getByLabelText('Diff layout: Side by side').click();
    expect(onViewMode).toHaveBeenCalledWith('inline');
  });
});

describe('DiffHeader — Markdown preview toggle', () => {
  it('is absent for a file that cannot be previewed', () => {
    renderHeader({ canPreview: false });
    expect(screen.queryByLabelText('Markdown view: Preview')).toBeNull();
    expect(screen.queryByLabelText('Markdown view: Source')).toBeNull();
  });

  it('names the state you are in', () => {
    renderHeader({ canPreview: true, markdownPreview: true });
    expect(screen.getByLabelText('Markdown view: Preview').textContent).toContain('Preview');
    expect(screen.queryByLabelText('Markdown view: Source')).toBeNull();
  });

  it('flips the label when showing source', () => {
    renderHeader({ canPreview: true, markdownPreview: false });
    expect(screen.getByLabelText('Markdown view: Source').textContent).toContain('Source');
  });

  it('toggles on click', () => {
    const { onToggleMarkdownPreview } = renderHeader({ canPreview: true, markdownPreview: false });
    screen.getByLabelText('Markdown view: Source').click();
    expect(onToggleMarkdownPreview).toHaveBeenCalledTimes(1);
  });

  it('highlights itself only while previewing', () => {
    renderHeader({ canPreview: true, markdownPreview: true });
    expect(screen.getByLabelText('Markdown view: Preview').className).toContain('btn--active');
  });

  it('disables the controls that mean nothing in a rendered view', () => {
    renderHeader({ canPreview: true, markdownPreview: true });
    const layout = screen.getByLabelText('Diff layout: Inline') as HTMLButtonElement;
    const words = screen.getByLabelText('Word diff: off') as HTMLButtonElement;
    expect(layout.disabled).toBe(true);
    expect(words.disabled).toBe(true);
    expect(layout.getAttribute('title')).toContain('Not available');
  });

  it('leaves those controls alone in source mode', () => {
    renderHeader({ canPreview: true, markdownPreview: false });
    expect((screen.getByLabelText('Diff layout: Inline') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('Word diff: off') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('DiffHeader — side toggle', () => {
  it('names the current side mode', () => {
    renderHeader({ sideMode: 'left' });
    expect(screen.getByLabelText('Diff side: Left only').textContent).toBe('Left only');
  });

  it('cycles on click', () => {
    const { onCycleSide } = renderHeader({ sideMode: 'both' });
    screen.getByLabelText('Diff side: Both sides').click();
    expect(onCycleSide).toHaveBeenCalledTimes(1);
  });

  it('highlights itself only while a side is filtered out', () => {
    renderHeader({ sideMode: 'both' });
    expect(screen.getByLabelText('Diff side: Both sides').className).not.toContain('btn--active');
  });

  it('highlights itself when showing one side', () => {
    renderHeader({ sideMode: 'right' });
    expect(screen.getByLabelText('Diff side: Right only').className).toContain('btn--active');
  });
});

describe('DiffHeader — whitespace toggle', () => {
  it('names the current whitespace state', () => {
    renderHeader({ ignoreWhitespace: true });
    expect(screen.getByLabelText('Diff whitespace: Whitespace hidden')).toBeTruthy();
    expect(screen.queryByLabelText('Diff whitespace: Whitespace shown')).toBeNull();
  });

  it('flips the label when whitespace is shown', () => {
    renderHeader({ ignoreWhitespace: false });
    expect(screen.getByLabelText('Diff whitespace: Whitespace shown')).toBeTruthy();
  });

  it('shows only its glyph, and names the state in the tooltip', () => {
    renderHeader({ ignoreWhitespace: true });
    const btn = screen.getByLabelText('Diff whitespace: Whitespace hidden');
    expect(btn.textContent).toBe('¶');
    expect(btn.getAttribute('title')).toContain('Whitespace hidden');
  });

  it('toggles on click', () => {
    const { onToggleWhitespace } = renderHeader({ ignoreWhitespace: true });
    screen.getByLabelText('Diff whitespace: Whitespace hidden').click();
    expect(onToggleWhitespace).toHaveBeenCalledTimes(1);
  });

  it('stays lit while hiding, so a default-on filter is never silent', () => {
    renderHeader({ ignoreWhitespace: true });
    expect(screen.getByLabelText('Diff whitespace: Whitespace hidden').className).toContain(
      'btn--active',
    );
  });

  it('is unlit when nothing is being hidden', () => {
    renderHeader({ ignoreWhitespace: false });
    expect(screen.getByLabelText('Diff whitespace: Whitespace shown').className).not.toContain(
      'btn--active',
    );
  });
});

describe('DiffHeader — word diff toggle', () => {
  it('shows only its glyph, and names the state in the tooltip', () => {
    renderHeader({ wordDiff: true });
    const btn = screen.getByLabelText('Word diff: on');
    expect(btn.textContent).toBe('∆W');
    expect(btn.getAttribute('title')).toContain('Word diff on');
  });

  it('names the off state without changing the glyph', () => {
    renderHeader({ wordDiff: false });
    const btn = screen.getByLabelText('Word diff: off');
    expect(btn.textContent).toBe('∆W');
    expect(btn.getAttribute('title')).toContain('Word diff off');
  });

  it('is lit only while highlighting', () => {
    renderHeader({ wordDiff: true });
    expect(screen.getByLabelText('Word diff: on').className).toContain('btn--active');
    cleanup();
    renderHeader({ wordDiff: false });
    expect(screen.getByLabelText('Word diff: off').className).not.toContain('btn--active');
  });

  it('toggles on click', () => {
    const { onToggleWordDiff } = renderHeader({ wordDiff: false });
    screen.getByLabelText('Word diff: off').click();
    expect(onToggleWordDiff).toHaveBeenCalledTimes(1);
  });
});

describe('DiffHeader — change counts', () => {
  it('renders the counts it is given rather than the file totals', () => {
    renderHeader({ additions: 1, deletions: 0, hiddenWhitespace: 4 });
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText('−0')).toBeTruthy();
  });

  it("keeps GitHub's true totals discoverable in the title while hiding", () => {
    renderHeader({ additions: 1, deletions: 0, hiddenWhitespace: 4 });
    const counts = document.body.querySelector('.diff__counts');
    expect(counts?.getAttribute('title')).toContain('+3 / −1');
    expect(counts?.className).toContain('diff__counts--reduced');
  });

  it('adds no title and no reduced styling when nothing is hidden', () => {
    renderHeader({ additions: 3, deletions: 1, hiddenWhitespace: 0 });
    const counts = document.body.querySelector('.diff__counts');
    expect(counts?.getAttribute('title')).toBeNull();
    expect(counts?.className).not.toContain('diff__counts--reduced');
  });
});

describe('DiffHeader — moved files', () => {
  it('says nothing about a file that stayed where it was', () => {
    renderHeader();
    expect(document.body.querySelector('.diff__moved')).toBeNull();
  });

  it('pins a badge next to the name, which the header keeps in view while scrolling', () => {
    renderHeader({
      file: {
        filename: 'dashboards/adx/kpi.json',
        previousFilename: 'docs/adx/kpi.json',
        status: 'renamed',
        additions: 0,
        deletions: 0,
        changes: 0,
      },
    });
    const badge = document.body.querySelector('.diff__moved');
    expect(badge?.textContent).toContain('Moved');
    expect(badge?.getAttribute('title')).toContain('docs/adx/kpi.json');
  });

  it('puts the old path in the filename tooltip, which the elision cuts off', () => {
    renderHeader({
      file: {
        filename: 'dashboards/adx/kpi.json',
        previousFilename: 'docs/adx/kpi.json',
        status: 'renamed',
        additions: 0,
        deletions: 0,
        changes: 0,
      },
    });
    const name = document.body.querySelector('.diff__filename');
    expect(name?.getAttribute('title')).toContain('docs/adx/kpi.json');
  });
});
