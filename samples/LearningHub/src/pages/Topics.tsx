import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { DeleteRegular } from '@fluentui/react-icons/headless/svg/delete';
import { PresenterRegular } from '@fluentui/react-icons/headless/svg/presenter';
import { StatusChip, VoteButton } from '../components/Controls';
import { ConfirmDialog } from '../components/Modal';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../components/States';
import { useMe, type Me } from '../lib/identity';
import { findPastSession, usePastSessions } from '../lib/pastSessions';
import { useProfile } from '../lib/people';
import { href, navigate, paths, type Route } from '../lib/router';
import { useSessionRecords } from '../lib/sessions';
import { formatInstantDate, formatWeekdayDate, formatDate } from '../lib/time';
import { useTopicActions } from '../lib/topicActions';
import {
  hasVoted,
  isMine,
  matchTopics,
  useTopics,
  type Topic,
  type TopicStatus,
} from '../lib/topics';
import { useDebounced } from '../lib/useDebounced';

type Filter = 'open' | 'covered' | 'mine';
type Sort = 'votes' | 'newest';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'covered', label: 'Covered' },
  { id: 'mine', label: 'Mine' },
];

type TopicsRoute = Extract<Route, { name: 'topics' }>;

export function Topics({ route }: { route: TopicsRoute }) {
  const me = useMe();
  const topics = useTopics();
  const actions = useTopicActions();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [sort, setSort] = useState<Sort>('votes');
  const myId = me.data?.id;
  const sessions = useSessionRecords();
  const records = sessions.data ?? [];
  const [deleting, setDeleting] = useState<Topic | null>(null);

  const all = useMemo(() => topics.data ?? [], [topics.data]);
  const counts: Record<Filter, number> = {
    open: all.filter((t) => t.status !== 'covered').length,
    covered: all.filter((t) => t.status === 'covered').length,
    mine: all.filter((t) => isMine(t, myId)).length,
  };
  const visible = all
    .filter((t) => (filter === 'open' ? t.status !== 'covered' : filter === 'covered' ? t.status === 'covered' : isMine(t, myId)))
    .sort((a, b) =>
      sort === 'votes'
        ? b.voteCount - a.voteCount || b.createdTime.localeCompare(a.createdTime)
        : b.createdTime.localeCompare(a.createdTime),
    );

  const toggleVote = (topic: Topic) => void actions.vote(topic, !hasVoted(topic, myId));

  // Open means unlinked; keeping a sessionRef on an open topic would make it impossible to link again.
  const changeStatus = (topic: Topic, status: TopicStatus) =>
    void actions.edit(topic, status === 'open' && topic.sessionRef ? { status, sessionRef: '' } : { status }, records);

  // The new row (temporary, then saved) is highlighted right away; that's the confirmation.
  const onRequestStarted = (tempId: string) => {
    if (filter === 'covered') setFilter('open');
    setHighlightId(tempId);
  };
  const onCreated = (tempId: string, topic: Topic) => setHighlightId((current) => (current === tempId ? topic.itemId : current));
  const onFailed = (tempId: string) => setHighlightId((current) => (current === tempId ? null : current));

  // Bring a newly requested topic into view; the row's highlight animation does the rest.
  useEffect(() => {
    if (!highlightId) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => {
      document.getElementById(`topic-${highlightId}`)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  return (
    <div className="page">
      <header className="page-header">
        <h1 tabIndex={-1}>Topic requests</h1>
        <p className="lede">Ask for a session you’d like to see, and vote for the ideas you want most.</p>
      </header>

      {me.isError && (
        <ErrorState
          compact
          title="Couldn’t load your profile, so requesting and voting are unavailable."
          error={me.error}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
        />
      )}

      <TopicComposer
        me={me.data}
        topics={all}
        myId={myId}
        autoFocus={route.focus}
        onStarted={onRequestStarted}
        onCreated={onCreated}
        onFailed={onFailed}
      />

      <section aria-labelledby="topics-heading" className="section">
        <div className="section__head">
          <h2 id="topics-heading" className="section__title">
            Requests
          </h2>
          <div className="toolbar">
            <div className="segmented" role="group" aria-label="Show">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="segmented__option"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                  {topics.data && <span className="segmented__count">{counts[f.id]}</span>}
                </button>
              ))}
            </div>
            <label className="inline-field">
              <span>Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="votes">Most voted</option>
                <option value="newest">Newest</option>
              </select>
            </label>
          </div>
        </div>

        {topics.isPending ? (
          <LoadingBlock label="Loading topics">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="skeleton--row" />
            ))}
          </LoadingBlock>
        ) : topics.isError ? (
          <ErrorState title="Couldn’t load topic requests." error={topics.error} onRetry={() => void topics.refetch()} retrying={topics.isFetching} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              filter === 'open'
                ? 'No open requests yet.'
                : filter === 'covered'
                  ? 'Nothing has been covered yet.'
                  : 'You haven’t requested or voted for anything yet.'
            }
          >
            {filter === 'covered'
              ? 'Covered topics show up here once a session addresses them.'
              : 'Use the box above to ask for one.'}
          </EmptyState>
        ) : (
          <ul className="topic-list">
            {visible.map((topic) => (
              <TopicRow
                key={topic.itemId}
                topic={topic}
                voted={hasVoted(topic, myId)}
                canVote={!!me.data}
                onVote={() => toggleVote(topic)}
                onStatusChange={(status) => changeStatus(topic, status)}
                onDelete={() => setDeleting(topic)}
                highlight={topic.itemId === highlightId}
              />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this topic request?"
        message={
          <p>
            “{deleting?.name}” and its {deleting?.voteCount ?? 0} {deleting?.voteCount === 1 ? 'vote' : 'votes'} will be removed.
          </p>
        }
        confirmLabel="Delete topic"
        danger
        onConfirm={() => {
          // Optimistic: the row disappears now and comes back with a message if the delete fails.
          if (deleting) void actions.remove(deleting, records);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function SessionLink({ dateKey }: { dateKey: string }) {
  const past = usePastSessions();
  const held = findPastSession(past.data, dateKey);
  return <a href={href(paths.session(held?.id ?? dateKey))}>{held ? formatDate(dateKey) : formatWeekdayDate(dateKey)}</a>;
}

interface TopicRowProps {
  topic: Topic;
  voted: boolean;
  canVote: boolean;
  onVote: () => void;
  onStatusChange: (status: TopicStatus) => void;
  onDelete: () => void;
  highlight?: boolean;
}

function RequestedBy({ userId }: { userId: string }) {
  const profile = useProfile(userId || undefined);
  return <>{profile.data?.displayName ? `Requested by ${profile.data.displayName}` : 'Requested'}</>;
}

const STATUS_OPTIONS: { value: TopicStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'covered', label: 'Covered' },
];

function TopicRow({ topic, voted, canVote, onVote, onStatusChange, onDelete, highlight }: TopicRowProps) {
  return (
    <li
      id={`topic-${topic.itemId}`}
      className={`topic${highlight ? ' topic--highlight' : ''}`}
      aria-busy={topic.pending || undefined}
    >
      <VoteButton topic={topic} voted={voted} disabled={!canVote || topic.pending} onToggle={onVote} />
      <div className="topic__main">
        <h3 className="topic__title">{topic.name}</h3>
        {topic.details && <p className="topic__details clamp-2">{topic.details}</p>}
        <p className="meta">
          <RequestedBy userId={topic.requestedBy} />
          {topic.pending ? ' · Saving…' : formatInstantDate(topic.createdTime) && ` · ${formatInstantDate(topic.createdTime)}`}
        </p>
      </div>
      <div className="topic__side">
        {topic.status === 'scheduled' && (
          <StatusChip tone="info">
            Scheduled{topic.sessionRef && <>&nbsp;·&nbsp;<SessionLink dateKey={topic.sessionRef} /></>}
          </StatusChip>
        )}
        {topic.status === 'covered' && (
          <StatusChip tone="success">
            Covered{topic.sessionRef && <>&nbsp;·&nbsp;<SessionLink dateKey={topic.sessionRef} /></>}
          </StatusChip>
        )}
        {topic.status === 'open' && !topic.sessionRef && !topic.pending && (
          <button type="button" className="button button--small" onClick={() => navigate(paths.presentTopic(topic.itemId))}>
            <PresenterRegular />
            I’ll present this<span className="visually-hidden">: {topic.name}</span>
          </button>
        )}
        {!topic.pending && (
          <div className="row-actions">
            <label className="visually-hidden" htmlFor={`status-${topic.itemId}`}>
              Status for {topic.name}
            </label>
            <select
              id={`status-${topic.itemId}`}
              className="select--compact select--status"
              value={topic.status}
              onChange={(e) => onStatusChange(e.target.value as TopicStatus)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button type="button" className="icon-button icon-button--small" onClick={onDelete} title="Delete request">
              <DeleteRegular />
              <span className="visually-hidden">Delete {topic.name}</span>
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

interface ComposerProps {
  me: Me | undefined;
  topics: Topic[];
  myId: string | undefined;
  autoFocus: boolean;
  onStarted: (tempId: string) => void;
  onCreated: (tempId: string, topic: Topic) => void;
  onFailed: (tempId: string) => void;
}

/**
 * Search-first composer: type what you want to learn, see matching requests live (vote instead of
 * duplicating), then request it. Enter submits only when nothing matches.
 */
function TopicComposer({ me, topics, myId, autoFocus, onStarted, onCreated, onFailed }: ComposerProps) {
  const actions = useTopicActions();
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const query = useDebounced(text, 150).trim();
  const matches = query.length >= 2 ? matchTopics(query, topics) : [];
  const title = text.trim();

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    setError(null);
    if (title.length < 3) return setError('Add a few more words so people know what you mean.');
    if (!me) return setError('Your profile hasn’t loaded yet, so you can’t request topics right now.');
    const input = { name: title, details: details.trim() };
    let tempId = '';
    actions.create(input, {
      // Also runs on Retry from the failure toast: clear the box only if it still holds this request.
      onStart: (id) => {
        tempId = id;
        setText((current) => (current.trim() === input.name ? '' : current));
        setDetails((current) => (current.trim() === input.details ? '' : current));
        onStarted(id);
      },
      onCreated,
      // Put the text back so nothing typed is lost, unless the person has started something new.
      onFailed: (failed) => {
        setText((current) => (current.trim() ? current : failed.name));
        setDetails((current) => (current.trim() ? current : failed.details));
        onFailed(tempId);
      },
    });
    inputRef.current?.focus();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  // Enter requests only when nothing similar exists; otherwise people pick a match or click "Request anyway".
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (title && matchTopics(title, topics).length === 0) submit();
  };

  const hasMatches = matches.length > 0;

  return (
    <section className="composer" aria-label="Request a topic">
      <form className="composer__box" onSubmit={onSubmit} noValidate>
        <label htmlFor={`${fieldId}-title`} className="visually-hidden">
          What do you want to learn?
        </label>
        <input
          ref={inputRef}
          id={`${fieldId}-title`}
          className="composer__input"
          type="text"
          value={text}
          maxLength={200}
          placeholder="What do you want to learn?"
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          aria-describedby={`${fieldId}-count`}
        />
        {title && (
          <div className="composer__details">
            <label htmlFor={`${fieldId}-details`}>Details (optional)</label>
            <textarea
              id={`${fieldId}-details`}
              rows={2}
              value={details}
              maxLength={4000}
              placeholder="What questions should the session answer?"
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
        )}
        <div className="composer__footer">
          <p className="composer__hint">
            {!title ? 'Search existing requests as you type.' : hasMatches ? 'Similar requests exist below.' : 'Press Enter to request.'}
          </p>
          <button
            type="submit"
            className={`button ${hasMatches ? '' : 'button--primary'} composer__submit`}
            disabled={!title || !me}
          >
            <span className="composer__submit-label">
              {hasMatches ? 'Request anyway' : title ? `Request “${title}”` : 'Request topic'}
            </span>
          </button>
        </div>
      </form>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <p id={`${fieldId}-count`} className="visually-hidden" aria-live="polite">
        {query.length >= 2 ? `${matches.length} matching ${matches.length === 1 ? 'request' : 'requests'}` : ''}
      </p>
      {hasMatches && (
        <div className="composer-matches">
          <p className="composer-matches__title">Already requested? Vote instead of adding a duplicate.</p>
          <ul>
            {matches.map((topic) => (
              <li key={topic.itemId} className="composer-match">
                <span className="composer-match__name">{topic.name}</span>
                <span className="composer-match__side">
                  {topic.status === 'covered' ? (
                    <StatusChip tone="success">
                      {topic.sessionRef ? (
                        <>
                          Covered on&nbsp;<SessionLink dateKey={topic.sessionRef} />
                        </>
                      ) : (
                        'Covered'
                      )}
                    </StatusChip>
                  ) : (
                    <>
                      {topic.status === 'scheduled' ? (
                        <StatusChip tone="info">
                          Scheduled{topic.sessionRef && <>&nbsp;·&nbsp;<SessionLink dateKey={topic.sessionRef} /></>}
                        </StatusChip>
                      ) : (
                        <StatusChip tone="quiet">Open</StatusChip>
                      )}
                      <VoteButton
                        topic={topic}
                        voted={hasVoted(topic, myId)}
                        disabled={!me || topic.pending}
                        compact
                        onToggle={() => void actions.vote(topic, !hasVoted(topic, myId))}
                      />
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
