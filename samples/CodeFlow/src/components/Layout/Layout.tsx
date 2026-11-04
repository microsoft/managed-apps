import { useCallback, useEffect, useRef, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { Avatar } from '../Avatar';
import { IterationBar } from '../IterationBar/IterationBar';
import { FileList } from '../FileList/FileList';
import { DiffViewer } from '../DiffViewer/DiffViewer';
import { CommentSummary } from '../CommentSummary/CommentSummary';
import { SearchResults } from '../SearchResults/SearchResults';
import { CopyLinkButton } from '../CopyLinkButton/CopyLinkButton';
import { ChecksPill } from '../ChecksPill/ChecksPill';
import { MergeButton } from '../MergeButton/MergeButton';
import { AutoMergeButton } from '../AutoMergeButton/AutoMergeButton';
import { CherryPickButton } from '../CherryPickButton/CherryPickButton';
import { FeedbackDialog } from '../FeedbackDialog/FeedbackDialog';
import { BugSwarm } from '../BugSwarm/BugSwarm';
import { SettingsDialog } from '../SettingsDialog/SettingsDialog';
import { GearIcon } from '../GearIcon';
import { RefreshTimer } from './RefreshTimer';
import { buildDeepLink } from '../../utils/deepLink';
import { githubLink } from '../../utils/githubLink';
import { isSyncedBackend } from '../../utils/commentBackend';
import { filterReviewers } from './filterReviewers';
import { ReviewerList } from './ReviewerList';
import { prStateBadge } from './prStateBadge';
import { PublishDraftButton } from '../PublishDraftButton/PublishDraftButton';
import { getSettings } from '../../settings/settingsStore';
import { findSeed } from '../../utils/selectionToken';
import { hasDraft, reviewDraftKey } from '../../utils/commentDrafts';
import { useDraft } from '../../utils/useDraft';
import type { ReviewEvent } from '../../state/codeFlowContext';
import { isPrAuthor } from '../../services/authorApproval';

import {
  saveSummaryOpen,
  loadSummaryOpen,
  DEFAULT_SUMMARY_HEIGHT,
  MIN_SUMMARY_HEIGHT,
  MAX_SUMMARY_HEIGHT,
  clampSummaryHeight,
  loadSummaryHeight,
  saveSummaryHeight,
  saveSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  loadSidebarWidth,
  loadSidebarCollapsed,
  saveSidebarCollapsed,
} from '../../utils/preferences';

/** How far one arrow key nudges the comment summary's edge. */
const SUMMARY_KEY_STEP = 24;

/**
 * The two things the bottom panel can be showing. They share one panel, one
 * height and one collapsed state because they are alternatives: both are a list
 * of places in this pull request, and a reviewer wants one of them at a time.
 */
type BottomTab = 'comments' | 'search';

const BOTTOM_TABS: ReadonlyArray<{ id: BottomTab; label: string }> = [
  { id: 'comments', label: 'Comment summary' },
  { id: 'search', label: 'Search in files' },
];

/** The reviews that open a prompt, and so can leave a draft behind. */
const PROMPTED_REVIEWS: ReviewEvent[] = ['REQUEST_CHANGES', 'COMMENT'];


export function ReviewLayout({ onOpenAdmin }: { onOpenAdmin?: () => void } = {}) {
  const { pr, prKey, actions, commentBackendLabel, reviewers, authorApproval, currentUser } = useCodeFlow();
  const [summaryOpen, setSummaryOpen] = useState(() =>
    loadSummaryOpen(prKey, getSettings().summaryOpenByDefault),
  );
  const [reviewBusy, setReviewBusy] = useState<ReviewEvent | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('comments');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocusTick, setSearchFocusTick] = useState(0);

  // Resizable file panel: persist width so deep folder trees stay readable.
  const workareaRef = useRef<HTMLDivElement>(null);
  const [sideWidth, setSideWidth] = useState(loadSidebarWidth);
  const sideWidthRef = useRef(sideWidth);
  const draggingSide = useRef(false);

  // Collapsing the panel outright is a live toggle, not a setting: the tree is
  // there unless this reviewer has put it away on this screen.
  const [sideCollapsed, setSideCollapsed] = useState(loadSidebarCollapsed);

  const toggleSideCollapsed = useCallback(() => {
    setSideCollapsed((prev) => {
      saveSidebarCollapsed(!prev);
      return !prev;
    });
  }, []);

  const applySideWidth = useCallback((w: number) => {
    sideWidthRef.current = w;
    setSideWidth(w);
  }, []);

  const persistSideWidth = useCallback((w: number) => {
    saveSidebarWidth(w);
  }, []);

  const onSideResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingSide.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onSideResizeMove = useCallback((e: React.PointerEvent) => {
    if (!draggingSide.current || !workareaRef.current) return;
    const rect = workareaRef.current.getBoundingClientRect();
    const w = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(MIN_SIDEBAR_WIDTH, e.clientX - rect.left),
    );
    applySideWidth(w);
  }, [applySideWidth]);

  const onSideResizeEnd = useCallback(() => {
    if (!draggingSide.current) return;
    draggingSide.current = false;
    persistSideWidth(sideWidthRef.current);
  }, [persistSideWidth]);

  const resetSideWidth = useCallback(() => {
    applySideWidth(DEFAULT_SIDEBAR_WIDTH);
    persistSideWidth(DEFAULT_SIDEBAR_WIDTH);
  }, [applySideWidth, persistSideWidth]);

  // Resizable comment summary: reviewers with a long thread list drag it taller
  // to read more of it without scrolling, so the height is theirs to keep.
  const bottomRef = useRef<HTMLElement>(null);
  const [summaryHeight, setSummaryHeight] = useState(loadSummaryHeight);
  const summaryHeightRef = useRef(summaryHeight);
  const draggingSummary = useRef(false);

  const applySummaryHeight = useCallback((h: number) => {
    const clamped = clampSummaryHeight(h, window.innerHeight);
    summaryHeightRef.current = clamped;
    setSummaryHeight(clamped);
    return clamped;
  }, []);

  const onSummaryResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingSummary.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onSummaryResizeMove = useCallback((e: React.PointerEvent) => {
    if (!draggingSummary.current || !bottomRef.current) return;
    // The panel grows upwards, so the height is whatever is left between the
    // pointer and the bottom edge it is anchored to.
    applySummaryHeight(bottomRef.current.getBoundingClientRect().bottom - e.clientY);
  }, [applySummaryHeight]);

  const onSummaryResizeEnd = useCallback(() => {
    if (!draggingSummary.current) return;
    draggingSummary.current = false;
    saveSummaryHeight(summaryHeightRef.current);
  }, []);

  const resetSummaryHeight = useCallback(() => {
    saveSummaryHeight(applySummaryHeight(DEFAULT_SUMMARY_HEIGHT));
  }, [applySummaryHeight]);

  // Arrow keys move the same edge, so the panel is resizable without a pointer.
  const onSummaryResizeKey = useCallback((e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowUp' ? SUMMARY_KEY_STEP : e.key === 'ArrowDown' ? -SUMMARY_KEY_STEP : 0;
    if (step === 0) {
      if (e.key === 'Home') { e.preventDefault(); resetSummaryHeight(); }
      return;
    }
    e.preventDefault();
    saveSummaryHeight(applySummaryHeight(summaryHeightRef.current + step));
  }, [applySummaryHeight, resetSummaryHeight]);

  const toggleSummary = useCallback(() => {    setSummaryOpen((prev) => {
      const next = !prev;
      if (prKey) {
        saveSummaryOpen(prKey, next);
      }
      return next;
    });
  }, [prKey]);

  // Clicking the tab you are already on collapses the panel, the way the single
  // "Comment summary" toggle always did; clicking the other one switches to it,
  // opening the panel first if it was away.
  const selectTab = useCallback((tab: BottomTab) => {
    if (tab === bottomTab) {
      toggleSummary();
      return;
    }
    setBottomTab(tab);
    if (!summaryOpen) toggleSummary();
  }, [bottomTab, summaryOpen, toggleSummary]);

  // Ctrl/Cmd+Shift+F searches every file in the diff. It opens the results
  // panel, seeded with the selection, and focuses its input — so pressing it
  // again with a new word selected starts a new search rather than doing
  // nothing. The browser's own find-in-page is suppressed, as Ctrl+F already is.
  const openCrossFileSearch = useCallback(() => {
    const seed = findSeed(window.getSelection()?.toString());
    if (seed !== undefined) setSearchQuery(seed);
    setBottomTab('search');
    setSearchFocusTick((t) => t + 1);
    if (!summaryOpen) toggleSummary();
  }, [summaryOpen, toggleSummary]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      if (e.key !== 'f' && e.key !== 'F') return;
      e.preventDefault();
      openCrossFileSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openCrossFileSearch]);

  const filteredReviewers = filterReviewers(reviewers, pr?.author?.login);
  if (authorApproval) filteredReviewers.push(authorApproval);
  const selfReview = isPrAuthor(pr, currentUser);
  const [reviewResult, setReviewResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  // Reopen the prompt on whichever review has text waiting in it, so a reload
  // mid-sentence doesn't look like the app discarded what was being written.
  const [reviewPrompt, setReviewPrompt] = useState<ReviewEvent | null>(
    () => PROMPTED_REVIEWS.find((e) => hasDraft(reviewDraftKey(prKey, e))) ?? null,
  );
  const [reviewBody, setReviewBody, clearReviewBody] = useDraft(reviewDraftKey(prKey, reviewPrompt));

  if (!pr) return null;

  const stateBadge = prStateBadge(pr);

  const doReview = async (event: ReviewEvent) => {
    // REQUEST_CHANGES and COMMENT require a body — prompt the user. Any text
    // already saved against this review comes back with it.
    if (event !== 'APPROVE' && !reviewPrompt) {
      setReviewPrompt(event);
      return;
    }
    const body = event === 'APPROVE' ? undefined : reviewBody.trim() || undefined;
    setReviewPrompt(null);
    clearReviewBody();
    setReviewBusy(event);
    setReviewResult(null);
    try {
      await actions.submitReview(event, body);
      const labels: Record<ReviewEvent, string> = {
        APPROVE: selfReview ? 'Author approval saved in CodeFlow only; GitHub is unchanged.' : 'Approved',
        REQUEST_CHANGES: 'Changes requested',
        COMMENT: 'Review comment posted',
      };
      setReviewResult({ type: 'success', msg: labels[event] });
      setTimeout(() => setReviewResult(null), 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Review failed';
      setReviewResult({ type: 'error', msg });
      setTimeout(() => setReviewResult(null), 6000);
    } finally {
      setReviewBusy(null);
    }
  };

  return (
    <div className="app">
      <BugSwarm />
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <header className="topbar">
        <div className="topbar__main">
          <button className="topbar__back" title="Open another pull request" onClick={actions.reset}>
            <img src="/codeflow-logo.svg" alt="CodeFlow" width="24" height="24" />
            <span className="topbar__back-label">← PRs</span>
          </button>
          <div className="topbar__titlewrap">
            <div className="topbar__titlerow">
              <span className={`pr-state pr-state--${stateBadge.modifier}`}>
                {stateBadge.label}
              </span>
              <h1 className="topbar__title" title={pr.title}>
                {pr.title}
              </h1>
              <span className="topbar__num">
                {pr.coordinates.owner}/{pr.coordinates.name} #{pr.coordinates.number}
              </span>
              <CopyLinkButton
                link={buildDeepLink({
                  owner: pr.coordinates.owner,
                  repo: pr.coordinates.name,
                  number: pr.coordinates.number,
                })}
                title="Copy link to this PR"
                prNumber={pr.coordinates.number}
                prTitle={pr.title}
              />
            </div>
            <div className="topbar__sub">
              {pr.author && (
                <span className="topbar__author">
                  <Avatar user={pr.author} size={18} /> {pr.author.login}
                </span>
              )}
              <span className="topbar__branches" title="base ← head">
                <code>{pr.baseRef}</code> ← <code>{pr.headRef}</code>
              </span>
              {typeof pr.changedFiles === 'number' && (
                <span className="topbar__stat">{pr.changedFiles} files</span>
              )}
              {typeof pr.additions === 'number' && (
                <span className="topbar__stat frow__add">+{pr.additions}</span>
              )}
              {typeof pr.deletions === 'number' && (
                <span className="topbar__stat frow__del">−{pr.deletions}</span>
              )}
              <ChecksPill />
              {pr.htmlUrl && (
                <a
                  className="topbar__link"
                  href={githubLink(pr.htmlUrl)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open on GitHub ↗
                </a>
              )}
              {!isSyncedBackend(commentBackendLabel) && (
                <span
                  className="topbar__backend"
                  title="Comments aren’t syncing to GitHub — they’re stored on this device only and won’t be visible to anyone else."
                >
                  ⚠ {commentBackendLabel}
                </span>
              )}
            </div>
          </div>
          <ReviewerList reviewers={filteredReviewers} headSha={pr.headSha} />
          <div className="topbar__review">
            <PublishDraftButton />
            <button
              className="btn btn--sm btn--approve"
              disabled={reviewBusy !== null || (selfReview && (pr.state !== 'open' || pr.merged))}
              onClick={() => doReview('APPROVE')}
              title={selfReview
                ? 'Record your approval of this head commit in CodeFlow only. Does not count toward GitHub merge requirements.'
                : 'Approve this pull request'}
            >
              {reviewBusy === 'APPROVE' ? '⏳' : '✓'} {selfReview ? 'Approve (app only)' : 'Approve'}
            </button>
            <button
              className="btn btn--sm btn--wait"
              disabled={reviewBusy !== null}
              onClick={() => doReview('COMMENT')}
              title="Mark as Waiting (submit as comment without approval)"
            >
              {reviewBusy === 'COMMENT' ? '⏳' : '⏸'} Wait
            </button>
            <button
              className="btn btn--sm btn--reject"
              disabled={reviewBusy !== null}
              onClick={() => doReview('REQUEST_CHANGES')}
              title="Request changes on this pull request"
            >
              {reviewBusy === 'REQUEST_CHANGES' ? '⏳' : '✗'} Reject
            </button>
            <CherryPickButton />
            <AutoMergeButton />
            <MergeButton />
            {reviewResult && (
              <span className={`topbar__review-toast topbar__review-toast--${reviewResult.type}`}>
                {reviewResult.msg}
              </span>
            )}
            {reviewPrompt && (
              <div className="review-prompt">
                <textarea
                  className="review-prompt__input"
                  placeholder={reviewPrompt === 'REQUEST_CHANGES' ? 'Describe the changes you require…' : 'Leave a comment…'}
                  value={reviewBody}
                  onChange={(e) => setReviewBody(e.target.value)}
                  autoFocus
                  rows={2}
                />
                <div className="review-prompt__actions">
                  <button
                    className="btn btn--sm btn--primary"
                    disabled={!reviewBody.trim()}
                    onClick={() => doReview(reviewPrompt)}
                  >
                    Submit
                  </button>
                  <button
                    className="btn btn--sm"
                    onClick={() => { clearReviewBody(); setReviewPrompt(null); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="topbar__account">
            {onOpenAdmin && <button className="btn btn--sm" onClick={onOpenAdmin}>Admin Console</button>}
            <RefreshTimer />
            {currentUser?.login && (
              <span className="topbar__me" title="Signed-in GitHub user">
                <Avatar user={currentUser} size={20} /> {currentUser.login}
              </span>
            )}
            <button
              className="topbar__feedback"
              onClick={() => setFeedbackOpen(true)}
              title="Notes and feedback"
              aria-label="Notes and feedback"
            >
              💬
            </button>
            <button
              className="topbar__gear"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Settings"
            >
              <GearIcon />
            </button>
          </div>
        </div>
        <IterationBar />
      </header>

      <div className="workarea" ref={workareaRef}>
        {sideCollapsed ? (
          <aside className="workarea__rail">
            <button
              className="workarea__rail-btn"
              onClick={toggleSideCollapsed}
              title="Show the file explorer"
              aria-label="Show the file explorer"
              aria-expanded={false}
            >
              <span className="workarea__rail-chevron">»</span>
              <span className="workarea__rail-label">Files</span>
            </button>
          </aside>
        ) : (
          <>
            <aside className="workarea__side" style={{ width: sideWidth }}>
              <FileList onCollapse={toggleSideCollapsed} />
            </aside>
            <div
              className="workarea__resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize file panel (double-click to reset)"
              title="Drag to resize · double-click to reset"
              onPointerDown={onSideResizeStart}
              onPointerMove={onSideResizeMove}
              onPointerUp={onSideResizeEnd}
              onDoubleClick={resetSideWidth}
            />
          </>
        )}
        <main className="workarea__center">
          <DiffViewer />
        </main>
      </div>

      <section
        className={`bottompanel ${summaryOpen ? '' : 'bottompanel--collapsed'}`}
        ref={bottomRef}
        style={summaryOpen ? { height: summaryHeight } : undefined}
      >
        {summaryOpen && (
          <div
            className="bottompanel__resizer"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the bottom panel (double-click to reset)"
            aria-valuenow={Math.round(summaryHeight)}
            aria-valuemin={MIN_SUMMARY_HEIGHT}
            aria-valuemax={MAX_SUMMARY_HEIGHT}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={onSummaryResizeStart}
            onPointerMove={onSummaryResizeMove}
            onPointerUp={onSummaryResizeEnd}
            onDoubleClick={resetSummaryHeight}
            onKeyDown={onSummaryResizeKey}
          />
        )}
        <div className="bottompanel__tabs">
          {BOTTOM_TABS.map((tab) => {
            const active = tab.id === bottomTab;
            return (
              <button
                key={tab.id}
                className={`bottompanel__toggle${active ? ' bottompanel__toggle--active' : ''}`}
                onClick={() => selectTab(tab.id)}
                aria-expanded={active ? summaryOpen : undefined}
                title={
                  tab.id === 'search'
                    ? 'Search every file in the diff (Ctrl+Shift+F)'
                    : 'Every comment on this pull request'
                }
              >
                {active ? (summaryOpen ? '▾' : '▸') : '\u00a0'} {tab.label}
              </button>
            );
          })}
        </div>
        {summaryOpen && bottomTab === 'comments' && <CommentSummary />}
        {summaryOpen && bottomTab === 'search' && (
          <SearchResults
            query={searchQuery}
            onQuery={setSearchQuery}
            focusTick={searchFocusTick}
            onClose={toggleSummary}
          />
        )}
      </section>
    </div>
  );
}
