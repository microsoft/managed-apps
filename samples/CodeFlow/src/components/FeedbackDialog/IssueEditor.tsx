import { useEffect, useRef, useState } from 'react';
import { BODY_MAX_LENGTH, TITLE_MAX_LENGTH } from '../../services/issues/issueStore';
import type { IssueDraft, IssueKind } from '../../types';

const KIND_OPTIONS: readonly { value: IssueKind; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'question', label: 'Question' },
];

const EMPTY_DRAFT: IssueDraft = { title: '', body: '', kind: 'bug' };

export interface IssueEditorProps {
  /** Pre-filled when editing; omitted when raising something new. */
  initial?: IssueDraft;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (draft: IssueDraft) => void;
  onCancel: () => void;
}

/**
 * The create/edit form. Deliberately plain markdown in a textarea rather than
 * the review editor: feedback is written once, and the toolbar's mention support
 * needs PR context this panel doesn't have.
 */
export function IssueEditor({ initial, submitLabel, busy, onSubmit, onCancel }: IssueEditorProps) {
  const [draft, setDraft] = useState<IssueDraft>(initial ?? EMPTY_DRAFT);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const canSubmit = draft.title.trim().length > 0 && !busy;

  return (
    <form
      className="issue-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(draft);
      }}
    >
      <div className="issue-editor__row">
        <input
          ref={titleRef}
          className="issue-editor__title"
          placeholder="Title — what happened, or what would help?"
          aria-label="Issue title"
          maxLength={TITLE_MAX_LENGTH}
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
        <select
          className="issue-editor__kind"
          aria-label="Issue type"
          value={draft.kind}
          onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as IssueKind }))}
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="issue-editor__body"
        placeholder="Description — markdown welcome. Steps to reproduce help a lot for bugs."
        aria-label="Issue description"
        maxLength={BODY_MAX_LENGTH}
        rows={6}
        value={draft.body}
        onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
      />
      {/* Screenshots would live here, once storage supports attachments. */}
      <div className="issue-editor__actions">
        <button type="submit" className="btn btn--sm btn--primary" disabled={!canSubmit}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="btn btn--sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
