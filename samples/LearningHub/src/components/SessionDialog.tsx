import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/format';
import type { Me } from '../lib/identity';
import type { Presenter } from '../lib/pastSessions';
import {
  buildSlots,
  claimSession,
  ClaimConflictError,
  nextOpenDate,
  SESSION_TIME,
  sessionsKey,
  updateSession,
  type MutationOutcome,
  type Owner,
  type SessionDraft,
  type SessionRecord,
  type Slot,
} from '../lib/sessions';
import { formatDate, formatLongDate, formatTimeRange, formatWeekdayDate, isDateKey, useNow } from '../lib/time';
import { refreshSessionsWhenIdle, sessionMutationKey, useSessionActions } from '../lib/sessionActions';
import { useAppStorage } from '../storage/useAppStorage';
import { useToast } from '../lib/toast';
import { refreshTopicsWhenIdle } from '../lib/topicActions';
import { linkBlocker, type Topic } from '../lib/topics';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { PeoplePicker } from './PeoplePicker';

/** claim: sign up. dit: your own session (date fixed). manage: any session, including its date. */
export type SessionDialogMode = 'claim' | 'edit' | 'manage';

interface SessionDialogProps {
  open: boolean;
  mode: SessionDialogMode;
  onClose: () => void;
  onSaved: (outcome: MutationOutcome, draft: SessionDraft) => void;
  me: Me | undefined;
  slots: Slot[];
  topics: Topic[] | undefined;
  topicsError?: boolean;
  record?: SessionRecord;
  initialDate?: string;
  initialTopicId?: string;
}

const TITLES: Record<SessionDialogMode, string> = {
  claim: 'Sign up to present',
  edit: 'Edit your session',
  manage: 'Edit session',
};

export function SessionDialog(props: SessionDialogProps) {
  const [busy, setBusy] = useState(false);
  const { open, mode, onClose } = props;
  return (
    <Modal open={open} onClose={onClose} title={TITLES[mode]} busy={busy}>
      <SessionForm key={props.record?.itemId ?? 'new'} {...props} onBusyChange={setBusy} busy={busy} />
    </Modal>
  );
}

interface FormProps extends SessionDialogProps {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}

function ownerOf(record: SessionRecord): Presenter | undefined {
  if (!record.ownerId) return undefined;
  return record.presenters.find((p) => p.id === record.ownerId) ?? { id: record.ownerId, name: '' };
}

function SessionForm({
  mode,
  onClose,
  onSaved,
  me,
  slots,
  topics,
  topicsError,
  record: openedWith,
  initialDate,
  initialTopicId,
  busy,
  onBusyChange,
}: FormProps) {
  // The record as it was when the dialog opened: the form starts from it, and a save applies only
  // what the user changed relative to it (see updateSession).
  const [record] = useState(openedWith);
  const client = useQueryClient();
  const storage = useAppStorage();
  const sessionEdits = useSessionActions();
  const toast = useToast();
  const now = useNow();
  // A save can outlive the form (e.g. browser Back closes a route-driven dialog); errors then go to a toast.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const formId = useId();
  const owner: Presenter | undefined =
    mode === 'claim' ? (me ? { id: me.id, name: me.displayName } : undefined) : mode === 'edit' && record ? ownerOf(record) : undefined;

  const requested = record ? undefined : topics?.find((t) => t.itemId === initialTopicId);
  const requestedBlocker = requested ? linkBlocker(requested, initialDate ?? '') : null;
  const initialTopic = record ? topics?.find((t) => t.itemId === record.topicId) : requestedBlocker ? undefined : requested;
  const [date, setDate] = useState(record?.key ?? initialDate ?? '');
  const [topicId, setTopicId] = useState(record?.topicId || initialTopic?.itemId || '');
  const [name, setName] = useState(record?.name ?? initialTopic?.name ?? '');
  const [description, setDescription] = useState(record?.description ?? '');
  const [presenters, setPresenters] = useState<Presenter[]>(() =>
    record ? record.presenters.filter((p) => !owner || p.id !== owner.id) : [],
  );
  const [error, setError] = useState<string | null>(requestedBlocker ? `${requestedBlocker}, so it can’t be linked here.` : null);
  const [conflict, setConflict] = useState<{ message: string; suggestion?: string } | null>(null);

  const openDates = useMemo(() => slots.filter((s) => s.state === 'open'), [slots]);
  const topicOptions = useMemo(
    () =>
      (topics ?? [])
        .filter((t) => linkBlocker(t, date, record?.key) === null || t.itemId === topicId || t.itemId === record?.topicId)
        .sort((a, b) => b.voteCount - a.voteCount || a.name.localeCompare(b.name)),
    [topics, topicId, record?.topicId, record?.key, date],
  );

  const ownerNote = owner && me && owner.id === me.id ? 'you' : 'owner';

  const chooseTopic = (id: string) => {
    const previous = topics?.find((t) => t.itemId === topicId);
    const next = topics?.find((t) => t.itemId === id);
    setTopicId(id);
    if (next && (!name.trim() || name === previous?.name)) setName(next.name);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const title = name.trim();
    if (!isDateKey(date)) return setError('Choose a date.');
    if (!title) return setError('Add a session title.');
    const allPresenters = owner ? [owner, ...presenters] : presenters;
    if (JSON.stringify(allPresenters).length > 3800) return setError('That’s too many presenters to save. Remove a few.');
    const draft: SessionDraft = { key: date, name: title, description: description.trim(), presenters: allPresenters, topicId };

    // Detail-only edits are optimistic: close now, roll back with a message if the save fails.
    // Sign-ups, date moves and topic changes wait for the server (conflict checks, topic guards).
    if (mode !== 'claim' && record && draft.key === record.key && draft.topicId === record.topicId) {
      void sessionEdits.editDetails(record, draft);
      onSaved({}, draft);
      return;
    }

    onBusyChange(true);
    try {
      let outcome: MutationOutcome;
      if (mode === 'claim') {
        if (!owner) throw new Error('Your profile hasn’t loaded yet. Try again in a moment.');
        const claimant: Owner = { id: owner.id, name: owner.name };
        outcome = await claimSession(storage, draft, claimant);
      } else {
        if (!record) throw new Error('This session no longer exists.');
        outcome = await updateSession(storage, record, draft);
      }
      setConflict(null);
      onSaved(outcome, draft);
    } catch (caught) {
      if (!mounted.current) {
        toast({ tone: 'error', message: errorMessage(caught) });
      } else if (caught instanceof ClaimConflictError) {
        if (client.isMutating({ mutationKey: sessionMutationKey }) === 0) {
          client.setQueryData<SessionRecord[]>(sessionsKey, caught.records);
        }
        const suggestion = nextOpenDate(buildSlots(caught.records, now), caught.key);
        setConflict({ message: caught.message, suggestion });
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      onBusyChange(false);
      refreshSessionsWhenIdle(client);
      refreshTopicsWhenIdle(client);
    }
  };

  if (mode === 'claim' && openDates.length === 0 && !date) {
    return (
      <div className="stack">
        <p>There are no open dates right now. Check back later, or request a topic instead.</p>
        <div className="modal__footer">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const dateIsOpen = openDates.some((s) => s.key === date);

  return (
    <form id={formId} className="form" onSubmit={submit} noValidate>
      {mode === 'claim' && (
        <div className="field">
          <label htmlFor={`${formId}-date`}>Date</label>
          <select
            id={`${formId}-date`}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setConflict(null);
            }}
            disabled={busy}
          >
            {!date && <option value="">Choose a date</option>}
            {date && !dateIsOpen && <option value={date}>{formatWeekdayDate(date)} — taken</option>}
            {openDates.map((s) => (
              <option key={s.key} value={s.key}>
                {formatWeekdayDate(s.key)}
                {s.holiday ? ` — ${s.holiday}` : ''}
              </option>
            ))}
          </select>
          <p className="field__hint">{formatTimeRange(SESSION_TIME.start, SESSION_TIME.end)}</p>
        </div>
      )}
      {mode === 'edit' && record && (
        <p className="form__static">
          <strong>{formatLongDate(record.key)}</strong>
          <span className="meta"> · {formatTimeRange(SESSION_TIME.start, SESSION_TIME.end)}</span>
          <br />
          <span className="meta">To change the date, release this one and sign up for another.</span>
        </p>
      )}
      {mode === 'manage' && (
        <div className="field">
          <label htmlFor={`${formId}-date`}>Date</label>
          <input
            id={`${formId}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
            required
          />
          <p className="field__hint">The time stays {formatTimeRange(SESSION_TIME.start, SESSION_TIME.end)}.</p>
        </div>
      )}

      {conflict && (
        <div className="note note--warning" role="alert">
          <p>
            {conflict.message} Your draft is still here.
            {conflict.suggestion ? ` The next open date is ${formatWeekdayDate(conflict.suggestion)}.` : ' There are no other open dates right now.'}
          </p>
          {conflict.suggestion && (
            <button
              type="button"
              className="button button--small"
              onClick={() => {
                setDate(conflict.suggestion as string);
                setConflict(null);
              }}
            >
              Use {formatWeekdayDate(conflict.suggestion)}
            </button>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor={`${formId}-topic`}>Requested topic (optional)</label>
        <select id={`${formId}-topic`} value={topicId} onChange={(e) => chooseTopic(e.target.value)} disabled={busy || !topics}>
          <option value="">None</option>
          {topicOptions.map((t) => (
            <option key={t.itemId} value={t.itemId}>
              {t.name} ({t.voteCount} {t.voteCount === 1 ? 'vote' : 'votes'})
            </option>
          ))}
        </select>
        <p className="field__hint">
          {topicsError
            ? 'Topic requests couldn’t load, so you can’t link one right now.'
            : 'Linking a request marks it as scheduled for this date.'}
        </p>
      </div>

      <div className="field">
        <label htmlFor={`${formId}-name`}>Session title</label>
        <input
          id={`${formId}-name`}
          type="text"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          required
          data-autofocus
        />
      </div>

      <div className="field">
        <label htmlFor={`${formId}-description`}>What will you cover? (optional)</label>
        <textarea
          id={`${formId}-description`}
          rows={4}
          value={description}
          maxLength={4000}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
        />
      </div>

      <PeoplePicker
        label={mode === 'manage' ? 'Presenters' : 'Co-presenters (optional)'}
        fixed={owner ? [{ ...owner, name: owner.name || 'Session owner', note: ownerNote }] : []}
        value={presenters}
        onChange={setPresenters}
        disabled={busy}
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="modal__footer">
        <button type="button" className="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="button button--primary" disabled={busy || (mode === 'claim' && !owner)} aria-busy={busy || undefined}>
          {busy && <Spinner />}
          {busy ? (mode === 'claim' ? 'Signing up…' : 'Saving…') : mode === 'claim' ? `Sign up${isDateKey(date) ? ` for ${formatDate(date).replace(/, \d{4}$/, '')}` : ''}` : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
