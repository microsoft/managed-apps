import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCodeFlow, useFileThreads } from '../../state/useCodeFlow';
import type { CommentThread, ParsedDiff } from '../../types';
import { CommentThreadView, NewCommentComposer } from '../CommentThread/CommentThread';
import { anchorKey, type Anchor } from './diffViewerUtils';
import { findLineDraftAnchor, lineDraftKey } from '../../utils/commentDrafts';
import { ThreadBadge } from './ThreadBadge';
import type { StartComment } from './CommentLineButton';
import { commentLineLabel, commentTopLine } from '../../utils/commentRange';

export interface FileComments {
  threads: CommentThread[];
  expandedThreads: Set<string>;
  expandThread(id: string): void;
  collapseThread(id: string): void;
  composer: Anchor | null;
  setComposer(anchor: Anchor | null): void;
  startComment: StartComment;
  /** The same draft-aware composer in source rows and rendered Markdown. */
  renderComposer(hint?: string): ReactNode;
  /** Build the extras <tr> (expanded threads + active composer) for an anchor. */
  extrasRow(anchor: Anchor | null, colSpan: number, key: string): ReactNode;
  /** Render gutter badges for collapsed threads on a given anchor. */
  threadBadges(anchor: Anchor | null): ReactNode;
}

/**
 * Comment plumbing for a single file's diff: thread lookup by anchor,
 * expand/collapse state, and the inline composer. Shared by the single-file
 * diff view and the per-file diffs rendered inside the folder view.
 */
export function useFileComments(filename: string | undefined, diff: ParsedDiff): FileComments {
  const { comparison, toIndex, actions, prKey } = useCodeFlow();
  const threads = useFileThreads(filename);
  // Reopen on the line that was being commented on, if there's a draft waiting
  // for it. Without this the text survives a reload but has nothing to appear
  // in, since the anchor itself only ever lived in this state.
  const [composer, setComposer] = useState<Anchor | null>(() => findLineDraftAnchor(prKey, filename));
  const submitting = useRef(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  // The composer belongs to a line in one file; carrying it across a file
  // switch would drop it on whatever happened to sit at that line number next.
  const scope = `${prKey ?? ''}|${filename ?? ''}`;
  const fileRef = useRef(scope);
  useEffect(() => {
    if (fileRef.current === scope) return;
    fileRef.current = scope;
    setSelectionError(null);
    setComposer(findLineDraftAnchor(prKey, filename));
  }, [filename, prKey, scope]);

  const threadMap = useMemo(() => {
    const map = new Map<string, CommentThread[]>();
    for (const t of threads) {
      // Outdated threads never render inline. Their line is where the comment
      // was written in an earlier iteration, so it can collide with unrelated
      // code in the current one; they belong in the outdated section, which is
      // the only place that says so. DiffViewer's orphan filter matches this.
      if (t.outdated) continue;
      const key = anchorKey(t.side, commentTopLine(t));
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [threads]);

  // Explicit view overrides, one set per direction. A thread is expanded by
  // default until it settles — resolved, or closed locally — at which point it
  // collapses unless the reviewer has explicitly said otherwise.
  //
  // Deriving "settled ⇒ collapsed" rather than recording it means no effect has
  // to watch for newly-arrived or newly-closed threads and write state on every
  // poll. The thread already carries the fact; tracking it separately was a
  // second copy that could only ever drift.
  const [userCollapsed, setUserCollapsed] = useState<Set<string>>(() => new Set());
  const [userExpanded, setUserExpanded] = useState<Set<string>>(() => new Set());

  const expandedThreads = useMemo(() => {
    const set = new Set<string>();
    for (const t of threads) {
      if (userCollapsed.has(t.id)) continue;
      const settled = t.status === 'resolved' || t.closed;
      if (settled && !userExpanded.has(t.id)) continue;
      set.add(t.id);
    }
    return set;
  }, [threads, userCollapsed, userExpanded]);

  const expandThread = useCallback((id: string) => {
    setUserCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setUserExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const collapseThread = useCallback((id: string) => {
    setUserExpanded((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setUserCollapsed((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  /**
   * Text content by anchor, built once per diff.
   *
   * This is read while rendering a comment, and a comment can sit on any line,
   * so the obvious scan-until-found is O(lines) per lookup on a model that may
   * hold the whole file. Paying for one pass up front makes every lookup after
   * it free.
   */
  const lineContent = useMemo(() => {
    const map = new Map<string, string>();
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.newLineNo != null && (line.type === 'add' || line.type === 'context')) {
          const key = anchorKey('right', line.newLineNo);
          if (!map.has(key)) map.set(key, line.content);
        }
        if (line.oldLineNo != null && (line.type === 'del' || line.type === 'context')) {
          const key = anchorKey('left', line.oldLineNo);
          if (!map.has(key)) map.set(key, line.content);
        }
      }
    }
    return map;
  }, [diff]);

  /** Look up the text content for a given anchor from the parsed diff. */
  const getLineContent = useCallback(
    (anchor: Anchor): string | undefined => {
      const lines: string[] = [];
      for (let n = anchor.startLine ?? anchor.line; n <= anchor.line; n++) {
        const text = lineContent.get(anchorKey(anchor.side, n));
        if (text === undefined) return undefined;
        lines.push(text);
      }
      return lines.join('\n');
    },
    [lineContent],
  );

  const startComment = useCallback<StartComment>((anchor) => {
    if (submitting.current) {
      setSelectionError('Wait for this comment to finish sending before selecting another range.');
      return;
    }
    setSelectionError(null);
    if (anchor.startLine !== undefined && getLineContent(anchor) === undefined) {
      setComposer(anchor);
      setSelectionError('Select a continuous range of visible lines. Show the full file to include hidden lines.');
      return;
    }
    setComposer(anchor);
  }, [getLineContent]);

  const submitNewThread = useCallback(
    async (anchor: Anchor, body: string) => {
      if (!filename) return;
      if (anchor.startLine !== undefined && getLineContent(anchor) === undefined) {
        throw new Error('Show the full file before commenting on a range containing hidden lines.');
      }
      submitting.current = true;
      try {
        await actions.createThread({
          filename,
          side: anchor.side,
          line: anchor.line,
          ...(anchor.startLine !== undefined ? { startLine: anchor.startLine } : {}),
          body,
          iterationIndex: toIndex,
          commitSha: comparison?.headSha,
          lineText: getLineContent(anchor),
        });
        setComposer(null);
      } finally {
        submitting.current = false;
      }
    },
    [filename, actions, toIndex, comparison?.headSha, getLineContent],
  );

  const renderComposer = useCallback(
    (hint = 'Highlight code first, then click + beside any selected line.'): ReactNode => {
      if (!composer) return null;
      return (
        <>
          <div className="composer__range">
            Comment on {composer.side} {composer.startLine === undefined ? 'line' : 'lines'} {commentLineLabel(composer)}.
            {' '}{hint}
          </div>
          {selectionError && <div className="composer__error" role="alert">{selectionError}</div>}
          <NewCommentComposer
            key={lineDraftKey(prKey, filename, composer.side, composer.line, composer.startLine)}
            onSubmit={(body) => submitNewThread(composer, body)}
            onCancel={() => setComposer(null)}
            draftKey={lineDraftKey(prKey, filename, composer.side, composer.line, composer.startLine)}
            originalLine={getLineContent(composer)}
          />
        </>
      );
    },
    [composer, selectionError, prKey, filename, submitNewThread, getLineContent],
  );

  // Both of these are called once per rendered row, and their identity decides
  // whether a row can be skipped on re-render — see the memoised rows in
  // InlineDiff and SplitDiff. Rebuilt every render, they made every row rebuild
  // too, which on a long file is the difference between a keystroke and a
  // freeze.
  const extrasRow = useCallback(
    (anchor: Anchor | null, colSpan: number, key: string): ReactNode => {
      if (!anchor) return null;
      const aKey = anchorKey(anchor.side, anchor.line);
      const all = threadMap.get(aKey) ?? [];
      const expanded = all.filter((t) => expandedThreads.has(t.id));
      const showComposer = composer != null && anchorKey(composer.side, commentTopLine(composer)) === aKey;
      if (expanded.length === 0 && !showComposer) return null;
      return (
        <tr className="diff__extrarow" key={`extra-${key}`}>
          <td className="diff__extra" colSpan={colSpan}>
            {expanded.map((t) => (
              <CommentThreadView
                key={t.id}
                thread={t}
                originalLine={getLineContent(t)}
                lineNumber={commentTopLine(t)}
                onCollapse={() => collapseThread(t.id)}
              />
            ))}
            {showComposer && renderComposer()}
          </td>
        </tr>
      );
    },
    [
      threadMap,
      expandedThreads,
      composer,
      getLineContent,
      collapseThread,
      renderComposer,
    ],
  );

  const threadBadges = useCallback(
    (anchor: Anchor | null): ReactNode => {
      if (!anchor) return null;
      const aKey = anchorKey(anchor.side, anchor.line);
      const all = threadMap.get(aKey) ?? [];
      const collapsed = all.filter((t) => !expandedThreads.has(t.id));
      if (collapsed.length === 0) return null;
      return (
        <>
          {collapsed.map((t) => (
            <ThreadBadge key={t.id} thread={t} onClick={() => expandThread(t.id)} />
          ))}
        </>
      );
    },
    [threadMap, expandedThreads, expandThread],
  );

  return {
    threads,
    expandedThreads,
    expandThread,
    collapseThread,
    composer,
    setComposer,
    startComment,
    renderComposer,
    extrasRow,
    threadBadges,
  };
}
