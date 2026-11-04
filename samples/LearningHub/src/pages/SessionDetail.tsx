import type { ReactNode } from 'react';
import { ArrowLeftRegular } from '@fluentui/react-icons/headless/svg/arrow-left';
import { DocumentRegular } from '@fluentui/react-icons/headless/svg/document';
import { OpenRegular } from '@fluentui/react-icons/headless/svg/open';
import { PlayFilled } from '@fluentui/react-icons/headless/svg/play';
import { Avatar } from '../components/Avatar';
import { Duration, StatusChip, WatchButton } from '../components/Controls';
import { ShareButton } from '../components/ShareButton';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../components/States';
import { CalendarGlyph, TileArt } from '../components/TalkCard';
import { useIsMe } from '../lib/identity';
import { findPastSession, usePastSessions, type Presenter } from '../lib/pastSessions';
import { useProfile } from '../lib/people';
import { href, paths } from '../lib/router';
import { safeUrl } from '../lib/safeUrl';
import { activeFor, isMineSession, isOver, SESSION_TIME, useSessionRecords } from '../lib/sessions';
import { formatLongDate, formatStartTime, formatTimeRange, formatWeekdayDate, isDateKey, seriesDateKey, useNow } from '../lib/time';
import { useTopics, type Topic } from '../lib/topics';

function BackLink() {
  return (
    <a className="back-link back-link--compact" href={href(paths.home)}>
      <ArrowLeftRegular />
      Sessions
    </a>
  );
}

function LoadingDetail({ label }: { label: string }) {
  return (
    <div className="page page--detail">
      <BackLink />
      <LoadingBlock label={label}>
        <Skeleton className="skeleton--title" />
        <Skeleton className="skeleton--line" />
        <Skeleton className="skeleton--line skeleton--short" />
      </LoadingBlock>
    </div>
  );
}

export function SessionDetail({ id }: { id: string }) {
  const pastSessions = usePastSessions();
  if (pastSessions.isPending) return <LoadingDetail label="Loading session" />;
  const held = findPastSession(pastSessions.data, id);
  if (held) {
    const recordingUrl = safeUrl(held.recordingUrl);
    return (
      <DetailLayout
        shareRoute={paths.session(held.id)}
        date={held.date}
        title={held.title}
        presenters={held.presenters}
        badge={
          <>
            {held.sample && <StatusChip tone="warning">Sample</StatusChip>}
            {recordingUrl ? null : <StatusChip tone="quiet">No recording</StatusChip>}
          </>
        }
        tile={
          <DetailTile
            seed={held.id}
            title={held.title}
            presenters={held.presenters}
            tags={held.tags}
            recordingUrl={recordingUrl}
            durationSeconds={held.durationSeconds}
          />
        }
        primary={
          recordingUrl ? (
            <>
              <WatchButton url={recordingUrl} title={held.title} primary />
              <Duration seconds={held.durationSeconds} className="duration--action" />
            </>
          ) : null
        }
        summaryLabel="Synopsis"
        summary={held.synopsis}
        resources={held.resources}
        tags={held.tags}
      />
    );
  }
  if (isDateKey(id)) return <StateSessionDetail dateKey={id} />;
  return <NotFoundSession />;
}

function NotFoundSession() {
  return (
    <div className="page page--detail">
      <BackLink />
      <EmptyState title="We couldn’t find that session." action={<a className="button button--small" href={href(paths.home)}>See all sessions</a>}>
        It may have been removed, or the link is incomplete.
      </EmptyState>
    </div>
  );
}

function StateSessionDetail({ dateKey }: { dateKey: string }) {
  const now = useNow();
  const sessions = useSessionRecords();
  const isMe = useIsMe();

  if (sessions.isPending) return <LoadingDetail label="Loading session" />;
  if (sessions.isError) {
    return (
      <div className="page page--detail">
        <BackLink />
        <ErrorState title="Couldn’t load this session." error={sessions.error} onRetry={() => void sessions.refetch()} retrying={sessions.isFetching} />
      </div>
    );
  }
  const record = activeFor(sessions.data, dateKey).claimed;
  if (!record) return <NotFoundSession />;
  const over = isOver(dateKey, now);
  const mine = isMineSession(record, isMe);
  const title = record.name || 'Topic to be announced';
  const when = `${dateKey === seriesDateKey(now) ? 'Today' : formatWeekdayDate(dateKey)} · ${formatStartTime(SESSION_TIME.start)}`;

  return (
    <DetailLayout
      shareRoute={paths.session(dateKey)}
      date={dateKey}
      title={title}
      presenters={record.presenters}
      prominentDate={!over}
      badge={over ? <StatusChip tone="quiet">Recording coming soon</StatusChip> : <StatusChip tone="info">Upcoming</StatusChip>}
      tile={
        <DetailTile
          seed={record.itemId}
          title={title}
          presenters={record.presenters}
          tags={[]}
          recordingUrl={null}
          upcomingWhen={over ? undefined : when}
        />
      }
      primary={
        over ? null : (
          <a className="button" href={href(paths.presentEdit(record.itemId))}>
            {mine ? 'Edit your session' : 'Edit session'}
          </a>
        )
      }
      summaryLabel="About this session"
      summary={record.description || null}
      resources={[]}
      tags={[]}
    />
  );
}

interface TileProps {
  seed: string;
  title: string;
  presenters: Presenter[];
  tags: string[];
  recordingUrl: string | null;
  durationSeconds?: number | null;
  /** Upcoming sessions show a calendar badge and this date chip instead of a play button. */
  upcomingWhen?: string;
}

/**
 * The same 16:9 title card as the talk cards (hash-based texture). With a recording it opens it in
 * a new tab; otherwise it's a picture, not a control.
 */
function DetailTile({ seed, title, presenters, tags, recordingUrl, durationSeconds, upcomingWhen }: TileProps) {
  const art = <TileArt seed={seed} presenters={presenters} tags={tags} />;
  if (recordingUrl) {
    return (
      <a
        className="talk-tile detail-tile"
        href={recordingUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Watch ${title} (opens in a new tab)`}
      >
        {art}
        <span className="talk-tile__play" aria-hidden="true">
          <PlayFilled />
        </span>
        <Duration seconds={durationSeconds} className="talk-tile__chip" />
      </a>
    );
  }
  return (
    <div className="talk-tile detail-tile detail-tile--static">
      {art}
      {upcomingWhen ? (
        <>
          <span className="talk-tile__badge" aria-hidden="true">
            <CalendarGlyph />
          </span>
          <span className="talk-tile__chip talk-tile__when" aria-hidden="true">
            {upcomingWhen}
          </span>
        </>
      ) : (
        <Duration seconds={durationSeconds} className="talk-tile__chip" />
      )}
    </div>
  );
}

interface DetailProps {
  shareRoute: string;
  date: string;
  title: string;
  presenters: Presenter[];
  badge: ReactNode;
  tile: ReactNode;
  primary: ReactNode;
  /** Upcoming sessions lead with the date. */
  prominentDate?: boolean;
  summaryLabel: string;
  summary: string | null;
  resources: { label: string; url: string }[];
  tags: string[];
}

function DetailLayout({ shareRoute, date, title, presenters, badge, tile, primary, prominentDate, summaryLabel, summary, resources, tags }: DetailProps) {
  return (
    <div className="page page--detail">
      <BackLink />
      <article className="detail" aria-labelledby="detail-title">
        {/* Intro first in the DOM (title before the picture); CSS puts the tile on top on narrow screens. */}
        <div className="detail__hero">
          <div className="detail__intro">
            <p className={`detail__when${prominentDate ? ' detail__when--prominent' : ' meta'}`}>
              {/* One flex item, so a narrow screen wraps it as text instead of starting a line with “·”. */}
              <span>
                <time dateTime={date}>{formatLongDate(date)}</time> · {formatTimeRange(SESSION_TIME.start, SESSION_TIME.end)}
              </span>
              {badge}
            </p>
            <h1 id="detail-title" tabIndex={-1}>
              {title}
            </h1>
            {tags.length > 0 && (
              <ul className="tags" aria-label="Tags">
                {tags.map((tag) => (
                  <li key={tag} className="tag">
                    {tag}
                  </li>
                ))}
              </ul>
            )}
            <section aria-labelledby="presenters-heading">
              <h2 id="presenters-heading" className="visually-hidden">
                {presenters.length === 1 ? 'Presenter' : 'Presenters'}
              </h2>
              {presenters.length === 0 ? (
                <p className="meta">Presenters weren’t recorded for this session.</p>
              ) : (
                <ul className="people-list people-list--compact">
                  {presenters.map((p) => (
                    <PresenterItem key={p.id || p.name} presenter={p} />
                  ))}
                </ul>
              )}
            </section>
            {/* Watch (or Edit) leads; Share always sits last in the same row. */}
            <div className="detail__actions">
              {primary}
              <ShareButton route={shareRoute} what="this session" />
            </div>
          </div>
          <div className="detail__media">{tile}</div>
        </div>

        {summary && (
          <section aria-labelledby="summary-heading" className="detail__section">
            <h2 id="summary-heading" className="label">
              {summaryLabel}
            </h2>
            <p className="detail__summary">{summary}</p>
          </section>
        )}

        {resources.length > 0 && (
          <section aria-labelledby="resources-heading" className="detail__section">
            <h2 id="resources-heading" className="label">
              Resources
            </h2>
            <ul className="resource-list">
              {resources.map((r) => {
                const url = safeUrl(r.url);
                if (!url) return null;
                return (
                  <li key={r.url}>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="resource">
                      <DocumentRegular className="resource__icon" />
                      <span className="resource__label">{r.label}</span>
                      <OpenRegular className="resource__open" />
                      <span className="visually-hidden"> (opens in a new tab)</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <RelatedTopics dateKey={date} />
      </article>
    </div>
  );
}

function PresenterItem({ presenter }: { presenter: Presenter }) {
  const profile = useProfile(presenter.id || undefined);
  const name = presenter.name || profile.data?.displayName || 'Unknown person';
  const content = (
    <>
      <Avatar userId={presenter.id} name={name} size="md" />
      <span className="people-list__text">
        <span className="people-list__name">{name}</span>
        {profile.data?.jobTitle && <span className="meta">{profile.data.jobTitle}</span>}
      </span>
    </>
  );
  return (
    <li>
      {presenter.id ? (
        <a className="people-list__item" href={href(paths.person(presenter.id))}>
          {content}
        </a>
      ) : (
        <span className="people-list__item">{content}</span>
      )}
    </li>
  );
}

function topicStatusLabel(topic: Topic): string {
  return topic.status === 'covered' ? 'Covered' : topic.status === 'scheduled' ? 'Scheduled' : 'Open';
}

function RelatedTopics({ dateKey }: { dateKey: string }) {
  const topics = useTopics();
  if (topics.isPending) return null;
  if (topics.isError) {
    return (
      <section className="detail__section">
        <ErrorState compact title="Couldn’t load related topic requests." error={topics.error} onRetry={() => void topics.refetch()} retrying={topics.isFetching} />
      </section>
    );
  }
  const related = topics.data.filter((t) => t.sessionRef === dateKey);
  if (related.length === 0) return null;
  return (
    <section aria-labelledby="related-heading" className="detail__section">
      <h2 id="related-heading" className="label">
        Requested topics this covers
      </h2>
      <ul className="related-list">
        {related.map((t) => (
          <li key={t.itemId}>
            <span className="related-list__name">{t.name}</span>
            <span className="meta">
              {t.voteCount} {t.voteCount === 1 ? 'vote' : 'votes'}
            </span>
            <StatusChip tone={t.status === 'covered' ? 'success' : 'plain'}>{topicStatusLabel(t)}</StatusChip>
          </li>
        ))}
      </ul>
    </section>
  );
}
