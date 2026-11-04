import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileChange, RepoRef } from '../../types';
import { GitHubService } from '../../services/githubService';
import { compareFileContents, type FileComparison } from '../../utils/fileComparison';
import { InlineDiff } from '../DiffViewer/InlineDiff';
import { SplitDiff } from '../DiffViewer/SplitDiff';

const noExtras = () => null;

interface Props {
  repo: RepoRef;
  baseSha: string;
  headSha: string;
  files: FileChange[];
  initialFile?: string;
  onClose(): void;
}

type Loaded = { request: object } & (
  | { result: FileComparison; error?: never }
  | { error: string; result?: never }
);

export function FileCompareDialog({ repo, baseSha, headSha, files, initialFile, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const leftSelect = useRef<HTMLSelectElement>(null);
  const [leftPath, setLeftPath] = useState(() => files.find((file) => file.filename === initialFile)?.filename ?? '');
  const [rightPath, setRightPath] = useState('');
  const [pair, setPair] = useState<{ left: string; right: string } | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'inline'>('split');
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const a = files.find((file) => file.filename === (swapped ? pair?.right : pair?.left));
  const b = files.find((file) => file.filename === (swapped ? pair?.left : pair?.right));
  const leftRef = a?.status === 'removed' ? baseSha : headSha;
  const rightRef = b?.status === 'removed' ? baseSha : headSha;
  const leftFilename = a?.filename;
  const rightFilename = b?.filename;
  const request = useMemo(() => leftFilename && rightFilename ? ({
    repo: { owner: repo.owner, name: repo.name },
    left: { path: leftFilename, ref: leftRef },
    right: { path: rightFilename, ref: rightRef },
    attempt,
  }) : null, [repo.owner, repo.name, leftFilename, rightFilename, leftRef, rightRef, attempt]);
  const current = loaded?.request === request ? loaded : null;
  const showingComparison = !!request;
  const validSelection = leftPath !== rightPath
    && files.some((file) => file.filename === leftPath)
    && files.some((file) => file.filename === rightPath);

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (showingComparison) closeButton.current?.focus();
    else leftSelect.current?.focus();
  }, [showingComparison]);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    const read = async (file: typeof request.left) => {
      const content = await GitHubService.getFileContent(request.repo, file.path, file.ref);
      if (content === undefined) {
        throw new Error(`Could not load ${file.path} at ${file.ref.slice(0, 12)}. The file may be unavailable or access may have failed.`);
      }
      return content;
    };
    Promise.all([read(request.left), read(request.right)])
      .then(([leftContent, rightContent]) => {
        if (!cancelled) {
          setLoaded({ request, result: compareFileContents(leftContent, rightContent) });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoaded({ request, error: error instanceof Error ? error.message : 'Could not compare these files.' });
        }
      });
    return () => { cancelled = true; };
  }, [request]);

  return (
    <dialog
      className={`filecompare${showingComparison ? '' : ' filecompare--picker'}`}
      ref={dialog}
      aria-labelledby="filecompare-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      }}
    >
      <header className="filecompare__header">
        <h2 id="filecompare-title">Compare files</h2>
        {showingComparison && (
          <>
            <button className="btn btn--sm" onClick={() => setPair(null)}>Change files</button>
            <button className="btn btn--sm" onClick={() => setSwapped(!swapped)}>Swap sides</button>
            <div className="diff__viewtoggle" role="group" aria-label="Comparison view">
              <button className="btn btn--sm" aria-pressed={viewMode === 'inline'} onClick={() => setViewMode('inline')}>Inline</button>
              <button className="btn btn--sm" aria-pressed={viewMode === 'split'} onClick={() => setViewMode('split')}>Side by side</button>
            </div>
          </>
        )}
        <button className="btn btn--sm" onClick={onClose} aria-label="Close file comparison" ref={closeButton}>Close</button>
      </header>
      {!showingComparison ? (
        <form className="filecompare__picker" onSubmit={(event) => {
          event.preventDefault();
          if (!validSelection) return;
          setSwapped(false);
          setPair({ left: leftPath, right: rightPath });
        }}>
          <p>Choose two changed files from this PR range. File-list filters and seen marks do not limit these choices.</p>
          <label>
            Left file
            <select ref={leftSelect} value={leftPath} onChange={(event) => setLeftPath(event.target.value)} required>
              <option value="">Choose a file</option>
              {files.map((file) => <option key={file.filename} value={file.filename} disabled={file.filename === rightPath}>{file.filename}</option>)}
            </select>
          </label>
          <label>
            Right file
            <select value={rightPath} onChange={(event) => setRightPath(event.target.value)} required>
              <option value="">Choose a file</option>
              {files.map((file) => <option key={file.filename} value={file.filename} disabled={file.filename === leftPath}>{file.filename}</option>)}
            </select>
          </label>
          <div className="filecompare__picker-actions">
            <button className="btn" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn--primary" type="submit" disabled={!validSelection}>Compare</button>
          </div>
        </form>
      ) : (
        <div className="filecompare__paths">
          <div><strong>Left:</strong> {a?.filename} <span>({a?.status === 'removed' ? 'range start, deleted file' : 'range end'} @ {leftRef.slice(0, 12)})</span></div>
          <div><strong>Right:</strong> {b?.filename} <span>({b?.status === 'removed' ? 'range start, deleted file' : 'range end'} @ {rightRef.slice(0, 12)})</span></div>
        </div>
      )}
      <p className="filecompare__notice">
        Read-only comparison of two files, not the PR diff. Return to the PR diff to comment.
        {' '}CRLF and LF line endings are treated as equivalent.
      </p>
      {showingComparison && !current && <p className="filecompare__notice" role="status">Loading file comparison...</p>}
      {current?.error && (
        <div className="filecompare__notice" role="alert">
          {current.error}{' '}
          <button className="btn btn--sm" onClick={() => setAttempt(attempt + 1)}>Retry</button>
        </div>
      )}
      {current?.result && (
        <>
          <p className="filecompare__notice" role="status">
            {current.result.additions === 0 && current.result.deletions === 0
              ? 'No differences (ignoring CRLF versus LF).'
              : `+${current.result.additions} / -${current.result.deletions} lines`}
          </p>
          <div className="filecompare__body">
            {viewMode === 'split'
              ? <SplitDiff diff={current.result.diff} extrasRow={noExtras} threadBadges={noExtras} />
              : <InlineDiff diff={current.result.diff} extrasRow={noExtras} threadBadges={noExtras} />}
          </div>
        </>
      )}
    </dialog>
  );
}
