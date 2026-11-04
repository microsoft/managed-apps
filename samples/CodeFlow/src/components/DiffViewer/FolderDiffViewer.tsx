import { useLayoutEffect, useMemo, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { useSettings } from '../../settings/useSettings';
import { parsePatch } from '../../utils/diffParser';
import type { FileChange } from '../../types';
import { InlineDiff } from './InlineDiff';
import { SplitDiff } from './SplitDiff';
import { useFileComments } from './useFileComments';
import { RenameNotice } from './RenameNotice';
import { getRenameInfo, noDiffMessage } from '../../utils/renameInfo';
import { useSyntaxHighlight } from './useSyntaxHighlight';
import { scrollDiffPaneToTop } from '../../utils/diffPane';
import { renderCell } from './renderCell';
import type { MarkRange } from './cellLayers';
import type { SearchColumn } from './diffSearchModel';

/** The folder view has no find widget and no word diff, so syntax is the only layer. */
const NO_MARKS: MarkRange[] = [];

/** Renders diffs for all files under the selected folder in a scrollable combined view. */
export function FolderDiffViewer() {
  const { comparison, selectedFolder, viewMode, actions } = useCodeFlow();

  // Picking a folder swaps what the diff pane renders, but not the pane itself,
  // so the scroll offset of whatever was open survives the switch and drops the
  // reviewer somewhere in the middle of the folder. Reset it before paint so
  // they always start at the top of the folder's first file.
  useLayoutEffect(() => {
    if (!selectedFolder) return;
    scrollDiffPaneToTop();
  }, [selectedFolder]);

  const folderFiles = useMemo(() => {
    if (!comparison || !selectedFolder) return [];
    const prefix = selectedFolder + '/';
    return comparison.files.filter(
      (f) => f.filename.startsWith(prefix) && f.status !== 'unchanged',
    );
  }, [comparison, selectedFolder]);

  if (folderFiles.length === 0) {
    return (
      <div className="diff diff--empty">
        <p>No changed files in this folder.</p>
      </div>
    );
  }

  return (
    <div className="diff diff--folder">
      {folderFiles.map((file) => (
        <FolderFileDiff
          key={file.filename}
          file={file}
          viewMode={viewMode}
          onSelectFile={actions.selectFile}
        />
      ))}
    </div>
  );
}

/** A single file's diff inside the folder combined view, with a collapsible header. */
function FolderFileDiff({
  file,
  viewMode,
  onSelectFile,
}: {
  file: FileChange;
  viewMode: 'inline' | 'split';
  onSelectFile: (filename: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const diff = useMemo(() => parsePatch(file.patch), [file.patch]);
  const basename = file.filename.split('/').pop() ?? file.filename;
  const { composer, startComment, extrasRow, threadBadges } = useFileComments(file.filename, diff);
  const { settings } = useSettings();
  const rename = getRenameInfo(file);

  // 'both' rather than settings.diffSide: the folder view renders SplitDiff
  // without a sideMode prop, so both columns are always on screen here.
  const syntax = useSyntaxHighlight(diff, viewMode, 'both', file.filename, settings.syntaxHighlight);
  const renderContent = useMemo(() => {
    if (!syntax.active) return undefined;
    return (column: SearchColumn, rowKey: string, text: string) =>
      renderCell(text, NO_MARKS, syntax.tokensFor(column, rowKey), syntax.deferRendering);
  }, [syntax]);

  return (
    <div className={syntax.active ? 'folder-file diff--syntax' : 'folder-file'}>
      <div className="folder-file__header" onClick={() => setCollapsed((v) => !v)}>
        <span className={`ffolder__chevron ${collapsed ? 'ffolder__chevron--collapsed' : ''}`}>
          ▸
        </span>
        <span className="folder-file__name">
          {basename}
          {rename && (
            <span className="diff__moved" title={rename.summary}>
              ↪ {rename.badge}
            </span>
          )}
          <span className="folder-file__stat">
            {file.additions > 0 && <span className="frow__add"> +{file.additions}</span>}
            {file.deletions > 0 && <span className="frow__del"> −{file.deletions}</span>}
          </span>
        </span>
        <span className="folder-file__path">{file.filename}</span>
        <button
          className="btn btn--sm folder-file__view"
          onClick={(e) => { e.stopPropagation(); onSelectFile(file.filename); }}
          title="Open this file individually"
        >
          View
        </button>
      </div>
      {!collapsed && (
        <>
          <RenameNotice info={rename} />
          {diff.isEmpty ? (
            <div className="diff__nopatch">{noDiffMessage(rename)}</div>
          ) : viewMode === 'inline' ? (
            <InlineDiff
              diff={diff}
              onStartComment={startComment}
              commentRange={composer}
              extrasRow={extrasRow}
              threadBadges={threadBadges}
              renderContent={renderContent}
            />
          ) : (
            <SplitDiff
              diff={diff}
              onStartComment={startComment}
              commentRange={composer}
              extrasRow={extrasRow}
              threadBadges={threadBadges}
              renderContent={renderContent}
            />
          )}
        </>
      )}
    </div>
  );
}
