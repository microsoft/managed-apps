import { ArrowLeftRegular } from '@fluentui/react-icons/headless/svg/arrow-left';
import { Avatar } from '../components/Avatar';
import { StatusChip, WatchButton } from '../components/Controls';
import { ShareButton } from '../components/ShareButton';
import { ErrorState, LoadingBlock, Skeleton } from '../components/States';
import { recordedDates, usePastSessions, type Presenter } from '../lib/pastSessions';
import { useProfile } from '../lib/people';
import { href, paths } from '../lib/router';
import { buildSlots, pastStateSessions, SESSION_TIME, useSessionRecords } from '../lib/sessions';
import { formatDate, formatTimeRange, formatWeekdayDate, useNow } from '../lib/time';

/** A presenter's page, keyed by directory user id. */
export function Person({ id }: { id: string }) {
  const now = useNow();
  const profile = useProfile(id);
  const sessions = useSessionRecords();
  const pastSessions = usePastSessions();

  const matches = (list: Presenter[]) => list.some((p) => p.id === id);

  const snapshotName =
    pastSessions.data?.flatMap((s) => s.presenters).find((p) => p.id === id)?.name ??
    sessions.data?.flatMap((r) => r.presenters).find((p) => p.id === id)?.name;
  const name = profile.data?.displayName || snapshotName || 'Unknown person';

  const past = (pastSessions.data ?? []).filter((s) => matches(s.presenters));
  const pending = sessions.data
    ? pastStateSessions(sessions.data, now, recordedDates(pastSessions.data)).filter((r) => matches(r.presenters))
    : [];
  const upcoming = sessions.data
    ? buildSlots(sessions.data, now).filter((s) => s.state === 'claimed' && s.record && matches(s.record.presenters))
    : [];

  return (
    <div className="page page--narrow">
      <a className="back-link" href={href(paths.home)}>
        <ArrowLeftRegular />
        All sessions
      </a>
      <header className="profile">
        <Avatar userId={id} name={name} size="xl" />
        <div className="profile__text">
          {profile.isPending ? (
            <LoadingBlock label="Loading profile">
              <Skeleton className="skeleton--title" />
              <Skeleton className="skeleton--line skeleton--short" />
            </LoadingBlock>
          ) : (
            <>
              <h1 tabIndex={-1}>{name}</h1>
              {profile.data?.jobTitle && <p className="lede">{profile.data.jobTitle}</p>}
            </>
          )}
          <div className="profile__actions">
            <ShareButton route={paths.person(id)} what={`${name}’s presenter page`} />
          </div>
        </div>
      </header>

      {profile.isError && (
        <ErrorState
          compact
          title="Couldn’t load this person’s directory profile. Showing what we know from past sessions."
          error={profile.error}
          onRetry={() => void profile.refetch()}
          retrying={profile.isFetching}
        />
      )}

      <section aria-labelledby="upcoming-heading" className="section">
        <h2 id="upcoming-heading" className="section__title">
          Upcoming
        </h2>
        {sessions.isPending ? (
          <LoadingBlock label="Loading upcoming sessions">
            <Skeleton className="skeleton--row" />
          </LoadingBlock>
        ) : sessions.isError ? (
          <ErrorState compact title="Couldn’t load upcoming sessions." error={sessions.error} onRetry={() => void sessions.refetch()} retrying={sessions.isFetching} />
        ) : upcoming.length === 0 ? (
          <p className="meta">Nothing scheduled.</p>
        ) : (
          <ul className="simple-list">
            {upcoming.map((slot) => (
              <li key={slot.key}>
                <a href={href(paths.session(slot.key))}>{slot.record?.name || 'Topic to be announced'}</a>
                <span className="meta">
                  {formatWeekdayDate(slot.key)} · {formatTimeRange(SESSION_TIME.start, SESSION_TIME.end)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="past-heading" className="section">
        <h2 id="past-heading" className="section__title">
          Past sessions
        </h2>
        {pastSessions.isError ? (
          <ErrorState compact title="Couldn’t load past sessions." error={pastSessions.error} onRetry={() => void pastSessions.refetch()} retrying={pastSessions.isFetching} />
        ) : past.length === 0 && pending.length === 0 ? (
          <p className="meta">No past sessions yet.</p>
        ) : (
          <ul className="simple-list">
            {pending.map((r) => (
              <li key={r.itemId}>
                <a href={href(paths.session(r.key))}>{r.name || 'Untitled session'}</a>
                <span className="meta">{formatDate(r.key)}</span>
                <StatusChip tone="quiet">Recording coming soon</StatusChip>
              </li>
            ))}
            {past.map((s) => (
              <li key={s.id}>
                <a href={href(paths.session(s.id))}>{s.title}</a>
                <span className="meta">{formatDate(s.date)}</span>
                <WatchButton url={s.recordingUrl} title={s.title} small />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
