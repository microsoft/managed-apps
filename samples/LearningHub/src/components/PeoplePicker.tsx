import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { DismissRegular } from '@fluentui/react-icons/headless/svg/dismiss';
import type { Presenter } from '../lib/pastSessions';
import type { DirectoryUser } from '../connectors/users';
import { usePeopleSearch } from '../lib/people';
import { useDebounced } from '../lib/useDebounced';
import { Avatar } from './Avatar';

interface PeoplePickerProps {
  label: string;
  hint?: string;
  /** People who are always included and can't be removed here (e.g. the owner). */
  fixed?: (Presenter & { note?: string })[];
  value: Presenter[];
  onChange: (value: Presenter[]) => void;
  disabled?: boolean;
}

/** Combobox that searches the directory (via the users adapter) for people. */
export function PeoplePicker({ label, hint, fixed = [], value, onChange, disabled }: PeoplePickerProps) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const term = useDebounced(text, 250);
  const search = usePeopleSearch(term);
  const inputId = useId();
  const listId = useId();
  const hintId = useId();

  const taken = new Set([...fixed, ...value].map((p) => p.id).filter(Boolean));
  const options: DirectoryUser[] = (search.data ?? []).filter((p) => !taken.has(p.id));
  const typing = text.trim().length >= 2;
  const settled = term.trim() === text.trim();
  const showList = open && typing;
  const active = Math.min(activeIndex, Math.max(0, options.length - 1));

  const add = (person: DirectoryUser) => {
    onChange([...value, { id: person.id, name: person.displayName }]);
    setText('');
    setActiveIndex(0);
  };

  const remove = (person: Presenter) => onChange(value.filter((p) => p !== person));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(options.length ? (active + 1) % options.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(options.length ? (active - 1 + options.length) % options.length : 0);
    } else if (event.key === 'Enter') {
      if (showList && options[active]) {
        event.preventDefault();
        add(options[active]);
      } else if (showList) {
        event.preventDefault();
      }
    } else if (event.key === 'Escape') {
      if (showList) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    } else if (event.key === 'Backspace' && text === '' && value.length > 0) {
      remove(value[value.length - 1]);
    }
  };

  let status: string;
  if (!typing) status = '';
  else if (!settled || search.isFetching) status = 'Searching…';
  else if (search.isError) status = 'Couldn’t search people.';
  else if (options.length === 0) status = 'No matching people.';
  else status = `${options.length} ${options.length === 1 ? 'person' : 'people'} found.`;

  const activeId = showList && options[active] ? `${listId}-${active}` : undefined;
  const listRef = useRef<HTMLUListElement>(null);
  const resultsShown = showList && settled && !search.isFetching && options.length > 0;

  // In a scrolling dialog the results can open below the fold: bring them into view, and keep the
  // keyboard-highlighted option visible inside the list.
  useEffect(() => {
    if (resultsShown) listRef.current?.scrollIntoView({ block: 'nearest' });
  }, [resultsShown]);
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  return (
    <div className="field people-picker">
      <label htmlFor={inputId}>{label}</label>
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {(fixed.length > 0 || value.length > 0) && (
        <ul className="chips" aria-label="Presenters">
          {fixed.map((p) => (
            <li key={p.id || p.name} className="chip">
              <Avatar userId={p.id} name={p.name} size="xs" />
              <span>
                {p.name}
                {p.note && <span className="chip__note"> · {p.note}</span>}
              </span>
            </li>
          ))}
          {value.map((p) => (
            <li key={p.id || p.name} className="chip">
              <Avatar userId={p.id} name={p.name} size="xs" />
              <span>{p.name}</span>
              <button
                type="button"
                className="chip__remove"
                aria-label={`Remove ${p.name}`}
                onClick={() => remove(p)}
                disabled={disabled}
              >
                <DismissRegular />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="combobox">
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-describedby={hint ? hintId : undefined}
          placeholder="Search by name or email"
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <ul ref={listRef} id={listId} role="listbox" aria-label="People" className="listbox" hidden={!showList}>
          {showList && settled && !search.isFetching && options.map((person, index) => (
            <li
              key={person.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className="listbox__option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(person)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <Avatar userId={person.id} name={person.displayName} size="xs" noPhoto />
              <span className="listbox__text">
                <span className="listbox__name">{person.displayName}</span>
                <span className="listbox__meta">{[person.jobTitle, person.mail].filter(Boolean).join(' · ')}</span>
              </span>
            </li>
          ))}
        </ul>
        {showList && status && (!options.length || !settled || search.isFetching || search.isError) && (
          <div className="listbox listbox--status">
            <span>{status}</span>
            {search.isError && settled && (
              <button
                type="button"
                className="button button--small"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void search.refetch()}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
