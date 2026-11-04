import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { DismissRegular } from '@fluentui/react-icons/headless/svg/dismiss';
import { SearchRegular } from '@fluentui/react-icons/headless/svg/search';
import { PresenterList } from '../components/Avatar';
import { Duration, StatusChip, WatchButton } from '../components/Controls';
import { Motif } from '../components/Motif';
import { Spinner } from '../components/Spinner';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../components/States';
import { TalkCard, TalkCardSkeleton, UpNextCard } from '../components/TalkCard';
import { config } from '../config';
import { errorMessage } from '../lib/format';
import { recordedDates, usePastSessions, type PastSession, type Presenter } from '../lib/pastSessions';
import { href, paths } from '../lib/router';
import { removeSampleData } from '../lib/sampleData';
import { buildSlots, pastStateSessions, SESSION_TIME, useSessionRecords, type SessionRecord } from '../lib/sessions';
import { formatDay, formatMonthShort, formatTimeRange, formatWeekdayDate, formatYear, useNow, weekdayName } from '../lib/time';
import { useToast } from '../lib/toast';
import { useAppStorage } from '../storage/useAppStorage';

const WEEKDAY = weekdayName(config.weekday);

type ListItem =
  | { kind: 'held'; key: string; session: PastSession }
  | { kind: 'pending'; key: string; record: SessionRecord };

function itemText(item: ListItem): string {
  if (item.kind === 'held') {
    const s = item.session;
    return [s.title, s.synopsis ?? '', ...s.presenters.map((p) => p.name), ...s.tags].join(' ').toLowerCase();
  }
  const r = item.record;
  return [r.name, r.description, ...r.presenters.map((p) => p.name)].join(' ').toLowerCase();
}

export function Home() {
  const now = useNow();
  const sessions = useSessionRecords();
  const past = usePastSessions();
  // Up next plus the two newest recordings (next, last week, two weeks ago). With no upcoming date
  // left (series over, or every remaining week cancelled), the third recording takes its column.
  const hasNext = !sessions.data || buildSlots(sessions.data, now).some((s) => s.state !== 'cancelled');
  const latest = (past.data ?? []).slice(0, hasNext ? 2 : 3);
  return (
    <div className="page">
      <header className="page-header">
        <h1 tabIndex={-1}>{config.seriesName}</h1>
        <p className="lede">
          {WEEKDAY}s, {formatTimeRange(SESSION_TIME.start, SESSION_TIME.end)}. {config.seriesDescription}
        </p>
      </header>

      <SampleDataNotice sessions={past.data} />

      <section aria-labelledby="latest-heading" className="section section--flush">
        <h2 id="latest-heading" className="section__title">
          Latest
        </h2>
        <UpNextNotes />
        <div className="talk-grid">
          <UpNext />
          {past.isPending ? (
            <>
              <TalkCardSkeleton />
              <TalkCardSkeleton />
            </>
          ) : (
            latest.map((session, index) => (
              <TalkCard key={session.id} session={session} newest={index === 0} variant={index + 1} />
            ))
          )}
        </div>
      </section>

      <GetInvolved />

      <AllSessions />
    </div>
  );
}

/** One-click removal of the fictional first-run sessions. */
function SampleDataNotice({ sessions }: { sessions: PastSession[] | undefined }) {
  const storage = useAppStorage();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: () => removeSampleData(storage),
    onSuccess: (count) => toast({ tone: 'success', message: `Removed ${count} sample ${count === 1 ? 'session' : 'sessions'}.` }),
    onError: (error) => toast({ tone: 'error', message: `Couldn’t remove the sample data. ${errorMessage(error)}` }),
  });
  if (!sessions?.some((s) => s.sample)) return null;
  return (
    <div className="note sample-note" role="note">
      <p>
        <strong>Sample data.</strong> The past sessions marked “Sample” are fictional, so you can see how the app looks. Remove them
        whenever you like; they won’t come back.
      </p>
      <button type="button" className="button button--small" onClick={() => remove.mutate()} disabled={remove.isPending} aria-busy={remove.isPending || undefined}>
        {remove.isPending && <Spinner />}
        Remove sample data
      </button>
    </div>
  );
}

/** The next date that isn't cancelled, as the first card in the Latest row. */
function UpNext() {
  const now = useNow();
  const sessions = useSessionRecords();
  if (sessions.isPending) return <TalkCardSkeleton />;
  if (sessions.isError) {
    return (
      <div className="talk-card talk-card--error">
        <ErrorState
          compact
          title="Couldn’t load the next session."
          error={sessions.error}
          onRetry={() => void sessions.refetch()}
          retrying={sessions.isFetching}
        />
      </div>
    );
  }
  const next = buildSlots(sessions.data, now).find((s) => s.state !== 'cancelled');
  return next ? <UpNextCard slot={next} /> : null;
}

/** Cancelled weeks before the next session, so a skipped week isn't a surprise. */
function UpNextNotes() {
  const now = useNow();
  const sessions = useSessionRecords();
  if (!sessions.data) return null;
  const slots = buildSlots(sessions.data, now);
  const next = slots.find((s) => s.state !== 'cancelled');
  const skipped = slots.filter((s) => s.state === 'cancelled' && (!next || s.key < next.key));
  if (skipped.length === 0) return null;
  return <p className="meta section__hint">No session on {skipped.map((s) => formatWeekdayDate(s.key)).join(', ')}.</p>;
}

const SUGGESTIONS = [
  {
    seed: 'involve-present',
    title: 'Present a session',
    text: `Pick an open ${WEEKDAY} and share what you know.`,
    path: paths.present,
  },
  {
    seed: 'request-a-topic',
    title: 'Request a topic',
    text: 'Ask for a session, or vote for one that’s already requested.',
    path: paths.topicsCompose,
  },
];

/** Suggestion cards: secondary to the talks above, and they navigate (no dialogs). */
function GetInvolved() {
  return (
    <section className="section" aria-labelledby="involve-heading">
      <h2 id="involve-heading" className="section__title section__title--quiet">
        Get involved
      </h2>
      <div className="suggest-grid">
        {SUGGESTIONS.map((s) => (
          <a key={s.seed} className="suggest-card" href={href(s.path)}>
            <Motif seed={s.seed} square className="suggest-card__art" />
            <span className="suggest-card__text">
              <span className="suggest-card__title">{s.title}</span>
              <span className="suggest-card__desc">{s.text}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function AllSessions() {
  const now = useNow();
  const sessions = useSessionRecords();
  const past = usePastSessions();
  const [query, setQuery] = useState('');

  const items = useMemo<ListItem[]>(() => {
    const pending = sessions.data ? pastStateSessions(sessions.data, now, recordedDates(past.data)) : [];
    return [
      ...(past.data ?? []).map((s): ListItem => ({ kind: 'held', key: s.date, session: s })),
      ...pending.map((r): ListItem => ({ kind: 'pending', key: r.key, record: r })),
    ].sort((a, b) => b.key.localeCompare(a.key));
  }, [sessions.data, past.data, now]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = words.length ? items.filter((item) => words.every((w) => itemText(item).includes(w))) : items;

  return (
    <section aria-labelledby="all-heading" className="section">
      <div className="section__head">
        <h2 id="all-heading" className="section__title">
          All sessions
        </h2>
        <div className="search">
          <label htmlFor="session-search" className="visually-hidden">
            Search sessions
          </label>
          <SearchRegular className="search__icon" />
          <input
            id="session-search"
            type="search"
            placeholder="Search titles, people, tags"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="search__clear icon-button icon-button--small" aria-label="Clear search text" onClick={() => setQuery('')}>
              <DismissRegular />
            </button>
          )}
        </div>
      </div>

      {sessions.isError && (
        <ErrorState
          compact
          title="Couldn’t load recent sessions that aren’t recorded yet."
          error={sessions.error}
          onRetry={() => void sessions.refetch()}
          retrying={sessions.isFetching}
        />
      )}
      {past.isError && (
        <ErrorState
          compact
          title="Couldn’t load past sessions."
          error={past.error}
          onRetry={() => void past.refetch()}
          retrying={past.isFetching}
        />
      )}

      <p className="visually-hidden" aria-live="polite">
        {words.length ? `${filtered.length} ${filtered.length === 1 ? 'session' : 'sessions'} found` : ''}
      </p>

      {past.isPending ? (
        <LoadingBlock label="Loading sessions">
          <Skeleton className="skeleton--row" />
          <Skeleton className="skeleton--row" />
        </LoadingBlock>
      ) : items.length === 0 ? (
        <EmptyState title="No past sessions yet.">Sessions show up here after they happen.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={`No sessions match “${query.trim()}”.`}
          action={
            <button type="button" className="button button--small" onClick={() => setQuery('')}>
              Clear search
            </button>
          }
        >
          Try a person’s name, a product, or a tag.
        </EmptyState>
      ) : (
        <ul className="session-list">
          {filtered.map((item) =>
            item.kind === 'held' ? (
              <SessionRow
                key={item.session.id}
                id={item.session.id}
                date={item.key}
                title={item.session.title}
                summary={item.session.synopsis}
                presenters={item.session.presenters}
                recordingUrl={item.session.recordingUrl}
                durationSeconds={item.session.durationSeconds}
                sample={item.session.sample}
              />
            ) : (
              <SessionRow
                key={item.record.itemId}
                id={item.key}
                date={item.key}
                title={item.record.name || 'Untitled session'}
                summary={item.record.description}
                presenters={item.record.presenters}
                recordingUrl={null}
                comingSoon
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

interface RowProps {
  id: string;
  date: string;
  title: string;
  summary: string | null;
  presenters: Presenter[];
  recordingUrl: string | null;
  durationSeconds?: number | null;
  comingSoon?: boolean;
  sample?: boolean;
}

function SessionRow({ id, date, title, summary, presenters, recordingUrl, durationSeconds, comingSoon, sample }: RowProps) {
  return (
    <li className="session-row">
      <time className="date-badge" dateTime={date}>
        <span className="date-badge__month">{formatMonthShort(date)}</span>
        <span className="date-badge__day">{formatDay(date)}</span>
        <span className="date-badge__year">{formatYear(date)}</span>
      </time>
      <div className="session-row__main">
        <h3 className="session-row__title">
          <a href={href(paths.session(id))}>{title}</a>
          {sample && (
            <>
              {' '}
              <StatusChip tone="warning">Sample</StatusChip>
            </>
          )}
        </h3>
        {summary && <p className="session-row__summary clamp-2">{summary}</p>}
        <PresenterList presenters={presenters} size="xs" emptyLabel="Presenters not listed" />
      </div>
      <div className="session-row__actions">
        {comingSoon ? (
          <StatusChip tone="quiet">Recording coming soon</StatusChip>
        ) : recordingUrl ? (
          <>
            <Duration seconds={durationSeconds} />
            <WatchButton url={recordingUrl} title={title} small />
          </>
        ) : (
          <span className="meta">No recording</span>
        )}
      </div>
    </li>
  );
}
