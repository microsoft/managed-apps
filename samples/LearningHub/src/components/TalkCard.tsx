import { PlayFilled } from '@fluentui/react-icons/headless/svg/play';
import { joinNames } from '../lib/format';
import { safeUrl } from '../lib/safeUrl';
import type { PastSession, Presenter } from '../lib/pastSessions';
import { href, paths } from '../lib/router';
import { SESSION_TIME, type Slot } from '../lib/sessions';
import {
  daysBetween,
  formatDurationLong,
  formatLongDate,
  formatRelativeDay,
  formatRelativeUpcoming,
  formatStartTime,
  formatTimeRange,
  formatWeekdayDate,
  seriesDateKey,
  useNow,
} from '../lib/time';
import { Avatar } from './Avatar';
import { Duration } from './Controls';
import { Motif } from './Motif';
import { Skeleton } from './States';
import { BrandMark } from './TopBar';

const NEW_FOR_DAYS = 14;

/** The 16:9 "title card": presenter faces on a warm surface, or the series mark and tags. */
export function TileArt({
  seed,
  presenters,
  tags,
  variant,
}: {
  seed: string;
  presenters: Presenter[];
  tags: string[];
  variant?: number;
}) {
  const shown = presenters.slice(0, 3);
  return (
    <span className="talk-tile__art" aria-hidden="true">
      <Motif seed={seed} variant={variant} className="talk-tile__texture" />
      {shown.length > 0 ? (
        <span className={`talk-tile__faces talk-tile__faces--${shown.length}`}>
          {shown.map((p) => (
            <Avatar key={p.id || p.name} userId={p.id} name={p.name} size="lg" className="talk-tile__face" />
          ))}
          {presenters.length > shown.length && <span className="talk-tile__more">+{presenters.length - shown.length}</span>}
        </span>
      ) : (
        <span className="talk-tile__fallback">
          <BrandMark />
          {tags.length > 0 && (
            <span className="talk-tile__tags">
              {tags.slice(0, 3).map((tag) => (
                <span key={tag} className="talk-tile__tag">
                  {tag}
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/** Inline so the home page doesn't pull in another icon module. */
export function CalendarGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="calendar-glyph">
      <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 8.5h14M7 3v3M13 3v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7.5" cy="12.25" r="1" fill="currentColor" />
      <circle cx="10.5" cy="12.25" r="1" fill="currentColor" />
    </svg>
  );
}

/**
 * A recorded talk: the tile plays the recording (new tab), the title opens the session detail.
 * Without a recording the tile is a mouse-only shortcut to the detail page.
 */
export function TalkCard({ session, newest, variant }: { session: PastSession; newest: boolean; variant?: number }) {
  const now = useNow();
  const today = seriesDateKey(now);
  const age = daysBetween(session.date, today);
  const isNew = newest && age >= 0 && age <= NEW_FOR_DAYS;
  const headingId = `talk-${session.id}`;
  const detail = href(paths.session(session.id));
  const names = joinNames(session.presenters.map((p) => p.name).filter(Boolean));
  const recordingUrl = safeUrl(session.recordingUrl);
  const art = <TileArt seed={session.id} presenters={session.presenters} tags={session.tags} variant={variant} />;

  return (
    <article className="talk-card" aria-labelledby={headingId}>
      {recordingUrl ? (
        <a
          className="talk-tile"
          href={recordingUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Watch ${session.title} (opens in a new tab)`}
        >
          {art}
          <span className="talk-tile__play" aria-hidden="true">
            <PlayFilled />
          </span>
          <Duration seconds={session.durationSeconds} className="talk-tile__chip" />
        </a>
      ) : (
        <a className="talk-tile talk-tile--static" href={detail} tabIndex={-1} aria-hidden="true">
          {art}
          <Duration seconds={session.durationSeconds} className="talk-tile__chip" />
        </a>
      )}
      <div className="talk-card__body">
        <h3 id={headingId} className="talk-card__title">
          <a href={detail}>{session.title}</a>
        </h3>
        <p className="talk-card__people">{names || 'Presenters not listed'}</p>
        <p className="talk-card__meta">
          {session.sample && <span className="talk-card__label">Sample</span>}
          {isNew && <span className="talk-card__label talk-card__label--new">New</span>}
          <time dateTime={session.date} title={formatLongDate(session.date)}>
            {formatRelativeDay(session.date, today)}
          </time>
          {session.durationSeconds ? <span className="visually-hidden">, {formatDurationLong(session.durationSeconds)}</span> : null}
          {!recordingUrl && (
            <>
              <span aria-hidden="true">·</span>
              <span>No recording</span>
            </>
          )}
        </p>
      </div>
    </article>
  );
}

/** "Thu, Oct 22 · 9:05 AM PDT" or "Today · 9:05 AM PDT". Narrow tiles drop the weekday so the chip clears the badge. */
function WhenChip({ dateKey, today }: { dateKey: string; today: string }) {
  const [weekday, monthDay] = formatWeekdayDate(dateKey).split(', ');
  return (
    <span className="talk-tile__chip talk-tile__when">
      {dateKey === today ? (
        'Today'
      ) : (
        <>
          <span className="talk-tile__when-weekday">{weekday}, </span>
          {monthDay}
        </>
      )}{' '}
      · {formatStartTime(SESSION_TIME.start)}
    </span>
  );
}

/** "Today", "Tomorrow" and "This Thursday" read better than a date; further out, the date is clearer. */
function nearDay(relative: string): boolean {
  return relative === 'Today' || relative === 'Tomorrow' || relative.startsWith('This ');
}

/** Present today · Present next Thursday · Present on Thu, Nov 5 */
function presentTitle(relative: string, key: string): string {
  if (relative === 'Today' || relative === 'Tomorrow' || /^(This|Next) /.test(relative)) {
    return `Present ${relative.charAt(0).toLowerCase()}${relative.slice(1)}`;
  }
  return `Present on ${formatWeekdayDate(key)}`;
}

/**
 * The next upcoming date, in the same anatomy as a talk card. A claimed date shows its presenters
 * and links to the session (the tile duplicates the title link, so it is mouse-only). An open date
 * is a quiet tile whose one control is a real "Sign up to present" link to the Present page.
 */
export function UpNextCard({ slot }: { slot: Slot }) {
  const now = useNow();
  const today = seriesDateKey(now);
  const relative = formatRelativeUpcoming(slot.key, today);
  const headingId = `upnext-${slot.key}`;
  const label = <span className="talk-card__label talk-card__label--upcoming">Upcoming</span>;

  if (slot.state === 'claimed' && slot.record) {
    const record = slot.record;
    const detail = href(paths.session(slot.key));
    const names = joinNames(record.presenters.map((p) => p.name).filter(Boolean));
    return (
      <article className="talk-card talk-card--upcoming" aria-labelledby={headingId}>
        <a className="talk-tile" href={detail} tabIndex={-1} aria-hidden="true">
          <TileArt seed={record.itemId} presenters={record.presenters} tags={[]} variant={0} />
          <span className="talk-tile__badge">
            <CalendarGlyph />
          </span>
          <WhenChip dateKey={slot.key} today={today} />
        </a>
        <div className="talk-card__body">
          <h3 id={headingId} className="talk-card__title">
            <a href={detail}>{record.name || 'Topic to be announced'}</a>
          </h3>
          <p className="talk-card__people">{names || 'Presenters to be announced'}</p>
          <p className="talk-card__meta">
            {label}
            <time dateTime={slot.key} title={formatLongDate(slot.key)}>
              {relative}
            </time>
            {/* The tile's date chip is hidden from assistive tech, so the start time is spoken here. */}
            <span className="visually-hidden">, {formatStartTime(SESSION_TIME.start)}</span>
          </p>
        </div>
      </article>
    );
  }

  const present = href(paths.presentDate(slot.key));
  return (
    <article className="talk-card talk-card--upcoming" aria-labelledby={headingId}>
      <div className="talk-tile talk-tile--slot">
        <p className="talk-tile__slot-text">
          <time dateTime={slot.key} title={formatLongDate(slot.key)}>
            {nearDay(relative) ? relative : formatWeekdayDate(slot.key)}
          </time>{' '}
          is open
        </p>
        <a className="button button--primary button--small talk-tile__cta" href={present}>
          Sign up to present<span className="visually-hidden"> on {formatLongDate(slot.key)}</span>
        </a>
      </div>
      <div className="talk-card__body">
        <h3 id={headingId} className="talk-card__title">
          {presentTitle(relative, slot.key)}
        </h3>
        <p className="talk-card__sub">Share something you’ve learned with the team.</p>
        <p className="talk-card__meta">
          {label}
          <span>{formatTimeRange(SESSION_TIME.start, SESSION_TIME.end)}</span>
        </p>
      </div>
    </article>
  );
}

export function TalkCardSkeleton() {
  return (
    <div className="talk-card" aria-hidden="true">
      <Skeleton className="talk-tile-skeleton" />
      <div className="talk-card__body">
        <Skeleton className="skeleton--line" />
        <Skeleton className="skeleton--line skeleton--short" />
      </div>
    </div>
  );
}
