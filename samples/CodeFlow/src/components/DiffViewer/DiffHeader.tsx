import type { FileChange } from '../../types';
import { diffSideLabel, diffSideTitle, type DiffSideMode } from '../../utils/diffSide';
import { getRenameInfo } from '../../utils/renameInfo';
import { CopyLinkButton } from '../CopyLinkButton/CopyLinkButton';
import { DiffBlockNav } from './DiffBlockNav';
import type { DiffBlockNav as Nav } from './useDiffBlockNav';

/**
 * Why the viewer is showing what it is showing.
 *
 * `off` is the reviewer's own choice; the other three are the viewer declining,
 * for three different reasons that want three different sentences — it is still
 * fetching, it could not fetch, or it could but the file is long enough that
 * expanding it would make the app crawl.
 */
export type FullFileStatus = 'off' | 'loading' | 'ready' | 'unavailable' | 'too-large';

export function DiffHeader({
  file,
  viewMode,
  onViewMode,
  sideMode,
  onCycleSide,
  showFullFile,
  onToggleFullFile,
  fullFileLoading,
  fullFileStatus,
  fontSize,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  ignoreWhitespace,
  onToggleWhitespace,
  hiddenWhitespace,
  additions,
  deletions,
  wordDiff,
  onToggleWordDiff,
  canPreview,
  markdownPreview,
  onToggleMarkdownPreview,
  blockNav,
  deepLink,
}: {
  file: FileChange;
  viewMode: 'inline' | 'split';
  onViewMode: (m: 'inline' | 'split') => void;
  sideMode: DiffSideMode;
  onCycleSide: () => void;
  showFullFile: boolean;
  onToggleFullFile: () => void;
  fullFileLoading: boolean;
  fullFileStatus: FullFileStatus;
  fontSize: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  /** Whether whitespace-only changes are currently folded away. */
  ignoreWhitespace: boolean;
  onToggleWhitespace: () => void;
  /** How many whitespace-only lines are being hidden right now. */
  hiddenWhitespace: number;
  /** Change counts as rendered, which differ from GitHub's when hiding. */
  additions: number;
  deletions: number;
  /** Whether word-level diff highlights are enabled. */
  wordDiff: boolean;
  onToggleWordDiff: () => void;
  /** Whether this file can be shown rendered — true only for Markdown. */
  canPreview: boolean;
  /** Whether the rendered view is the one currently on screen. */
  markdownPreview: boolean;
  onToggleMarkdownPreview: () => void;
  blockNav: Nav;
  /** Shareable link to this file. Empty when no PR is loaded. */
  deepLink?: string;
}) {
  // Every control in the toggle group is a flip: the label always names the
  // state you are in, and clicking moves on to the next one.
  const tooLarge = fullFileStatus === 'too-large';
  const scopeName = showFullFile ? 'Full file' : 'Diff only';
  const scopeIcon = fullFileLoading
    ? '⏳'
    : fullFileStatus === 'unavailable' || tooLarge
      ? '⚠️'
      : showFullFile
        ? '📄'
        : '📝';
  const scopeTitle = tooLarge
    ? 'This file is long enough that expanding it would make the app crawl — showing only the changed lines. Click to expand it anyway.'
    : fullFileStatus === 'unavailable'
      ? 'Full file content unavailable — showing changes only. Click to switch to diff only.'
      : showFullFile
        ? 'Showing the whole file — click to show only the changed lines'
        : 'Showing only the changed lines — click to show the whole file';

  const layoutName = viewMode === 'inline' ? 'Inline' : 'Side by side';
  const layoutTitle =
    viewMode === 'inline'
      ? 'Inline layout — click to switch to side by side'
      : 'Side-by-side layout — click to switch to inline';

  const wsName = ignoreWhitespace ? 'Whitespace hidden' : 'Whitespace shown';
  const wsTitle = ignoreWhitespace
    ? 'Whitespace hidden — hiding changes that are only whitespace. Click to show them.'
    : 'Whitespace shown — showing every change, whitespace included. Click to hide whitespace-only ones.';

  const wdTitle = wordDiff
    ? 'Word diff on — highlighting the changed words within a line. Click to turn off.'
    : 'Word diff off — a rewritten line is coloured whole. Click to highlight the changed words.';

  // Markdown is the one language whose source is harder to read than its
  // output, so it gets a switch the others don't need.
  const mdName = markdownPreview ? 'Preview' : 'Source';
  const mdTitle = markdownPreview
    ? 'Showing rendered Markdown, with each block marked as changed — click to read the raw source'
    : 'Showing the raw Markdown source — click to read it rendered';

  // Neither of these describes anything in a rendered view: there are no lines
  // to align side by side, and no line to highlight words within.
  const notInPreview = markdownPreview
    ? 'Not available while previewing rendered Markdown'
    : undefined;

  // The filename clips from the left so the basename survives, which is exactly
  // where an "old → new" prefix would be cut off. Give the move its own pill
  // ahead of the path instead: the header is sticky, so this is the one label
  // that stays on screen once the banner has scrolled away.
  const rename = getRenameInfo(file);

  return (
    <div className="diff__header">
      {rename && (
        <span className="diff__moved" title={rename.summary}>
          ↪ {rename.badge}
        </span>
      )}
      <span className="diff__filename diff__filename--elide-left" title={rename?.summary ?? file.filename}>
        <bdi>{file.filename}</bdi>
      </span>
      <CopyLinkButton link={deepLink ?? ''} title="Copy link to this file" />
      <span
        className={`diff__counts ${hiddenWhitespace > 0 ? 'diff__counts--reduced' : ''}`}
        title={
          hiddenWhitespace > 0
            ? `+${additions} / −${deletions} after hiding whitespace-only changes. `
              + `GitHub reports +${file.additions} / −${file.deletions} for this file.`
            : undefined
        }
      >
        <span className="frow__add">+{additions}</span>
        <span className="frow__del">−{deletions}</span>
      </span>
      <div className="diff__zoom">
        <button className="btn btn--sm diff__zoom-btn" onClick={onZoomOut} title="Zoom out (smaller font)">−</button>
        <button
          className="btn btn--sm diff__zoom-label"
          onClick={onZoomReset}
          title="Reset to default (12px)"
        >
          {fontSize}px
        </button>
        <button className="btn btn--sm diff__zoom-btn" onClick={onZoomIn} title="Zoom in (larger font)">+</button>
      </div>
      <DiffBlockNav nav={blockNav} />
      <div className="diff__viewtoggle">
        {canPreview && (
          <button
            className={`btn btn--sm ${markdownPreview ? 'btn--active' : ''}`}
            onClick={onToggleMarkdownPreview}
            title={mdTitle}
            aria-label={`Markdown view: ${mdName}`}
          >
            {markdownPreview ? '👁' : '✎'} {mdName}
          </button>
        )}
        <button
          className={`btn btn--sm btn--glyph ${ignoreWhitespace ? 'btn--active' : ''}`}
          onClick={onToggleWhitespace}
          title={wsTitle}
          aria-label={`Diff whitespace: ${wsName}`}
        >
          ¶
        </button>
        <button
          className={`btn btn--sm btn--glyph ${wordDiff ? 'btn--active' : ''}`}
          onClick={onToggleWordDiff}
          title={notInPreview ?? wdTitle}
          aria-label={`Word diff: ${wordDiff ? 'on' : 'off'}`}
          disabled={markdownPreview}
        >
          ∆W
        </button>
        <button
          className={`btn btn--sm ${showFullFile ? 'btn--active' : ''}`}
          onClick={onToggleFullFile}
          title={scopeTitle}
          aria-label={`Diff content: ${scopeName}`}
        >
          {scopeIcon} {scopeName}
        </button>
        <button
          className="btn btn--sm"
          onClick={() => onViewMode(viewMode === 'inline' ? 'split' : 'inline')}
          title={notInPreview ?? layoutTitle}
          aria-label={`Diff layout: ${layoutName}`}
          disabled={markdownPreview}
        >
          {layoutName}
        </button>
        <button
          className={`btn btn--sm ${sideMode !== 'both' ? 'btn--active' : ''}`}
          onClick={onCycleSide}
          title={diffSideTitle(sideMode)}
          aria-label={`Diff side: ${diffSideLabel(sideMode)}`}
        >
          {diffSideLabel(sideMode)}
        </button>
      </div>
    </div>
  );
}
