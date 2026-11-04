import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { GitHubService } from '../../services/githubService';
import { Avatar } from '../Avatar';
import { GearIcon } from '../GearIcon';
import { SettingsDialog } from '../SettingsDialog/SettingsDialog';
import { FeedbackDialog } from '../FeedbackDialog/FeedbackDialog';
import { APP_VERSION, config } from '../../config';
import { LocalModeNotice } from '../LocalModeNotice/LocalModeNotice';
import { ConnectionBanner } from '../ConnectionBanner/ConnectionBanner';
import { classifyConnectionFault } from '../../services/connectionHealth';
import { parsePrInput, parseRepoInput } from '../../utils/parsePrInput';
import { relativeTime, timeTitle } from '../../utils/format';
import { buildDeepLink } from '../../utils/deepLink';
import {
  getPinnedRepos,
  getFlaggedPrs,
  getInProgressReviews,
  isPrFlagged,
  toggleFlaggedPr,
  addPinnedRepo,
  removePinnedRepo,
  removeInProgressReview,
  type PinnedRepo,
} from '../../utils/storage';
import { useFlaggedCleanup } from './useFlaggedCleanup';
import { useReviewStateRevision } from '../../state/hooks/useReviewStateRevision';
import { loadCollapsedSections, saveCollapsedSections } from '../../utils/preferences';
import {
  classifyAll,
  enrichedToItem,
  indexByPrKey,
  prKeyOf,
} from '../../utils/dashboardReview';
import type { GitUserRef, PrCoordinates, PrListItem } from '../../types';

/**
 * GitHub issue-search queries powering the live queues. `@me` = signed-in user.
 *
 * These three searches are the dashboard's entire network budget. Everything
 * else on the page — including which tracked reviews are still outstanding —
 * is derived from their results rather than fetched per PR.
 */
const QUERY_REVIEW = 'is:pr is:open review-requested:@me archived:false';
const QUERY_MINE = 'is:pr is:open author:@me archived:false';
const QUERY_REVIEWED = 'is:pr is:open reviewed-by:@me archived:false';

type AsyncState<T> = { status: 'loading' | 'ready' | 'error'; items: T; error?: string };

function toItem(e: {
  owner: string;
  name: string;
  number: number;
  title?: string;
}): PrListItem {
  return {
    coordinates: { owner: e.owner, name: e.name, number: e.number },
    title: e.title ?? `PR #${e.number}`,
  };
}


export function Dashboard() {
  const { actions, status, error } = useCodeFlow();
  const [jump, setJump] = useState('');
  const [me, setMe] = useState<GitUserRef | undefined>(undefined);

  // Live queues from GitHub search.
  const [reviewQueue, setReviewQueue] = useState<AsyncState<PrListItem[]>>({
    status: 'loading',
    items: [],
  });
  const [myPrs, setMyPrs] = useState<AsyncState<PrListItem[]>>({
    status: 'loading',
    items: [],
  });
  const [reviewedByMe, setReviewedByMe] = useState<AsyncState<PrListItem[]>>({
    status: 'loading',
    items: [],
  });

  // Local personalization is read fresh from storage on each render; `bump`
  // forces a re-render after a mutation (flag / pin / dismiss). Changes from
  // other tabs (or a shared storage provider) land outside React, so track the
  // review-state revision here too.
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  useReviewStateRevision();
  const flags = getFlaggedPrs();
  const inProgress = getInProgressReviews();
  const pins = getPinnedRepos();

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsedSections);
  const toggleSection = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveCollapsedSections(next);
      return next;
    });
  }, []);

  // Bucket the locally-tracked reviews using only the search results above —
  // no per-PR requests. `sigInProgress` keys the memo off list membership
  // because storage hands back a fresh array on every render.
  const sigInProgress = useMemo(
    () => inProgress.map(prKeyOf).sort().join('|'),
    [inProgress],
  );
  const enrichLoading = reviewedByMe.status === 'loading';
  const enriched = useMemo(
    () =>
      classifyAll(inProgress, {
        reviewed: indexByPrKey(reviewedByMe.items),
        requested: indexByPrKey(reviewQueue.items),
        authored: indexByPrKey(myPrs.items),
      }),
    // `inProgress` is intentionally keyed by signature, not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sigInProgress, reviewedByMe.items, reviewQueue.items, myPrs.items],
  );

  const actionItems = useMemo(() => enriched.filter((i) => i.bucket === 'action'), [enriched]);
  const waitingItems = useMemo(() => enriched.filter((i) => i.bucket === 'waiting'), [enriched]);

  // "Needs your attention" merges GitHub review requests with in-progress PRs
  // that need another pass. Drop action items already surfaced as a review
  // request so a PR that's both doesn't appear twice.
  const reviewKeys = useMemo(
    () => new Set(reviewQueue.items.map((i) => prKeyOf(i.coordinates))),
    [reviewQueue.items],
  );
  const attentionActionItems = useMemo(
    () => actionItems.filter((it) => !reviewKeys.has(prKeyOf(it.entry))),
    [actionItems, reviewKeys],
  );
  const attentionCount = reviewQueue.items.length + attentionActionItems.length;
  const attentionLoading = reviewQueue.status === 'loading' || enrichLoading;

  // Flagged rows render straight from what was stored when they were starred.
  // Clearing out merged/closed ones is an explicit, user-initiated action.
  const flaggedCleanup = useFlaggedCleanup(flags, bump);

  const runSearch = useCallback(
    (query: string, set: (s: AsyncState<PrListItem[]>) => void, force = false) => {
      void GitHubService.searchPullRequests(query, undefined, { force })
        .then((items) => set({ status: 'ready', items }))
        .catch((e) =>
          set({
            status: 'error',
            items: [],
            error: e instanceof Error ? e.message : 'Search failed',
          }),
        );
    },
    [],
  );

  // Boot loads share the service-level search cache, so a double mount costs
  // nothing. An explicit refresh always goes to the network.
  const fetchAll = useCallback(
    (force = false) => {
      runSearch(QUERY_REVIEW, setReviewQueue, force);
      runSearch(QUERY_MINE, setMyPrs, force);
      runSearch(QUERY_REVIEWED, setReviewedByMe, force);
    },
    [runSearch],
  );

  const refresh = useCallback(() => {
    setReviewQueue({ status: 'loading', items: [] });
    setMyPrs({ status: 'loading', items: [] });
    setReviewedByMe({ status: 'loading', items: [] });
    fetchAll(true);
  }, [fetchAll]);

  useEffect(() => {
    // Initial load. The queues start in the 'loading' state, so the effect body
    // performs no synchronous setState — the setters only run inside the async
    // then/catch callbacks below. `getAuthenticatedUser` is cached in the
    // service, so this shares one request with every other identity lookup.
    fetchAll();
    void GitHubService.getAuthenticatedUser().then((u) => setMe(u));
  }, [fetchAll]);


  const open = useCallback((coords: PrCoordinates) => void actions.loadPr(coords), [actions]);

  const jumpCoords = useMemo(() => parsePrInput(jump), [jump]);
  const submitJump = useCallback(() => {
    if (jumpCoords) open(jumpCoords);
  }, [jumpCoords, open]);

  const onFlag = useCallback(
    (item: PrListItem) => {
      toggleFlaggedPr({
        owner: item.coordinates.owner,
        name: item.coordinates.name,
        number: item.coordinates.number,
        title: item.title,
      });
      bump();
    },
    [bump],
  );

  const loading = status === 'loading';
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  /**
   * A connection problem, if that's what the queues are actually reporting.
   *
   * All three searches share one connection, so they fail together and the
   * first classifiable error speaks for all of them. Worth separating from the
   * generic per-section error text because the message GitHub sends — "API
   * rate limit exceeded" — points the reviewer at entirely the wrong culprit.
   */
  const connectionFault = useMemo(() => {
    for (const s of [reviewQueue, myPrs, reviewedByMe]) {
      if (s.status !== 'error') continue;
      const kind = classifyConnectionFault(s.error);
      if (kind) return kind;
    }
    return undefined;
  }, [reviewQueue, myPrs, reviewedByMe]);

  return (
    <div className="dash">
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      <div className="dash__inner">
        <header className="dash__header">
          <div className="dash__brand">
            <img src="/codeflow-logo.svg" alt="" width="40" height="40" />
            <div>
              <h1>{config.appName}</h1>
              <p className="dash__tag">
                Iteration-aware pull request review for GitHub
                <span className="dash__version">v{APP_VERSION}</span>
              </p>
            </div>
          </div>
          <div className="dash__headright">
            {me?.login && (
              <span className="dash__me" title="Signed-in GitHub user">
                <Avatar user={me} size={22} /> {me.login}
              </span>
            )}
            <button
              className="dash__feedback"
              onClick={() => setFeedbackOpen(true)}
              title="Notes and feedback"
            >
              💬 Notes
            </button>
            <button
              className="dash__gear"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Settings"
            >
              <GearIcon />
            </button>
            <button
              className="btn btn--sm"
              onClick={refresh}
              title="Refresh queues"
              disabled={reviewQueue.status === 'loading' && myPrs.status === 'loading'}
            >
              ↻ Refresh
            </button>
          </div>
        </header>

        <div className="dash__jump">
          <input
            className="dash__jump-input"
            placeholder="Jump to a PR — paste a URL or type owner/repo#123"
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && jumpCoords) submitJump();
            }}
            aria-label="Jump to a pull request"
            autoFocus
          />
          <button
            className="btn btn--primary btn--sm"
            onClick={submitJump}
            disabled={!jumpCoords || loading}
          >
            {loading ? 'Opening…' : 'Open'}
          </button>
        </div>
        {error && <div className="dash__error">{error}</div>}

        {connectionFault && (
          <ConnectionBanner
            kind={connectionFault}
            onRetry={refresh}
          />
        )}

        <LocalModeNotice />

        <div className="dash__grid">
          <Section
            id="progress"
            icon="👀"
            title="Needs your attention"
            count={attentionCount}
            collapsed={collapsed.progress}
            onToggle={toggleSection}
          >
            {reviewQueue.status === 'error' && (
              <p className="dash__empty dash__empty--err">
                Couldn't load review requests: {reviewQueue.error}
              </p>
            )}
            {attentionCount === 0 ? (
              attentionLoading ? (
                <p className="dash__empty">Loading…</p>
              ) : (
                reviewQueue.status !== 'error' && (
                  <p className="dash__empty">
                    You're all caught up — nothing needs your attention.
                  </p>
                )
              )
            ) : (
              <ul className="prlist">
                {reviewQueue.items.map((item) => {
                  const c = item.coordinates;
                  const flagged = flags.some(
                    (f) => f.owner === c.owner && f.name === c.name && f.number === c.number,
                  );
                  const reviewing = inProgress.some(
                    (f) => f.owner === c.owner && f.name === c.name && f.number === c.number,
                  );
                  return (
                    <PrRow
                      key={`${c.owner}/${c.name}#${c.number}`}
                      item={item}
                      meta={item.updatedAt ? `updated ${relativeTime(item.updatedAt)}` : undefined}
                      metaTitle={timeTitle(item.updatedAt)}
                      onOpen={open}
                      onFlag={onFlag}
                      flagged={flagged}
                      reviewing={reviewing}
                    />
                  );
                })}
                {attentionActionItems.map((it) => (
                  <PrRow
                    key={prKeyOf(it.entry)}
                    item={enrichedToItem(it)}
                    meta={it.reason}
                    onOpen={open}
                    onFlag={onFlag}
                    flagged={isPrFlagged(it.entry.owner, it.entry.name, it.entry.number)}
                    onDismiss={() => {
                      removeInProgressReview(it.entry.owner, it.entry.name, it.entry.number);
                      bump();
                    }}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="waiting"
            icon="✅"
            title="Reviewed · waiting on author"
            count={enrichLoading ? 0 : waitingItems.length}
            collapsed={collapsed.waiting ?? true}
            onToggle={toggleSection}
          >
            {enrichLoading ? (
              <p className="dash__empty">Checking review status…</p>
            ) : waitingItems.length === 0 ? (
              <p className="dash__empty">
                PRs you've reviewed that are still open will appear here.
              </p>
            ) : (
              <ul className="prlist">
                {waitingItems.map((it) => (
                  <PrRow
                    key={prKeyOf(it.entry)}
                    item={enrichedToItem(it)}
                    meta={
                      it.live?.updatedAt
                        ? `updated ${relativeTime(it.live.updatedAt)}`
                        : undefined
                    }
                    metaTitle={timeTitle(it.live?.updatedAt)}
                    onOpen={open}
                    onFlag={onFlag}
                    flagged={isPrFlagged(it.entry.owner, it.entry.name, it.entry.number)}
                    onDismiss={() => {
                      removeInProgressReview(it.entry.owner, it.entry.name, it.entry.number);
                      bump();
                    }}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="flagged"
            icon="⭐"
            title="Flagged"
            count={flags.length}
            collapsed={collapsed.flagged}
            onToggle={toggleSection}
          >
            {flags.length === 0 ? (
              <p className="dash__empty">Star a PR to keep an eye on it here.</p>
            ) : (
              <>
                <ul className="prlist">
                  {flags.map((f) => (
                    <PrRow
                      key={`${f.owner}/${f.name}#${f.number}`}
                      item={toItem(f)}
                      onOpen={open}
                      onFlag={onFlag}
                      flagged
                    />
                  ))}
                </ul>
                <div className="dash-section__foot">
                  <button
                    className="btn btn--sm"
                    onClick={flaggedCleanup.run}
                    disabled={flaggedCleanup.running}
                    title="Check each flagged PR and remove the ones that are merged or closed"
                  >
                    {flaggedCleanup.running ? 'Checking…' : '↻ Clear merged & closed'}
                  </button>
                  {flaggedCleanup.removed !== undefined && !flaggedCleanup.running && (
                    <span className="dash-section__footnote">
                      {flaggedCleanup.removed === 0
                        ? 'All still open.'
                        : `Removed ${flaggedCleanup.removed}.`}
                    </span>
                  )}
                </div>
              </>
            )}
          </Section>

          <Section
            id="mine"
            icon="📤"
            title="Your PRs · waiting on others"
            count={myPrs.items.length}
            collapsed={collapsed.mine}
            onToggle={toggleSection}
          >
            <PrQueue
              state={myPrs}
              empty="You have no open pull requests."
              onOpen={open}
              onFlag={onFlag}
              flags={flags}
              inProgress={inProgress}
            />
          </Section>

          <PinnedSection
            pins={pins}
            onOpen={open}
            onFlag={onFlag}
            flags={flags}
            onChange={bump}
            collapsed={collapsed.pinned}
            onToggle={toggleSection}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Sections ------------------------------- */

interface SectionProps {
  id: string;
  icon: string;
  title: string;
  count: number;
  collapsed?: boolean;
  onToggle: (id: string) => void;
  className?: string;
  children: React.ReactNode;
}

function Section({ id, icon, title, count, collapsed, onToggle, className, children }: SectionProps) {
  return (
    <section className={className ? `dash-section ${className}` : 'dash-section'}>
      <button
        className="dash-section__head"
        onClick={() => onToggle(id)}
        aria-expanded={!collapsed}
      >
        <span className="dash-section__caret">{collapsed ? '▸' : '▾'}</span>
        <span className="dash-section__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="dash-section__title">{title}</span>
        <span className="dash-section__count">{count}</span>
      </button>
      {!collapsed && <div className="dash-section__body">{children}</div>}
    </section>
  );
}

interface PrQueueProps {
  state: AsyncState<PrListItem[]>;
  empty: string;
  onOpen: (c: PrCoordinates) => void;
  onFlag: (item: PrListItem) => void;
  flags: { owner: string; name: string; number: number }[];
  inProgress: { owner: string; name: string; number: number }[];
}

function PrQueue({ state, empty, onOpen, onFlag, flags, inProgress }: PrQueueProps) {
  if (state.status === 'loading') return <p className="dash__empty">Loading…</p>;
  if (state.status === 'error') {
    return <p className="dash__empty dash__empty--err">Couldn't load: {state.error}</p>;
  }
  if (state.items.length === 0) return <p className="dash__empty">{empty}</p>;
  return (
    <ul className="prlist">
      {state.items.map((item) => {
        const c = item.coordinates;
        const flagged = flags.some(
          (f) => f.owner === c.owner && f.name === c.name && f.number === c.number,
        );
        const reviewing = inProgress.some(
          (f) => f.owner === c.owner && f.name === c.name && f.number === c.number,
        );
        return (
          <PrRow
            key={`${c.owner}/${c.name}#${c.number}`}
            item={item}
            meta={item.updatedAt ? `updated ${relativeTime(item.updatedAt)}` : undefined}
            metaTitle={timeTitle(item.updatedAt)}
            onOpen={onOpen}
            onFlag={onFlag}
            flagged={flagged}
            reviewing={reviewing}
          />
        );
      })}
    </ul>
  );
}

/* -------------------------------- Rows --------------------------------- */

interface PrRowProps {
  item: PrListItem;
  meta?: string;
  /** Tooltip for `meta`, used when it is a relative timestamp. */
  metaTitle?: string;
  reviewing?: boolean;
  flagged?: boolean;
  onOpen: (c: PrCoordinates) => void;
  onFlag: (item: PrListItem) => void;
  onDismiss?: () => void;
}

export function PrRow({
  item,
  meta,
  metaTitle,
  reviewing,
  flagged,
  onOpen,
  onFlag,
  onDismiss,
}: PrRowProps) {
  const c = item.coordinates;
  return (
    <li className="prrow">
      <button
        className={`prrow__flag ${flagged ? 'prrow__flag--on' : ''}`}
        title={flagged ? 'Unflag' : 'Flag to follow'}
        aria-pressed={flagged}
        onClick={(e) => {
          e.stopPropagation();
          onFlag(item);
        }}
      >
        {flagged ? '★' : '☆'}
      </button>
      <button
        className="prrow__main"
        onClick={() => onOpen(c)}
        // Autoscroll is armed on mousedown, so it has to be suppressed there —
        // by auxclick (mouseup) the browser has already entered scroll mode and
        // swallows the event.
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            window.open(buildDeepLink({ owner: c.owner, repo: c.name, number: c.number }), '_blank', 'noopener,noreferrer');
          }
        }}
        title={item.title}
      >
        <span className="prrow__toprow">
          <span className="prrow__repo">
            {c.owner}/{c.name}
          </span>
          <span className="prrow__num">#{c.number}</span>
          {item.draft && <span className="prrow__chip prrow__chip--draft">Draft</span>}
          {reviewing && <span className="prrow__chip prrow__chip--review">Reviewing</span>}
        </span>
        <span className="prrow__title">{item.title}</span>
        <span className="prrow__meta">
          {item.author && (
            <span className="prrow__author">
              <Avatar user={item.author} size={16} /> {item.author.login}
            </span>
          )}
          {meta && (
            <span className="prrow__time" title={metaTitle}>
              {meta}
            </span>
          )}
          {typeof item.commentsCount === 'number' && item.commentsCount > 0 && (
            <span className="prrow__time">💬 {item.commentsCount}</span>
          )}
        </span>
      </button>
      {onDismiss && (
        <button
          className="prrow__dismiss"
          title="Remove from in-progress"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          ✕
        </button>
      )}
    </li>
  );
}

/* ---------------------------- Pinned repos ----------------------------- */

interface PinnedSectionProps {
  pins: PinnedRepo[];
  onOpen: (c: PrCoordinates) => void;
  onFlag: (item: PrListItem) => void;
  flags: { owner: string; name: string; number: number }[];
  onChange: () => void;
  collapsed?: boolean;
  onToggle: (id: string) => void;
}

export function PinnedSection({
  pins,
  onOpen,
  onFlag,
  flags,
  onChange,
  collapsed,
  onToggle,
}: PinnedSectionProps) {
  const [repoInput, setRepoInput] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [browseMode, setBrowseMode] = useState<'open' | 'merged'>('open');
  const [browse, setBrowse] = useState<AsyncState<PrListItem[]>>({ status: 'ready', items: [] });
  const browseSeq = useRef(0);

  useEffect(() => () => { browseSeq.current += 1; }, []);

  const parsedRepo = useMemo(() => parseRepoInput(repoInput), [repoInput]);

  const addRepo = useCallback(() => {
    if (!parsedRepo) return;
    addPinnedRepo(parsedRepo.owner, parsedRepo.name);
    setRepoInput('');
    onChange();
  }, [parsedRepo, onChange]);

  const loadRepo = useCallback((repo: PinnedRepo, mode: 'open' | 'merged') => {
    const seq = ++browseSeq.current;
    setBrowse({ status: 'loading', items: [] });
    // Search merged PRs server-side: filtering one page of closed PRs can miss
    // every merged result when that page contains only abandoned PRs.
    const request = mode === 'merged'
      ? GitHubService.searchPullRequests(
        `is:pr is:merged repo:${repo.owner}/${repo.name}`, 100, { force: true },
      )
      : GitHubService.listPullRequests({ owner: repo.owner, name: repo.name }, 'open');
    void request
      .then((items) => {
        if (seq === browseSeq.current) setBrowse({ status: 'ready', items });
      })
      .catch((e) => {
        if (seq !== browseSeq.current) return;
        setBrowse({
          status: 'error',
          items: [],
          error: e instanceof Error ? e.message : 'Failed to load PRs',
        });
      });
  }, []);

  const openRepo = useCallback((repo: PinnedRepo) => {
    const key = `${repo.owner}/${repo.name}`;
    if (expanded === key) {
      browseSeq.current += 1;
      setExpanded(null);
      return;
    }
    setExpanded(key);
    loadRepo(repo, browseMode);
  }, [expanded, loadRepo, browseMode]);

  return (
    <Section
      id="pinned"
      icon="📌"
      title="Pinned repos"
      count={pins.length}
      collapsed={collapsed}
      onToggle={onToggle}
      className="dash-section--wide"
    >
      <div className="pinadd">
        <input
          className="pinadd__input"
          placeholder="Pin a repo — owner/repo"
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && parsedRepo) addRepo();
          }}
          aria-label="Pin a repository"
        />
        <button className="btn btn--sm" onClick={addRepo} disabled={!parsedRepo}>
          ＋ Pin
        </button>
      </div>
      {pins.length === 0 ? (
        <p className="dash__empty">Pin the repos you review most for one-click browsing.</p>
      ) : (
        <ul className="repolist">
          {pins.map((repo) => {
            const key = `${repo.owner}/${repo.name}`;
            const isOpen = expanded === key;
            return (
              <li key={key} className="repoitem">
                <div className="repoitem__row">
                  <button className="repoitem__name" onClick={() => openRepo(repo)}>
                    <span className="repoitem__caret">{isOpen ? '▾' : '▸'}</span>
                    📁 {repo.owner}/{repo.name}
                  </button>
                  <button
                    className="repoitem__unpin"
                    title="Unpin"
                    onClick={() => {
                      removePinnedRepo(repo.owner, repo.name);
                      if (isOpen) {
                        browseSeq.current += 1;
                        setExpanded(null);
                      }
                      onChange();
                    }}
                  >
                    ✕
                  </button>
                </div>
                {isOpen && (
                  <div className="repoitem__prs">
                    <div className="repoitem__filters" role="group" aria-label="Pull request status">
                      {(['open', 'merged'] as const).map((mode) => (
                        <button
                          key={mode}
                          className="btn btn--sm"
                          aria-pressed={browseMode === mode}
                          onClick={() => {
                            if (browseMode === mode) return;
                            setBrowseMode(mode);
                            loadRepo(repo, mode);
                          }}
                        >
                          {mode === 'open' ? 'Open PRs' : 'Merged PRs'}
                        </button>
                      ))}
                    </div>
                    {browseMode === 'merged' && (
                      <p className="dash__empty">
                        Open a merged PR, then choose Cherry-pick to apply its changes to another
                        branch. Showing up to 100 recently updated results; use Jump to a PR above
                        for an older PR.
                      </p>
                    )}
                    {browse.status === 'loading' && (
                      <p className="dash__empty">Loading {browseMode} PRs…</p>
                    )}
                    {browse.status === 'error' && (
                      <p className="dash__empty dash__empty--err" role="alert">
                        Couldn't load: {browse.error}{' '}
                        <button className="btn btn--sm" onClick={() => loadRepo(repo, browseMode)}>
                          Retry
                        </button>
                      </p>
                    )}
                    {browse.status === 'ready' && browse.items.length === 0 && (
                      <p className="dash__empty">No {browseMode} pull requests.</p>
                    )}
                    {browse.status === 'ready' && browse.items.length > 0 && (
                      <ul className="prlist">
                        {browse.items.map((item) => {
                          const c = item.coordinates;
                          const flagged = flags.some(
                            (f) =>
                              f.owner === c.owner &&
                              f.name === c.name &&
                              f.number === c.number,
                          );
                          return (
                            <PrRow
                              key={`${c.owner}/${c.name}#${c.number}`}
                              item={item}
                              meta={
                                item.updatedAt
                                  ? `updated ${relativeTime(item.updatedAt)}`
                                  : undefined
                              }
                              metaTitle={timeTitle(item.updatedAt)}
                              onOpen={onOpen}
                              onFlag={onFlag}
                              flagged={flagged}
                            />
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
