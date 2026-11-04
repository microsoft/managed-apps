import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { parsePatch, buildFullFileDiff } from '../../utils/diffParser';
import { collapseWhitespaceOnlyChanges } from '../../utils/whitespaceDiff';
import type { DiffSide, ParsedDiff } from '../../types';
import { DESCRIPTION_FILE } from '../../types';
import { GitHubService } from '../../services/githubService';
import { buildDeepLink } from '../../utils/deepLink';
import { anchorKey, lineAnchor, scrollDiffRowIntoView, scrollThreadIntoView, cssEscape } from './diffViewerUtils';
import { findRowKeyForLine } from './rowForLine';
import { planLineReveal, type RevealPresentation } from './lineReveal';
import { LineFocusNotice } from './LineFocusNotice';
import { DiffHeader, type FullFileStatus } from './DiffHeader';
import { WhitespaceNotice } from './WhitespaceNotice';
import { RenameNotice } from './RenameNotice';
import { getRenameInfo, noDiffMessage } from '../../utils/renameInfo';
import { computeDiffBlocks, countDiffBlocks } from './diffBlocks';
import { useDiffBlockNav, type NavFile } from './useDiffBlockNav';
import { InlineDiff } from './InlineDiff';
import { SplitDiff } from './SplitDiff';
import { MarkdownPreview } from './MarkdownPreview';
import { buildMarkdownPreview, isMarkdownPath } from '../../utils/markdownPreview';
import { OrphanedThreads } from './OrphanedThreads';
import { ChangeMap } from './ChangeMap';
import { FolderDiffViewer } from './FolderDiffViewer';
import { DescriptionView } from './DescriptionView';
import { useFileComments } from './useFileComments';
import { buildSearchCells, type SearchColumn } from './diffSearchModel';
import { useDiffSearch } from './useDiffSearch';
import { DiffSearchBox } from './DiffSearchBox';
import { filterDiffToSide, nextDiffSideMode, sideFilterEmptyMessage, type DiffSideMode } from '../../utils/diffSide';
import { isOversizeForFullFile } from '../../utils/fullFileBudget';
import {
  DEFAULT_SETTINGS,
  MAX_SETTINGS_FONT_SIZE,
  MIN_SETTINGS_FONT_SIZE,
  SETTINGS_FONT_SIZE_STEP,
} from '../../settings/settings';
import { useSettings } from '../../settings/useSettings';
import { useWordDiff } from './useWordDiff';
import { useSelectionHighlight } from './useSelectionHighlight';
import { useSyntaxHighlight } from './useSyntaxHighlight';
import { renderCell } from './renderCell';
import { overlayMarks, type MarkRange } from './cellLayers';
import { findSeed } from '../../utils/selectionToken';
import { commentTopLine } from '../../utils/commentRange';
import { createLogger } from '../../lib/logger';

const log = createLogger('diff');

const NO_MARKS: MarkRange[] = [];


export function DiffViewer() {
  const { comparison, selectedFile, selectedFolder, viewMode, actions, pr, focusRequest, lineFocusRequest } = useCodeFlow();
  const { consumeLineFocus } = actions;
  const { settings, update } = useSettings();

  // Whole file or changed lines only is a persisted preference, not session
  // state: the toolbar button writes straight back to it, the same way the diff
  // side cycle does below. A reviewer who wants whole files wants them on the
  // next file and after the next reload too, so there is nothing to reset.
  const showFullFile = settings.defaultFullFile;

  // Both/left/right cycles from one button, and the choice is the setting, so
  // it follows the reviewer from file to file.
  //
  // The one exception is the override below, which exists so that clicking a
  // cross-file search result can reveal a line this filter is hiding. It is
  // keyed to the filename like the whitespace and word-diff overrides, so it
  // lapses on its own, and cycling the button clears it — a deliberate choice
  // still beats one the viewer made on the reviewer's behalf.
  const [sideOverride, setSideOverride] = useState<{ file: string; value: DiffSideMode } | null>(null);
  const sideMode =
    sideOverride && sideOverride.file === selectedFile ? sideOverride.value : settings.diffSide;
  const cycleSide = useCallback(() => {
    setSideOverride(null);
    update({ diffSide: nextDiffSideMode(sideMode) });
  }, [sideMode, update]);

  // Zoom is the same value the settings panel exposes as "code font size", so the
  // toolbar buttons and the settings slider stay in agreement — and the choice
  // is remembered with the reviewer's settings.
  const fontSize = settings.defaultFontSize;

  const zoomIn = useCallback(() => {
    update({
      defaultFontSize: Math.min(fontSize + SETTINGS_FONT_SIZE_STEP, MAX_SETTINGS_FONT_SIZE),
    });
  }, [fontSize, update]);

  const zoomOut = useCallback(() => {
    update({
      defaultFontSize: Math.max(fontSize - SETTINGS_FONT_SIZE_STEP, MIN_SETTINGS_FONT_SIZE),
    });
  }, [fontSize, update]);

  const zoomReset = useCallback(() => {
    update({ defaultFontSize: DEFAULT_SETTINGS.defaultFontSize });
  }, [update]);

  const file = comparison?.files.find((f) => f.filename === selectedFile);

  const shouldFetchFullFile = !!(
    selectedFile &&
    selectedFile !== DESCRIPTION_FILE &&
    pr &&
    comparison &&
    showFullFile &&
    file &&
    file.status !== 'removed'
  );
  const owner = pr?.coordinates.owner;
  const repoName = pr?.coordinates.name;
  const headSha = comparison?.headSha;
  const contentRequest = useMemo(
    () => shouldFetchFullFile && owner && repoName && selectedFile && headSha
      ? { repo: { owner, name: repoName }, path: selectedFile, ref: headSha }
      : null,
    [shouldFetchFullFile, owner, repoName, selectedFile, headSha],
  );
  const [loadedContent, setLoadedContent] = useState<{
    request: NonNullable<typeof contentRequest>;
    content: string | undefined;
  } | null>(null);
  // Never combine the next patch with the previous file's content, even for the
  // render before effects run: that bypasses the size guard and expands stale rows.
  const fullFileContent = contentRequest && loadedContent?.request === contentRequest
    ? loadedContent.content
    : undefined;
  const fullFileLoading = !!contentRequest && loadedContent?.request !== contentRequest;

  useEffect(() => {
    if (!contentRequest) return;
    let cancelled = false;
    GitHubService.getFileContent(contentRequest.repo, contentRequest.path, contentRequest.ref).then((content) => {
      if (!cancelled) {
        setLoadedContent({ request: contentRequest, content });
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        log.warn('Full-file content could not be loaded', error);
        setLoadedContent({ request: contentRequest, content: undefined });
      }
    });
    return () => { cancelled = true; };
  }, [contentRequest]);

  // Expanding to the whole file costs per line of the *file*, and pays it again
  // on every re-render; past a point that reads as the app hanging rather than
  // as a big file. Over budget it waits to be asked a second time, and the
  // answer is remembered per file so it lapses when the reviewer moves on —
  // the same shape as the whitespace and word-diff overrides below. Where that
  // point sits is the reviewer's to move, and they can switch it off entirely.
  const [fullFileOverride, setFullFileOverride] = useState<{ file: string; value: boolean } | null>(null);
  const forcedFullFile =
    fullFileOverride && fullFileOverride.file === selectedFile ? fullFileOverride.value : false;

  const oversizeFullFile = useMemo(
    () => isOversizeForFullFile(fullFileContent, settings.fullFileLineLimit),
    [fullFileContent, settings.fullFileLineLimit],
  );

  /** Asked for, too big, and not yet insisted upon. */
  const fullFileSuppressed = showFullFile && oversizeFullFile && !forcedFullFile;
  const effectiveFullFile = showFullFile && !fullFileSuppressed;

  const toggleFullFile = useCallback(() => {
    // While it is being held back, the button's job is to let it through.
    if (fullFileSuppressed) {
      if (selectedFile) setFullFileOverride({ file: selectedFile, value: true });
      return;
    }
    setFullFileOverride(null);
    update({ defaultFullFile: !showFullFile });
  }, [fullFileSuppressed, selectedFile, showFullFile, update]);

  const rawDiff: ParsedDiff = useMemo(() => {
    if (effectiveFullFile && fullFileContent != null) {
      return buildFullFileDiff(file?.patch, fullFileContent);
    }
    return parsePatch(file?.patch);
  }, [file?.patch, effectiveFullFile, fullFileContent]);

  // Hiding whitespace-only changes and highlighting changed words are both
  // persisted defaults, but a reviewer needs to be able to overrule either one
  // for the file in front of them without changing it for every file. Keying the
  // override to the filename means it lapses on its own when they move on — no
  // effect, no stale state.
  const [wsOverride, setWsOverride] = useState<{ file: string; value: boolean } | null>(null);
  const ignoreWhitespace =
    wsOverride && wsOverride.file === selectedFile ? wsOverride.value : settings.ignoreWhitespace;

  const toggleWhitespace = useCallback(() => {
    if (!selectedFile) return;
    setWsOverride({ file: selectedFile, value: !ignoreWhitespace });
  }, [selectedFile, ignoreWhitespace]);

  const showWhitespace = useCallback(() => {
    if (!selectedFile) return;
    setWsOverride({ file: selectedFile, value: false });
  }, [selectedFile]);

  const [wdOverride, setWdOverride] = useState<{ file: string; value: boolean } | null>(null);
  const wordDiffEnabled =
    wdOverride && wdOverride.file === selectedFile ? wdOverride.value : settings.wordDiff;

  const toggleWordDiff = useCallback(() => {
    if (!selectedFile) return;
    setWdOverride({ file: selectedFile, value: !wordDiffEnabled });
  }, [selectedFile, wordDiffEnabled]);

  // Same per-file override again, for reading a Markdown file rendered rather
  // than as source. Only ever true for Markdown: every other language reviews
  // better as text, so the switch isn't offered at all.
  const canPreview = isMarkdownPath(selectedFile);
  const [mdOverride, setMdOverride] = useState<{ file: string; value: boolean } | null>(null);
  const markdownPreview =
    canPreview
    && (mdOverride && mdOverride.file === selectedFile
      ? mdOverride.value
      : settings.markdownPreview);

  const toggleMarkdownPreview = useCallback(() => {
    if (!selectedFile) return;
    setMdOverride({ file: selectedFile, value: !markdownPreview });
  }, [selectedFile, markdownPreview]);

  // Collapse before anything else reads the model. A side filter, the change
  // map, search and block navigation are all presentation over this shape, and
  // they must agree with what is on screen; collapsing afterwards would leave
  // them navigating to changes the reviewer cannot see. It also has to run
  // first on its own terms: pairing a deletion with its replacement is only
  // possible while both sides are still present.
  const whitespace = useMemo(
    () =>
      ignoreWhitespace
        ? collapseWhitespaceOnlyChanges(rawDiff)
        : {
            diff: rawDiff,
            collapsed: 0,
            additions: file?.additions ?? 0,
            deletions: file?.deletions ?? 0,
            rawAdditions: file?.additions ?? 0,
            rawDeletions: file?.deletions ?? 0,
          },
    [ignoreWhitespace, rawDiff, file?.additions, file?.deletions],
  );

  const collapsedDiff = whitespace.diff;

  // Everything downstream (find, block nav, minimap, orphaned threads) works off
  // the *visible* diff, so hiding a side keeps them all in agreement.
  //
  // The two transforms do not commute, so the order here is load-bearing.
  // Recognising a deletion and its replacement as the same line requires seeing
  // both of them; the side filter's whole job is to throw one of them away.
  // Collapse first, narrow second. Reversed, the collapse would only ever see
  // half of each pair, would never match anything, and would fail silently.
  const diff: ParsedDiff = useMemo(
    () => filterDiffToSide(collapsedDiff, sideMode),
    [collapsedDiff, sideMode],
  );

  // Built from the diff *after* whitespace collapsing and the side filter, so
  // the preview and the source view are always two renderings of one model.
  const previewBlocks = useMemo(
    () => (markdownPreview ? buildMarkdownPreview(diff) : []),
    [markdownPreview, diff],
  );

  // A line the reviewer asked for that is in no rendering of this diff. Kept in
  // state rather than merely logged, because silence is the failure mode this
  // is here to prevent. It belongs to one visit to one file: a warning raised
  // about `a.ts` has nothing to say about the next file opened, and nothing to
  // say about the next visit back either — by then the reviewer has navigated
  // twice since the click that failed.
  const [unreachableLine, setUnreachableLine] = useState<
    { file: string; side: DiffSide; line: number } | null
  >(null);
  // Retiring it on the way past, during render, rather than from an effect: the
  // warning must already be gone in the commit that first paints the new file,
  // or it flashes on a file it was never about. This is React's documented way
  // to reset state when the thing it describes changes.
  const [noticeFile, setNoticeFile] = useState(selectedFile);
  if (noticeFile !== selectedFile) {
    setNoticeFile(selectedFile);
    setUnreachableLine(null);
  }
  const unreachableHere = unreachableLine?.file === selectedFile ? unreachableLine : null;

  // Whichever navigation started most recently owns the viewport. Both the
  // cross-file landing below and the thread focus further down take a token, so
  // an older retry loop stands down instead of dragging the reviewer back.
  const navTokenRef = useRef(0);

  // The file on screen right now, for the landing loop to consult between
  // retries. It cannot read `selectedFile` from its closure: that would be the
  // file as it stood when the request arrived, which is exactly the thing it
  // needs to notice has changed.
  const selectedFileRef = useRef(selectedFile);
  useEffect(() => {
    selectedFileRef.current = selectedFile;
  });

  // Everything the landing loop needs, refreshed every render. It reads through
  // this rather than closing over the values so that re-renders — a toggle, a
  // full file arriving — never restart a landing. Same pattern as `livePrRef`
  // in usePrLoader.
  const presentation: RevealPresentation = { markdownPreview, ignoreWhitespace, sideMode };
  const landingRef = useRef({ rawDiff, collapsedDiff, diff, viewMode, presentation });
  useEffect(() => {
    landingRef.current = { rawDiff, collapsedDiff, diff, viewMode, presentation };
  });

  // "The whole file" in the sense that matters to the reviewer: nothing real is
  // left once the whitespace is folded away.
  const whitespaceWholeFile = whitespace.collapsed > 0
    && whitespace.additions === 0
    && whitespace.deletions === 0;

  const fullFileStatus: FullFileStatus = !showFullFile
    ? 'off'
    : fullFileLoading
      ? 'loading'
      : fullFileSuppressed
        ? 'too-large'
        : fullFileContent != null
          ? 'ready'
          : 'unavailable';

  const {
    threads,
    expandedThreads,
    expandThread,
    collapseThread,
    composer,
    startComment,
    renderComposer,
    extrasRow,
    threadBadges,
  } = useFileComments(selectedFile, diff);

  // ---- In-file find (VSCode-style) ----------------------------------------
  const diffRootRef = useRef<HTMLDivElement>(null);
  const searchCells = useMemo(
    () => buildSearchCells(diff, viewMode, sideMode),
    [diff, viewMode, sideMode],
  );
  const search = useDiffSearch(searchCells, selectedFile ?? undefined);
  const {
    open: searchOpen,
    openFind: openSearch,
    close: closeSearch,
    activeHitId: searchActiveHitId,
  } = search;
  const searchable =
    !!file
    && !diff.isEmpty
    && !markdownPreview
    && selectedFile !== DESCRIPTION_FILE
    && !selectedFolder;

  // ---- Word-level diff highlights -----------------------------------------
  const wordDiff = useWordDiff(diff, viewMode, sideMode);

  // ---- Occurrence highlights for the selected word -------------------------
  // Off while the find widget is open: the two would fight over the same layer,
  // and find is the more deliberate of the two.
  const selection = useSelectionHighlight(
    searchCells,
    searchable && !searchOpen && settings.selectionHighlight,
    diffRootRef,
  );

  // ---- Syntax highlighting -------------------------------------------------
  const syntax = useSyntaxHighlight(
    diff,
    viewMode,
    sideMode,
    selectedFile ?? undefined,
    settings.syntaxHighlight,
  );

  // Marks and syntax tokens are different layers, not competing ones: a find
  // hit inside a string literal is both at once. Only the mark layer is
  // exclusive — search takes it over from word diff while the find widget is
  // open, because two overlapping sets of <mark>s would be unreadable.
  //
  // Selection highlights are the exception: they answer "where else is this
  // word", which is worth knowing on a changed line too, so they are layered
  // over the word diff rather than replacing it.
  const searchMarksFor = search.marksFor;
  const wordMarksFor = wordDiffEnabled && wordDiff.hasHighlights ? wordDiff.marksFor : null;
  const selectionMarksFor = selection.active ? selection.marksFor : null;

  const marksFor = useMemo(() => {
    if (searchOpen) return searchMarksFor;
    if (!selectionMarksFor) return wordMarksFor;
    if (!wordMarksFor) return selectionMarksFor;
    return (column: SearchColumn, rowKey: string): readonly MarkRange[] =>
      overlayMarks(wordMarksFor(column, rowKey), selectionMarksFor(column, rowKey));
  }, [searchOpen, searchMarksFor, wordMarksFor, selectionMarksFor]);

  const renderContent = useMemo(() => {
    if (!marksFor && !syntax.active) return undefined;
    return (column: SearchColumn, rowKey: string, text: string) =>
      renderCell(text, marksFor?.(column, rowKey) ?? NO_MARKS, syntax.tokensFor(column, rowKey), syntax.deferRendering);
  }, [marksFor, syntax]);

  // ---- Change-block navigation (Prev/Next delta) --------------------------
  const blocks = useMemo(() => computeDiffBlocks(diff, viewMode), [diff, viewMode]);
  const navFiles: NavFile[] = useMemo(
    () =>
      (comparison?.files ?? [])
        .filter((f) => f.status !== 'unchanged')
        .map((f) => ({ filename: f.filename, hasBlocks: countDiffBlocks(f.patch) > 0 })),
    [comparison],
  );
  const blockNav = useDiffBlockNav({
    blocks,
    selectedFile,
    files: navFiles,
    selectFile: actions.selectFile,
    rootRef: diffRootRef,
  });
  const { next: nextBlock, prev: prevBlock } = blockNav;

  // Alt+Down / Alt+Up jump between change blocks, mirroring the header buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      e.preventDefault();
      if (e.key === 'ArrowDown') nextBlock();
      else prevBlock();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextBlock, prevBlock]);

  // Ctrl/Cmd+F opens the find widget (suppressing the browser find bar);
  // Escape closes it. Only active when a searchable file diff is shown.
  //
  // Shift is excluded because Ctrl+Shift+F belongs to the cross-file search
  // panel — without that guard both would fire on the one keystroke, and the
  // in-file widget would steal the focus the results panel just took.
  //
  // The seed prefers the live selection but falls back to the word the
  // occurrence highlight is drawing, because painting that highlight collapses
  // the selection out from under the browser — see findSeed().
  const highlightedToken = selection.token;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        if (!searchable) return;
        e.preventDefault();
        openSearch(findSeed(window.getSelection()?.toString(), highlightedToken));
      } else if (e.key === 'Escape' && searchOpen) {
        closeSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchable, searchOpen, openSearch, closeSearch, highlightedToken]);

  // Scroll the active match into view as the user navigates.
  useEffect(() => {
    if (!searchOpen || !searchActiveHitId) return;
    const root = diffRootRef.current;
    if (!root) return;
    let el: Element | null;
    try {
      el = root.querySelector(`[data-hit-id="${cssEscape(searchActiveHitId)}"]`);
    } catch {
      el = null;
    }
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [searchOpen, searchActiveHitId]);

  // Land on a line asked for by a cross-file search result.
  //
  // The address is a side and a line number, resolved against the diff on
  // screen — but that diff is filtered, and the filters can hide the very line
  // that was clicked. So this does not merely look: it asks what would have to
  // change for the line to be visible, applies that as a per-file override, and
  // only gives up — visibly, via the notice — once the line turns out to be in
  // no rendering of this file at all.
  //
  // The request is a one-shot: it is consumed the moment this is done with it,
  // whether that is landing, giving up, or being overtaken. An unconsumed
  // request would outlive the navigation that raised it, so simply opening that
  // file again later would replay the jump — and possibly re-widen the view —
  // without the reviewer having clicked anything. Because the request object
  // only changes when a new one is raised, depending on it is also what keeps
  // unrelated re-renders from restarting a landing already in progress.
  useEffect(() => {
    if (!lineFocusRequest) return;
    const { filename, side, line, seq } = lineFocusRequest;
    if (filename !== selectedFileRef.current) {
      // The reviewer is somewhere else entirely; this request missed its
      // moment and should not be waiting to fire when they come back.
      consumeLineFocus(seq);
      return;
    }
    const token = ++navTokenRef.current;
    let cancelled = false;
    let attempts = 0;

    const finish = () => {
      cancelled = true;
      consumeLineFocus(seq);
    };

    const tick = () => {
      // A later navigation — another result, or a thread from the comment
      // summary — owns the viewport now. Abandon this one rather than fight it.
      if (cancelled || navTokenRef.current !== token) return;
      // The reviewer has opened something else while this was retrying. Their
      // choice wins, and the request dies with the file it belonged to.
      if (selectedFileRef.current !== filename) {
        finish();
        return;
      }
      // Any previous failure belongs to a request the reviewer has replaced.
      if (attempts === 0) setUnreachableLine(null);

      const landing = landingRef.current;
      const plan = planLineReveal(
        landing.rawDiff,
        landing.collapsedDiff,
        { side, line },
        landing.presentation,
      );

      if (plan.kind === 'reveal') {
        const wanted = plan.presentation;
        const now = landing.presentation;
        if (wanted.markdownPreview !== now.markdownPreview) {
          setMdOverride({ file: filename, value: wanted.markdownPreview });
        }
        if (wanted.ignoreWhitespace !== now.ignoreWhitespace) {
          setWsOverride({ file: filename, value: wanted.ignoreWhitespace });
        }
        if (wanted.sideMode !== now.sideMode) {
          setSideOverride({ file: filename, value: wanted.sideMode });
        }
        // Re-render, then land against the revealed diff on a later tick.
        // Counted against the same budget: a reveal that never takes effect
        // must end as "unreachable", not as a spin.
        if (attempts++ < 40) {
          window.setTimeout(tick, 50);
          return;
        }
        setUnreachableLine({ file: filename, side, line });
        finish();
        return;
      }

      if (plan.kind === 'visible') {
        const rowKey = findRowKeyForLine(landing.diff, landing.viewMode, side, line);
        if (rowKey && scrollDiffRowIntoView(diffRootRef.current, rowKey)) {
          setUnreachableLine(null);
          finish();
          return;
        }
      }

      // Selecting the file and fetching its full content are both async, so an
      // early miss usually just means the diff has not arrived yet. Keep
      // trying, and only call it unreachable once the budget is spent.
      if (attempts++ < 40) {
        window.setTimeout(tick, 50);
        return;
      }
      setUnreachableLine({ file: filename, side, line });
      finish();
    };

    // Deferred rather than called inline: the first pass can flip presentation
    // state, and doing that in the effect body is a cascading render.
    const timer = window.setTimeout(tick, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lineFocusRequest, consumeLineFocus]);

  // Respond to a focus request (e.g. clicking a row in the comment summary):
  // expand the target thread and scroll it into view. Retries because switching
  // files and fetching the full file are async, so the element may not exist yet.
  //
  // Takes the navigation token as well, so that a thread the reviewer picks
  // after a search result wins — and is not overruled by the older landing.
  useEffect(() => {
    if (!focusRequest) return;
    const { threadId } = focusRequest;
    const token = ++navTokenRef.current;
    let cancelled = false;
    let attempts = 0;
    const tick = () => {
      if (cancelled || navTokenRef.current !== token) return;
      // Expand once (deferred, so this isn't a synchronous setState in the
      // effect body) so the reviewer lands on the full thread.
      if (attempts === 0) {
        expandThread(threadId);
        // This navigation supersedes the search result that failed: the
        // warning describes a journey the reviewer is no longer on.
        setUnreachableLine(null);
      }
      if (scrollThreadIntoView(threadId)) return;
      if (attempts++ < 40) window.setTimeout(tick, 50);
    };
    const timer = window.setTimeout(tick, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [focusRequest, expandThread]);

  // Find threads whose anchor line isn't present in the diff.
  //
  // Outdated threads are always treated as orphans, even when their recovered
  // line happens to exist in the current diff. That line is where the comment
  // was *written*, not where the code went, so rendering it inline would put a
  // stale comment against unrelated code with nothing to say it had moved.
  const orphanedThreads = useMemo(() => {
    if (!file || diff.isEmpty) return [];
    const diffAnchors = new Set<string>();
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        for (const side of ['left', 'right'] as const) {
          if (sideMode !== 'both' && sideMode !== side) continue;
          const a = lineAnchor(line, side);
          if (a) diffAnchors.add(anchorKey(a.side, a.line));
        }
      }
    }
    return threads.filter((t) => t.outdated || !diffAnchors.has(anchorKey(t.side, commentTopLine(t))));
  }, [threads, diff, file, sideMode]);

  // Compute change markers for the scrollbar minimap.
  const changeMarkers = useMemo(() => {
    const markers: Array<{ position: number; type: 'add' | 'del' }> = [];
    let totalLines = 0;
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add' || line.type === 'del' || line.type === 'context') {
          totalLines++;
        }
      }
    }
    if (totalLines === 0) return markers;
    let lineIdx = 0;
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add' || line.type === 'del' || line.type === 'context') {
          if (line.type === 'add' || line.type === 'del') {
            markers.push({ position: lineIdx / totalLines, type: line.type });
          }
          lineIdx++;
        }
      }
    }
    return markers;
  }, [diff]);

  if (!selectedFile && !selectedFolder) {
    return (
      <div className="diff diff--empty">
        <p>Select a file to view its changes.</p>
      </div>
    );
  }

  // Folder multi-file diff view.
  if (selectedFolder) {
    return <FolderDiffViewer />;
  }

  // Description / PR-level comments view.
  if (selectedFile === DESCRIPTION_FILE) {
    return <DescriptionView />;
  }

  // File not in comparison but has threads — show threads in an empty-file state.
  if (!file) {
    if (threads.length === 0) {
      return (
        <div className="diff diff--empty">
          <p>Select a file to view its changes.</p>
        </div>
      );
    }
    return (
      <div className="diff">
        <div className="diff__header">
          <span className="diff__filename">{selectedFile}</span>
          <span className="diff__outdated">File not in current comparison</span>
        </div>
        <OrphanedThreads
          threads={threads}
          expandedThreads={expandedThreads}
          onExpand={expandThread}
          onCollapse={collapseThread}
        />
      </div>
    );
  }

  const rename = getRenameInfo(file);

  return (
    <div
      className={syntax.active ? 'diff diff--syntax' : 'diff'}
      ref={diffRootRef}
      style={{ '--diff-font-size': `${fontSize}px` } as React.CSSProperties}
    >
      <div className="diff__topbar">
        <DiffHeader
          file={file}
          viewMode={viewMode}
          onViewMode={actions.setViewMode}
          sideMode={sideMode}
          onCycleSide={cycleSide}
          showFullFile={effectiveFullFile}
          onToggleFullFile={toggleFullFile}
          fullFileLoading={fullFileLoading}
          fullFileStatus={fullFileStatus}
          fontSize={fontSize}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onZoomReset={zoomReset}
          ignoreWhitespace={ignoreWhitespace}
          onToggleWhitespace={toggleWhitespace}
          hiddenWhitespace={whitespace.collapsed}
          additions={whitespace.collapsed > 0 ? whitespace.additions : file.additions}
          deletions={whitespace.collapsed > 0 ? whitespace.deletions : file.deletions}
          wordDiff={wordDiffEnabled}
          onToggleWordDiff={toggleWordDiff}
          canPreview={canPreview}
          markdownPreview={markdownPreview}
          onToggleMarkdownPreview={toggleMarkdownPreview}
          blockNav={blockNav}
          deepLink={
            pr
              ? buildDeepLink({
                  owner: pr.coordinates.owner,
                  repo: pr.coordinates.name,
                  number: pr.coordinates.number,
                  file: file.filename,
                })
              : ''
          }
        />
        {searchOpen && <DiffSearchBox search={search} />}
      </div>
      <RenameNotice info={rename} />
      <LineFocusNotice target={unreachableHere} onDismiss={() => setUnreachableLine(null)} />
      <WhitespaceNotice
        hidden={whitespace.collapsed}
        rawAdditions={file.additions}
        rawDeletions={file.deletions}
        wholeFile={whitespaceWholeFile}
        onShow={showWhitespace}
      />
      {diff.isEmpty ? (
        <div className="diff__nopatch">
          {sideFilterEmptyMessage(sideMode, diff.isEmpty, collapsedDiff.isEmpty) ??
            noDiffMessage(rename)}
          {threads.length > 0 && (
            <OrphanedThreads
              threads={threads}
              expandedThreads={expandedThreads}
              onExpand={expandThread}
              onCollapse={collapseThread}
            />
          )}
        </div>
      ) : markdownPreview ? (
        <>
          <MarkdownPreview blocks={previewBlocks} sideMode={sideMode}
            onStartComment={startComment} composer={composer} renderComposer={renderComposer} />
          {/* Keep every saved thread accessible, including anchors on blank
              lines or source content that the rendered preview omits. */}
          {threads.length > 0 && (
            <OrphanedThreads
              threads={threads}
              expandedThreads={expandedThreads}
              onExpand={expandThread}
              onCollapse={collapseThread}
              icon="💬"
              heading={`Comments (${threads.length}) — switch to Source to see them in place`}
            />
          )}
        </>
      ) : viewMode === 'inline' ? (
        <>
          <InlineDiff
            diff={diff}
            onStartComment={startComment}
            commentRange={composer}
            sideMode={sideMode}
            extrasRow={extrasRow}
            threadBadges={threadBadges}
            renderContent={renderContent}
          />
          {orphanedThreads.length > 0 && (
            <OrphanedThreads
              threads={orphanedThreads}
              expandedThreads={expandedThreads}
              onExpand={expandThread}
              onCollapse={collapseThread}
            />
          )}
          <ChangeMap markers={changeMarkers} />
        </>
      ) : (
        <>
          <SplitDiff
            diff={diff}
            onStartComment={startComment}
            commentRange={composer}
            extrasRow={extrasRow}
            threadBadges={threadBadges}
            renderContent={renderContent}
            sideMode={sideMode}
          />
          {orphanedThreads.length > 0 && (
            <OrphanedThreads
              threads={orphanedThreads}
              expandedThreads={expandedThreads}
              onExpand={expandThread}
              onCollapse={collapseThread}
            />
          )}
          <ChangeMap markers={changeMarkers} />
        </>
      )}
    </div>
  );
}
