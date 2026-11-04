import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { MarkdownBody } from '../MarkdownBody/MarkdownBody';
import { Avatar } from '../Avatar';
import type { GitUserRef } from '../../types';
import { useMentionSource } from './mentionContext';
import {
  findMentionQuery,
  filterCandidates,
  applyMention,
  mergeUsers,
  type MentionQuery,
} from './mentions';

interface MarkdownToolbarProps {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  onKeyDown?(e: React.KeyboardEvent<HTMLTextAreaElement>): void;
  /** Original source line for the code suggestion button. */
  originalLine?: string;
}

interface ToolbarAction {
  icon: string;
  title: string;
  action: (textarea: HTMLTextAreaElement, value: string) => string;
}

function wrapSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  before: string,
  after: string,
  placeholder: string,
): string {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end) || placeholder;
  return value.slice(0, start) + before + selected + after + value.slice(end);
}

function prefixLine(
  textarea: HTMLTextAreaElement,
  value: string,
  prefix: string,
): string {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  // Find the start of the current line
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', end);
  const actualEnd = lineEnd === -1 ? value.length : lineEnd;
  const lines = value.slice(lineStart, actualEnd).split('\n');
  const prefixed = lines.map((l) => prefix + l).join('\n');
  return value.slice(0, lineStart) + prefixed + value.slice(actualEnd);
}

const ACTIONS: ToolbarAction[] = [
  {
    icon: 'H',
    title: 'Heading (Ctrl+Shift+H)',
    action: (ta, v) => {
      const start = ta.selectionStart;
      const lineStart = v.lastIndexOf('\n', start - 1) + 1;
      return v.slice(0, lineStart) + '### ' + v.slice(lineStart);
    },
  },
  {
    icon: 'B',
    title: 'Bold (Ctrl+B)',
    action: (ta, v) => wrapSelection(ta, v, '**', '**', 'bold text'),
  },
  {
    icon: 'I',
    title: 'Italic (Ctrl+I)',
    action: (ta, v) => wrapSelection(ta, v, '_', '_', 'italic text'),
  },
  {
    icon: '❝',
    title: 'Quote',
    action: (ta, v) => prefixLine(ta, v, '> '),
  },
  {
    icon: '<>',
    title: 'Code (Ctrl+E)',
    action: (ta, v) => {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = v.slice(start, end);
      // If multiline, use fenced block
      if (selected.includes('\n')) {
        return v.slice(0, start) + '```\n' + selected + '\n```' + v.slice(end);
      }
      return wrapSelection(ta, v, '`', '`', 'code');
    },
  },
  {
    icon: '🔗',
    title: 'Link (Ctrl+K)',
    action: (ta, v) => wrapSelection(ta, v, '[', '](url)', 'link text'),
  },
  {
    icon: '•',
    title: 'Unordered list',
    action: (ta, v) => prefixLine(ta, v, '- '),
  },
  {
    icon: '1.',
    title: 'Ordered list',
    action: (ta, v) => prefixLine(ta, v, '1. '),
  },
  {
    icon: '☑',
    title: 'Task list',
    action: (ta, v) => prefixLine(ta, v, '- [ ] '),
  },
];

export function MarkdownToolbar({
  value,
  onChange,
  placeholder,
  rows = 3,
  autoFocus,
  onKeyDown,
  originalLine,
}: MarkdownToolbarProps) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // @mention autocomplete
  const { candidates: mentionCandidates, search: searchMentions } = useMentionSource();
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Live enterprise-wide results, merged on top of the local candidate pool so
  // people outside the repo's collaborators surface as the user keeps typing.
  const [remoteMatches, setRemoteMatches] = useState<GitUserRef[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);

  const pool = useMemo(
    () =>
      remoteMatches.length > 0
        ? mergeUsers(mentionCandidates, remoteMatches)
        : mentionCandidates,
    [mentionCandidates, remoteMatches],
  );
  const matches = mention ? filterCandidates(pool, mention.query) : [];
  const mentionOpen = mention !== null && matches.length > 0;

  /** Fire a debounced enterprise-wide user search for the active token. */
  const scheduleSearch = useCallback(
    (next: MentionQuery | null) => {
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
      const query = next?.query.trim() ?? '';
      if (!searchMentions || query.length < 1) {
        setRemoteMatches([]);
        return;
      }
      const seq = ++searchSeq.current;
      searchTimer.current = setTimeout(() => {
        void searchMentions(query)
          .then((users) => {
            // Ignore stale responses from earlier keystrokes.
            if (seq === searchSeq.current) setRemoteMatches(users);
          })
          .catch(() => {
            /* live search is best-effort; keep the local list */
          });
      }, 200);
    },
    [searchMentions],
  );

  // Cancel any pending search when the editor unmounts.
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  /** Recompute the active mention token from the textarea's current caret. */
  const refreshMention = useCallback(
    (text: string, caret: number) => {
      const next = findMentionQuery(text, caret);
      setMention(next);
      setActiveIndex(0);
      scheduleSearch(next);
    },
    [scheduleSearch],
  );

  /** Insert the chosen user's handle, replacing the in-progress token. */
  const acceptMention = useCallback(
    (login: string) => {
      const ta = textareaRef.current;
      if (!mention || !ta) return;
      const { text, caret } = applyMention(value, mention, login);
      onChange(text);
      setMention(null);
      setRemoteMatches([]);
      searchSeq.current += 1;
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }, 0);
    },
    [mention, value, onChange],
  );

  const handleAction = useCallback(
    (action: ToolbarAction) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const updated = action.action(ta, value);
      onChange(updated);
      // Restore focus
      setTimeout(() => ta.focus(), 0);
    },
    [value, onChange],
  );

  const insertSuggestion = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const line = originalLine ?? '';
    const suggestion = '```suggestion\n' + line + '\n```\n';
    const start = ta.selectionStart;
    const updated = value.slice(0, start) + suggestion + value.slice(start);
    onChange(updated);
    setTimeout(() => ta.focus(), 0);
  }, [value, onChange, originalLine]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When the mention picker is open, capture navigation keys so they drive the
    // dropdown instead of the textarea or the parent (submit/cancel) handler.
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        acceptMention(matches[activeIndex].login);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    // Keyboard shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b') {
        e.preventDefault();
        handleAction(ACTIONS[1]); // Bold
      } else if (e.key === 'i') {
        e.preventDefault();
        handleAction(ACTIONS[2]); // Italic
      } else if (e.key === 'e') {
        e.preventDefault();
        handleAction(ACTIONS[4]); // Code
      } else if (e.key === 'k') {
        e.preventDefault();
        handleAction(ACTIONS[5]); // Link
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="md-editor-wrap">
      <div className="md-editor">
        <div className="md-editor__toolbar">
          <div className="md-editor__tabs">
            <button
              className={`md-editor__tab${mode === 'write' ? ' md-editor__tab--active' : ''}`}
              onClick={() => setMode('write')}
              type="button"
            >
              Write
            </button>
            <button
              className={`md-editor__tab${mode === 'preview' ? ' md-editor__tab--active' : ''}`}
              onClick={() => setMode('preview')}
              type="button"
            >
              Preview
            </button>
          </div>
          {mode === 'write' && (
            <div className="md-editor__actions">
              {ACTIONS.map((a) => (
                <button
                  key={a.title}
                  className="md-editor__btn"
                  title={a.title}
                  onClick={() => handleAction(a)}
                  type="button"
                >
                  {a.icon}
                </button>
              ))}
              {originalLine !== undefined && (
                <button
                  className="md-editor__btn md-editor__btn--suggestion"
                  title="Code suggestion"
                  onClick={insertSuggestion}
                  type="button"
                >
                  ±
                </button>
              )}
            </div>
          )}
        </div>

        {mode === 'write' ? (
          <textarea
            ref={textareaRef}
            className="thread__input md-editor__textarea"
            placeholder={placeholder}
            value={value}
            rows={rows}
            autoFocus={autoFocus}
            onChange={(e) => {
              onChange(e.target.value);
              refreshMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyUp={(e) => {
              // Skip while navigating the open dropdown (handled in keydown).
              if (
                mentionOpen &&
                ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)
              ) {
                return;
              }
              refreshMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
            }}
            onClick={(e) =>
              refreshMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
            }
            onBlur={() => setTimeout(() => setMention(null), 100)}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <div className="md-editor__preview">
            {value.trim() ? (
              <MarkdownBody content={value} className="comment__text" />
            ) : (
              <p className="md-editor__empty">Nothing to preview</p>
            )}
          </div>
        )}
      </div>

      {mode === 'write' && mentionOpen && (
        <ul className="md-mention" role="listbox" aria-label="Mention a user">
          {matches.map((m, i) => (
            <li
              key={m.login}
              role="option"
              aria-selected={i === activeIndex}
              className={`md-mention__item${i === activeIndex ? ' md-mention__item--active' : ''}`}
              // Use mousedown + preventDefault so the textarea keeps focus.
              onMouseDown={(e) => {
                e.preventDefault();
                acceptMention(m.login);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <Avatar user={m} size={20} />
              <span className="md-mention__login">{m.login}</span>
              {m.name && <span className="md-mention__name">{m.name}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
