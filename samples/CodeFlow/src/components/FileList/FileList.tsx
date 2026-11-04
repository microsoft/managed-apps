import { useMemo, useState, useCallback } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { getSettings } from '../../settings/settingsStore';
import type { FileChange, FileChangeStatus } from '../../types';
import { DESCRIPTION_FILE } from '../../types';
import { getRenameInfo } from '../../utils/renameInfo';
import { scrollDiffPaneToTop } from '../../utils/diffPane';
import { FileCompareDialog } from '../FileCompareDialog/FileCompareDialog';

const STATUS_LETTER: Record<FileChangeStatus, string> = {
  added: 'A',
  removed: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C',
  changed: 'M',
  unchanged: 'U',
};

function statusClass(status: FileChangeStatus): string {
  switch (status) {
    case 'added':
      return 'fstat--added';
    case 'removed':
      return 'fstat--removed';
    case 'renamed':
      return 'fstat--renamed';
    default:
      return 'fstat--modified';
  }
}

/** Extract the filename (basename) from a full path. */
function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}

/* ----------------------------- Tree model ------------------------------ */

interface TreeNode {
  /** Display name of this node (folder segment or file basename). */
  name: string;
  /** Full path from root (for folders, the folder path; for files, the file path). */
  path: string;
  /** Child folders. */
  children: TreeNode[];
  /** Files directly in this folder. */
  files: FileChange[];
}

/** Build a nested tree from a flat list of file paths. */
function buildTree(files: FileChange[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [], files: [] };

  for (const file of files) {
    const parts = file.filename.split('/');
    let node = root;
    // Walk folder segments, creating intermediate nodes as needed.
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      const folderPath = parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.name === segment);
      if (!child) {
        child = { name: segment, path: folderPath, children: [], files: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.files.push(file);
  }

  return root;
}

/** Collect all file paths under a tree node (recursively). */
function allFilesUnder(node: TreeNode): FileChange[] {
  const result: FileChange[] = [...node.files];
  for (const child of node.children) {
    result.push(...allFilesUnder(child));
  }
  return result;
}

/** Collect all folder paths under a node (inclusive). */
function allFolderPaths(node: TreeNode): string[] {
  const result: string[] = [node.path];
  for (const child of node.children) {
    result.push(...allFolderPaths(child));
  }
  return result;
}

export function FileList({ onCollapse }: { onCollapse?: () => void }) {
  const { pr, comparison, comparisonLoading, selectedFile, selectedFolder, seen, threads, actions } = useCodeFlow();
  const [filter, setFilter] = useState('');
  const [invertFilter, setInvertFilter] = useState(false);
  const [hideSeen, setHideSeen] = useState(() => getSettings().hideSeenFiles);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const scope = JSON.stringify([pr?.coordinates, comparison?.baseSha, comparison?.headSha, comparisonLoading]);
  const [compareScope, setCompareScope] = useState<string | null>(null);
  if (compareScope && compareScope !== scope) setCompareScope(null);
  const canCompare = !!(pr && comparison?.baseSha && comparison.headSha && !comparisonLoading);

  const files = useMemo(() => {
    const compFiles = comparison?.files ?? [];
    return compFiles.filter((f) => f.status !== 'unchanged');
  }, [comparison]);

  const threadCountByFile = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of threads) {
      if (t.status === 'resolved' || t.closed) continue;
      map[t.filename] = (map[t.filename] ?? 0) + 1;
    }
    return map;
  }, [threads]);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return files.filter((file) => {
      if (hideSeen && seen[file.filename]) return false;
      if (!f) return true;
      const matches = file.filename.toLowerCase().includes(f);
      return invertFilter ? !matches : matches;
    });
  }, [files, filter, invertFilter, hideSeen, seen]);

  const tree = useMemo(() => buildTree(visible), [visible]);

  const seenCount = files.filter((f) => seen[f.filename]).length;

  const markShownSeen = useCallback(() => {
    for (const file of visible) {
      if (!seen[file.filename]) actions.toggleSeen(file.filename);
    }
  }, [visible, seen, actions]);

  const toggleFolder = useCallback((folderPath: string) => {
    setCollapsed((prev) => ({ ...prev, [folderPath]: !prev[folderPath] }));
  }, []);

  /** Collapse a folder and all its descendant folders. */
  const collapseRecursive = useCallback((node: TreeNode, collapse: boolean) => {
    const paths = allFolderPaths(node);
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const p of paths) {
        next[p] = collapse;
      }
      return next;
    });
  }, []);

  /** Toggle seen for all files under a folder (recursive). */
  const toggleFolderSeen = useCallback(
    (node: TreeNode) => {
      const nodeFiles = allFilesUnder(node);
      const allSeen = nodeFiles.every((f) => seen[f.filename]);
      const targetFiles = allSeen
        ? nodeFiles.filter((f) => seen[f.filename])
        : nodeFiles.filter((f) => !seen[f.filename]);
      for (const f of targetFiles) {
        actions.toggleSeen(f.filename);
      }
    },
    [seen, actions],
  );

  /**
   * Selecting a folder resets the diff pane's scroll (see FolderDiffViewer),
   * but re-clicking the folder you are already in changes no state, so nothing
   * would fire. Treat that click as the "take me back to the top" it looks like.
   */
  const selectFolder = useCallback(
    (folderPath: string) => {
      if (folderPath === selectedFolder) scrollDiffPaneToTop();
      actions.selectFolder(folderPath);
    },
    [selectedFolder, actions],
  );

  // Count threads not associated with any changed file (top-level / PR-level).
  const descriptionThreadCount = useMemo(() => {
    const changedFiles = new Set((comparison?.files ?? []).map((f) => f.filename));
    return threads.filter(
      (t) => t.status !== 'resolved' && !t.closed && (!t.filename || t.filename === '(unknown)' || !changedFiles.has(t.filename)),
    ).length;
  }, [threads, comparison]);

  return (
    <div className="filelist">
      <div className="filelist__heading">
        <span>Files</span>
        {pr && (
          <button
            className="linkbtn"
            title="Compare two files from this PR"
            disabled={!canCompare || files.length < 2}
            onClick={() => setCompareScope(scope)}
          >
            Compare files
          </button>
        )}
        {onCollapse && (
          <button
            className="filelist__collapse"
            onClick={onCollapse}
            title="Hide the file explorer"
            aria-label="Hide the file explorer"
            aria-expanded
          >
            «
          </button>
        )}
      </div>
      <div className="filelist__toolbar">
        <input
          className="filelist__filter"
          placeholder="Filter by file name"
          aria-label="Filter by file name"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label
          className="filelist__check filelist__invert"
          title="Show files whose paths do not contain the filter text"
        >
          <input
            type="checkbox"
            checked={invertFilter}
            onChange={(e) => setInvertFilter(e.target.checked)}
          />
          Invert
        </label>
      </div>
      <div className="filelist__meta">
        <span>
          {files.length} file{files.length === 1 ? '' : 's'} · {seenCount} seen
        </span>
        <div className="filelist__meta-actions">
          <label className="filelist__check" title="Hide files marked as seen">
            <input
              type="checkbox"
              checked={hideSeen}
              onChange={(e) => setHideSeen(e.target.checked)}
            />
            Hide seen
          </label>
          <button className="linkbtn" title="Mark all files as seen" onClick={() => actions.markAllSeen(true)}>
            All
          </button>
          <button
            className="linkbtn"
            title="Mark files matching the current filters as seen"
            disabled={visible.length === 0}
            onClick={markShownSeen}
          >
            Shown
          </button>
          <button className="linkbtn" title="Unmark all files as seen" onClick={() => actions.markAllSeen(false)}>
            None
          </button>
        </div>
      </div>

      <ul className="filelist__items">
        <li
          className={`frow frow--description ${selectedFile === DESCRIPTION_FILE ? 'frow--selected' : ''}`}
          onClick={() => actions.selectFile(DESCRIPTION_FILE)}
        >
          <span className="frow__desc-icon">📋</span>
          <span className="frow__desc-label">Description</span>
          {descriptionThreadCount > 0 && (
            <span className="frow__threads">💬 {descriptionThreadCount}</span>
          )}
        </li>
        {tree.children.map((child) => (
          <FolderNode
            key={child.path}
            node={child}
            depth={0}
            collapsed={collapsed}
            selectedFile={selectedFile}
            selectedFolder={selectedFolder}
            seen={seen}
            threadCountByFile={threadCountByFile}
            onToggleFolder={toggleFolder}
            onCollapseRecursive={collapseRecursive}
            onSelect={actions.selectFile}
            onSelectFolder={selectFolder}
            onToggleSeen={actions.toggleSeen}
            onToggleFolderSeen={toggleFolderSeen}
          />
        ))}
        {/* Files at root level (no folder) */}
        {tree.files.map((file) => (
          <FileRow
            key={file.filename}
            file={file}
            depth={0}
            selected={file.filename === selectedFile}
            seen={Boolean(seen[file.filename])}
            threadCount={threadCountByFile[file.filename] ?? 0}
            onSelect={() => actions.selectFile(file.filename)}
            onToggleSeen={() => actions.toggleSeen(file.filename)}
          />
        ))}
        {visible.length === 0 && (
          <li className="filelist__empty">No files match.</li>
        )}
      </ul>
      {pr && comparison && canCompare && compareScope === scope && (
        <FileCompareDialog
          repo={pr.coordinates}
          baseSha={comparison.baseSha}
          headSha={comparison.headSha}
          files={files}
          initialFile={selectedFile}
          onClose={() => setCompareScope(null)}
        />
      )}
    </div>
  );
}

/* ----------------------------- FolderNode ------------------------------ */

interface FolderNodeProps {
  node: TreeNode;
  depth: number;
  collapsed: Record<string, boolean>;
  selectedFile: string | undefined;
  selectedFolder: string | undefined;
  seen: Record<string, boolean>;
  threadCountByFile: Record<string, number>;
  onToggleFolder(path: string): void;
  onCollapseRecursive(node: TreeNode, collapse: boolean): void;
  onSelect(filename: string): void;
  onSelectFolder(folderPath: string): void;
  onToggleSeen(filename: string): void;
  onToggleFolderSeen(node: TreeNode): void;
}

function FolderNode({
  node,
  depth,
  collapsed,
  selectedFile,
  selectedFolder,
  seen,
  threadCountByFile,
  onToggleFolder,
  onCollapseRecursive,
  onSelect,
  onSelectFolder,
  onToggleSeen,
  onToggleFolderSeen,
}: FolderNodeProps) {
  const isCollapsed = Boolean(collapsed[node.path]);
  const nodeFiles = useMemo(() => allFilesUnder(node), [node]);
  const allSeen = nodeFiles.length > 0 && nodeFiles.every((f) => seen[f.filename]);
  const someSeen = !allSeen && nodeFiles.some((f) => seen[f.filename]);
  const threadCount = nodeFiles.reduce(
    (sum, f) => sum + (threadCountByFile[f.filename] ?? 0),
    0,
  );
  const isSelected = selectedFolder === node.path;

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.altKey) {
      onCollapseRecursive(node, !isCollapsed);
    } else {
      onToggleFolder(node.path);
    }
  };

  const handleSeenClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFolderSeen(node);
  };

  const handleFolderClick = () => {
    onSelectFolder(node.path);
  };

  return (
    <>
      <li
        className={`ffolder ${allSeen ? 'ffolder--seen' : ''} ${isSelected ? 'ffolder--selected' : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={handleFolderClick}
      >
        <span
          className={`ffolder__chevron ${isCollapsed ? 'ffolder__chevron--collapsed' : ''}`}
          onClick={handleChevronClick}
        >
          ▸
        </span>
        <input
          type="checkbox"
          className="ffolder__seen"
          checked={allSeen}
          ref={(el) => { if (el) el.indeterminate = someSeen; }}
          onClick={handleSeenClick}
          onChange={() => {}}
          title={allSeen ? 'Unmark folder as seen' : 'Mark folder as seen'}
        />
        <span className="ffolder__icon">📁</span>
        <span className="ffolder__name" title={node.path}>{node.name}</span>
        {threadCount > 0 && (
          <span className="ffolder__threads">💬 {threadCount}</span>
        )}
      </li>
      {!isCollapsed && (
        <>
          {node.children.map((child) => (
            <FolderNode
              key={child.path}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              selectedFile={selectedFile}
              selectedFolder={selectedFolder}
              seen={seen}
              threadCountByFile={threadCountByFile}
              onToggleFolder={onToggleFolder}
              onCollapseRecursive={onCollapseRecursive}
              onSelect={onSelect}
              onSelectFolder={onSelectFolder}
              onToggleSeen={onToggleSeen}
              onToggleFolderSeen={onToggleFolderSeen}
            />
          ))}
          {node.files.map((file) => (
            <FileRow
              key={file.filename}
              file={file}
              depth={depth + 1}
              selected={file.filename === selectedFile}
              seen={Boolean(seen[file.filename])}
              threadCount={threadCountByFile[file.filename] ?? 0}
              onSelect={() => onSelect(file.filename)}
              onToggleSeen={() => onToggleSeen(file.filename)}
            />
          ))}
        </>
      )}
    </>
  );
}

/* ------------------------------- FileRow ------------------------------- */

interface FileRowProps {
  file: FileChange;
  depth: number;
  selected: boolean;
  seen: boolean;
  threadCount: number;
  onSelect(): void;
  onToggleSeen(): void;
}

function FileRow({ file, depth, selected, seen, threadCount, onSelect, onToggleSeen }: FileRowProps) {
  // A move keeps the basename and reports +0/−0, so this row would otherwise
  // look like a file with nothing to review. The badge is the only thing
  // separating it from one.
  const rename = getRenameInfo(file);

  return (
    <li
      className={[
        'frow',
        selected ? 'frow--selected' : '',
        seen ? 'frow--seen' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      <input
        type="checkbox"
        className="frow__seen"
        checked={seen}
        onChange={onToggleSeen}
        onClick={(e) => e.stopPropagation()}
        title={seen ? 'Marked as seen' : 'Mark as seen'}
        aria-label={`Mark ${file.filename} as seen`}
      />
      <button className="frow__main" onClick={onSelect} title={rename?.summary ?? file.filename}>
        <span className={`fstat ${statusClass(file.status)}`} title={rename?.summary ?? file.status}>
          {STATUS_LETTER[file.status]}
        </span>
        <span className="frow__name">
          <span className="frow__base">{basename(file.filename)}</span>
        </span>
        <span className="frow__counts">
          {rename && (
            <span className="frow__moved" title={rename.summary}>
              ↪ {rename.badge}
            </span>
          )}
          {threadCount > 0 && (
            <span className="frow__threads" title={`${threadCount} open comment(s)`}>
              💬 {threadCount}
            </span>
          )}
          {file.additions > 0 && <span className="frow__add">+{file.additions}</span>}
          {file.deletions > 0 && <span className="frow__del">−{file.deletions}</span>}
        </span>
      </button>
    </li>
  );
}
