import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarAddRegular } from '@fluentui/react-icons/headless/svg/calendar-add';
import { PresenterList } from '../components/Avatar';
import { StatusChip } from '../components/Controls';
import { ConfirmDialog } from '../components/Modal';
import { SessionDialog, type SessionDialogMode } from '../components/SessionDialog';
import { Spinner } from '../components/Spinner';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../components/States';
import { config } from '../config';
import { errorMessage } from '../lib/format';
import { useIsMe, useMe } from '../lib/identity';
import { href, paths, replaceRoute, type Route } from '../lib/router';
import {
  buildSlots,
  cancelSlot,
  isMineSession,
  nextOpenDate,
  refreshSessionsWhenIdle,
  releaseSession,
  restoreSession,
  SESSION_TIME,
  useSessionRecords,
  type MutationOutcome,
  type SessionDraft,
  type SessionRecord,
  type Slot,
} from '../lib/sessions';
import {
  formatDate,
  formatDay,
  formatLongDate,
  formatMonthShort,
  formatTimeRange,
  formatWeekdayDate,
  seriesDateKey,
  useNow,
  weekdayName,
} from '../lib/time';
import { useToast } from '../lib/toast';
import { refreshTopicsWhenIdle, useTopics } from '../lib/topics';
import { useAppStorage } from '../storage/useAppStorage';

type PresentRoute = Extract<Route, { name: 'present' }>;

interface DialogState {
  mode: SessionDialogMode;
  record?: SessionRecord;
  initialDate?: string;
  initialTopicId?: string;
}

type PendingAction = { kind: 'release'; record: SessionRecord } | { kind: 'cancel'; slot: Slot };

interface Job {
  id: string;
  action: () => Promise<MutationOutcome>;
  success?: string;
}

const WEEKDAY = weekdayName(config.weekday);

export function Present({ route }: { route: PresentRoute }) {
  const now = useNow();
  const me = useMe();
  const isMe = useIsMe();
  const storage = useAppStorage();
  const sessions = useSessionRecords();
  const topics = useTopics();
  const toast = useToast();
  const client = useQueryClient();
  const [pending, setPending] = useState<PendingAction | null>(null);
  // Date picked from the CTA or a row; ?date= only targets the CTA and highlights a row.
  const [claimDate, setClaimDate] = useState<string | null>(null);
  // Mutation callbacks keep the options from when mutate() ran, so read dialog visibility from a ref.
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const slots = sessions.data ? buildSlots(sessions.data, now) : [];
  const today = seriesDateKey(now);

  const firstOpen = nextOpenDate(slots);
  const requested = route.date ? slots.find((s) => s.key === route.date && s.state === 'open')?.key : undefined;
  const target = requested ?? firstOpen;

  let dialog: DialogState | null = null;
  if (sessions.data) {
    if (route.edit) {
      const record = sessions.data.find((r) => r.itemId === route.edit);
      if (record) dialog = { mode: isMineSession(record, isMe) ? 'edit' : 'manage', record };
    } else if (route.topic && !topics.isPending) {
      dialog = { mode: 'claim', initialDate: firstOpen, initialTopicId: route.topic };
    } else if (claimDate) {
      dialog = { mode: 'claim', initialDate: claimDate };
    }
  }
  const closeDialog = () => {
    setClaimDate(null);
    if (route.edit || route.topic) replaceRoute(route.date ? paths.presentDate(route.date) : paths.present);
  };

  // Arriving with ?date= scrolls to that row once the dates load; CSS highlights it briefly.
  const loaded = !!sessions.data;
  useEffect(() => {
    if (!route.date || !loaded) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => {
      document.getElementById(`slot-${route.date}`)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [route.date, loaded]);

  const onSaved = (outcome: MutationOutcome, draft: SessionDraft) => {
    closeDialog();
    // Sign-ups get a confirmation; edits show up in the list (and roll back with a message on failure).
    if (dialog?.mode === 'claim') {
      toast({ tone: 'success', message: `You’re presenting on ${formatWeekdayDate(draft.key)}. Thanks!` });
    }
    if (outcome.warning) toast({ tone: 'error', message: outcome.warning });
  };

  // Conflict-checked against fresh data, so not optimistic: the triggering button or dialog waits.
  const run = useMutation({
    mutationFn: (job: Job) => job.action(),
    onSuccess: (outcome, job) => {
      setPending(null);
      if (job.success) toast({ tone: 'success', message: job.success });
      if (outcome.warning) toast({ tone: 'error', message: outcome.warning });
    },
    // The confirm dialog shows the error inline while it's open; otherwise surface it as a toast.
    onError: (error, job) => {
      if (!pendingRef.current) toast({ tone: 'error', message: errorMessage(error), action: { label: 'Retry', onAction: () => run.mutate(job) } });
    },
    onSettled: () => {
      refreshSessionsWhenIdle(client);
      refreshTopicsWhenIdle(client);
    },
  });

  const confirmPending = () => {
    if (!pending) return;
    if (pending.kind === 'release') {
      const record = pending.record;
      run.mutate({
        id: record.itemId,
        action: () => releaseSession(storage, record),
        success: `${formatWeekdayDate(record.key)} is open again.`,
      });
    } else {
      const slot = pending.slot;
      run.mutate({ id: slot.key, action: () => cancelSlot(storage, slot) });
    }
  };

  const restore = (record: SessionRecord) =>
    run.mutate({ id: record.itemId, action: () => restoreSession(storage, record) });

  return (
    <div className="page">
      <header className="page-header">
        <h1 tabIndex={-1}>Present a session</h1>
        <p className="lede">
          Pick an open {WEEKDAY}, say what you’ll cover, and add co-presenters. Sessions run{' '}
          {formatTimeRange(SESSION_TIME.start, SESSION_TIME.end)}.
        </p>
      </header>

      <SignUpPanel
        loading={sessions.isPending}
        failed={sessions.isError}
        target={target}
        isNext={!!target && target === firstOpen}
        canSignUp={!!me.data}
        onSignUp={(key) => setClaimDate(key)}
      />

      {me.isError && (
        <ErrorState
          compact
          title="Couldn’t load your profile, so signing up is unavailable."
          error={me.error}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
        />
      )}

      <div className="split-layout">
        <section aria-labelledby="dates-heading" className="split-layout__main">
          <h2 id="dates-heading" className="section__title">
            Upcoming dates
          </h2>
          {sessions.isPending ? (
            <LoadingBlock label="Loading upcoming dates">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="skeleton--row" />
              ))}
            </LoadingBlock>
          ) : sessions.isError ? (
            <ErrorState title="Couldn’t load upcoming dates." error={sessions.error} onRetry={() => void sessions.refetch()} retrying={sessions.isFetching} />
          ) : slots.length === 0 ? (
            <EmptyState title="No more dates in this series.">
              {config.endDate ? `The series ended on ${formatLongDate(config.endDate)}.` : 'Check back later.'}
            </EmptyState>
          ) : (
            <ul className="slot-list">
              {slots.map((slot) => (
                <SlotRow
                  key={slot.key}
                  slot={slot}
                  isToday={slot.key === today}
                  highlight={slot.key === route.date}
                  mine={!!slot.record && slot.state === 'claimed' && isMineSession(slot.record, isMe)}
                  canSignUp={!!me.data}
                  busy={run.isPending}
                  restoring={run.isPending && run.variables?.id === slot.record?.itemId}
                  onSignUp={() => setClaimDate(slot.key)}
                  onEdit={(record) => replaceRoute(paths.presentEdit(record.itemId))}
                  onRelease={(record) => {
                    run.reset();
                    setPending({ kind: 'release', record });
                  }}
                  onCancel={() => {
                    run.reset();
                    setPending({ kind: 'cancel', slot });
                  }}
                  onRestore={restore}
                />
              ))}
            </ul>
          )}
        </section>

        <aside aria-labelledby="requested-heading" className="split-layout__side">
          <MostRequested onPresent={(topicId) => replaceRoute(paths.presentTopic(topicId))} canPresent={!!me.data && !!sessions.data} />
        </aside>
      </div>

      <SessionDialog
        open={dialog !== null}
        mode={dialog?.mode ?? 'claim'}
        record={dialog?.record}
        initialDate={dialog?.initialDate}
        initialTopicId={dialog?.initialTopicId}
        onClose={closeDialog}
        onSaved={onSaved}
        me={me.data}
        slots={slots}
        topics={topics.data}
        topicsError={topics.isError}
      />

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'release'
            ? `Release ${formatWeekdayDate(pending.record.key)}?`
            : pending
              ? `Mark ${formatWeekdayDate(pending.slot.key)} as no session?`
              : ''
        }
        message={
          pending?.kind === 'release' ? (
            <p>The date opens up for someone else. A linked topic request goes back to the open list.</p>
          ) : (
            <p>
              {pending?.slot.record
                ? 'The session details are kept, so you can restore it later. A linked topic goes back to the open list.'
                : 'The date shows as “No session” and can’t be claimed until you restore it.'}
            </p>
          )
        }
        confirmLabel={pending?.kind === 'release' ? 'Release date' : 'Mark no session'}
        danger
        busy={run.isPending}
        error={run.isError && pending ? errorMessage(run.error) : undefined}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

interface SlotRowProps {
  slot: Slot;
  isToday: boolean;
  highlight: boolean;
  mine: boolean;
  canSignUp: boolean;
  busy: boolean;
  restoring: boolean;
  onSignUp: () => void;
  onEdit: (record: SessionRecord) => void;
  onRelease: (record: SessionRecord) => void;
  onCancel: () => void;
  onRestore: (record: SessionRecord) => void;
}

function SlotRow({ slot, isToday, highlight, mine, canSignUp, busy, restoring, onSignUp, onEdit, onRelease, onCancel, onRestore }: SlotRowProps) {
  const record = slot.record;
  const label = formatWeekdayDate(slot.key);
  let chip;
  if (slot.state === 'open') chip = <StatusChip tone="success">Available</StatusChip>;
  else if (slot.state === 'cancelled') chip = <StatusChip tone="quiet">No session</StatusChip>;
  else if (mine) chip = <StatusChip tone="info">Yours</StatusChip>;
  else chip = <StatusChip>Scheduled</StatusChip>;

  return (
    <li id={`slot-${slot.key}`} className={`slot slot--${slot.state}${mine ? ' slot--mine' : ''}${highlight ? ' slot--highlight' : ''}`}>
      <time className="date-badge date-badge--compact" dateTime={slot.key}>
        <span className="date-badge__month">{formatMonthShort(slot.key)}</span>
        <span className="date-badge__day">{formatDay(slot.key)}</span>
      </time>
      <div className="slot__main">
        <p className="slot__when">
          <span className="slot__date">{isToday ? `Today, ${formatLongDate(slot.key).replace(/^\w+, /, '')}` : formatLongDate(slot.key)}</span>
          {chip}
          {slot.holiday && <span className="slot__holiday">{slot.holiday}</span>}
        </p>
        {slot.state === 'claimed' && record ? (
          <>
            <a className="slot__title" href={href(paths.session(slot.key))}>
              {record.name || 'Topic to be announced'}
            </a>
            <PresenterList presenters={record.presenters} size="xs" />
          </>
        ) : slot.state === 'cancelled' ? (
          <p className="meta">No session this week.</p>
        ) : (
          <p className="meta">Open for a presenter.</p>
        )}
      </div>
      <div className="slot__actions">
        {slot.state === 'open' && (
          <>
            <button type="button" className="button button--small" onClick={onSignUp} disabled={!canSignUp}>
              <CalendarAddRegular />
              Sign up<span className="visually-hidden"> for {label}</span>
            </button>
            <button type="button" className="button button--small button--quiet" onClick={onCancel} disabled={busy}>
              No session<span className="visually-hidden"> on {label}</span>
            </button>
          </>
        )}
        {slot.state === 'claimed' && record && (
          <>
            <button type="button" className="button button--small" onClick={() => onEdit(record)} disabled={busy}>
              Edit<span className="visually-hidden"> {label} session</span>
            </button>
            <button type="button" className="button button--small button--quiet" onClick={() => onRelease(record)} disabled={busy}>
              Release<span className="visually-hidden"> {label}</span>
            </button>
            <button type="button" className="button button--small button--quiet" onClick={onCancel} disabled={busy}>
              No session<span className="visually-hidden"> on {label}</span>
            </button>
          </>
        )}
        {slot.state === 'cancelled' && record && (
          <button
            type="button"
            className="button button--small"
            onClick={() => onRestore(record)}
            disabled={busy}
            aria-busy={restoring || undefined}
          >
            {restoring && <Spinner />}
            Restore<span className="visually-hidden"> {label}</span>
          </button>
        )}
      </div>
    </li>
  );
}

interface SignUpPanelProps {
  loading: boolean;
  failed: boolean;
  target: string | undefined;
  isNext: boolean;
  canSignUp: boolean;
  onSignUp: (key: string) => void;
}

/** The page's main call to action: sign up for the next (or requested) open date. */
function SignUpPanel({ loading, failed, target, isNext, canSignUp, onSignUp }: SignUpPanelProps) {
  if (loading) {
    return (
      <LoadingBlock label="Finding the next open date">
        <Skeleton className="skeleton--panel" />
      </LoadingBlock>
    );
  }
  // The date list below shows the load error with a retry.
  if (failed) return null;
  if (!target) {
    return (
      <section className="signup-panel signup-panel--empty" aria-labelledby="signup-heading">
        <h2 id="signup-heading" className="signup-panel__label">
          No open dates right now
        </h2>
        <p className="signup-panel__text">
          Every upcoming {WEEKDAY} is taken. Check back if someone releases a date, or{' '}
          <a href={href(paths.topics)}>vote for topics</a> you’d like to see.
        </p>
      </section>
    );
  }
  return (
    <section className="signup-panel" aria-labelledby="signup-heading">
      <div className="signup-panel__text">
        <h2 id="signup-heading" className="signup-panel__label">
          {isNext ? 'Next open date' : 'Selected date'}
        </h2>
        <p className="signup-panel__date">
          {formatLongDate(target).replace(/, \d{4}$/, '')} · {formatTimeRange(SESSION_TIME.start, SESSION_TIME.end)}
        </p>
      </div>
      <div className="signup-panel__actions">
        <button type="button" className="button button--primary button--large" onClick={() => onSignUp(target)} disabled={!canSignUp}>
          Sign up for {formatDate(target).replace(/, \d{4}$/, '')}
        </button>
        <span className="meta">or pick another date below</span>
      </div>
    </section>
  );
}

function MostRequested({ onPresent, canPresent }: { onPresent: (topicId: string) => void; canPresent: boolean }) {
  const topics = useTopics();
  const top = (topics.data ?? [])
    .filter((t) => t.status === 'open' && !t.sessionRef)
    .sort((a, b) => b.voteCount - a.voteCount || a.createdTime.localeCompare(b.createdTime))
    .slice(0, 5);

  return (
    <div className="side-card">
      <h2 id="requested-heading" className="side-card__title">
        Most requested topics
      </h2>
      {topics.isPending ? (
        <LoadingBlock label="Loading topics">
          <Skeleton className="skeleton--line" />
          <Skeleton className="skeleton--line" />
          <Skeleton className="skeleton--line skeleton--short" />
        </LoadingBlock>
      ) : topics.isError ? (
        <ErrorState compact title="Couldn’t load topics." error={topics.error} onRetry={() => void topics.refetch()} retrying={topics.isFetching} />
      ) : top.length === 0 ? (
        <p className="meta">No open requests yet.</p>
      ) : (
        <ol className="request-list">
          {top.map((t) => (
            <li key={t.itemId}>
              <span className="request-list__name">{t.name}</span>
              <span className="request-list__meta">
                <span className="meta">
                  {t.voteCount} {t.voteCount === 1 ? 'vote' : 'votes'}
                </span>
                <button type="button" className="button button--small button--quiet" onClick={() => onPresent(t.itemId)} disabled={!canPresent}>
                  Present this<span className="visually-hidden">: {t.name}</span>
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <a className="side-card__link" href={href(paths.topics)}>
        See all topic requests
      </a>
    </div>
  );
}
