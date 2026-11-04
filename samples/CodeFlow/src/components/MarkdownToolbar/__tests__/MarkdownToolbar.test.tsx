import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MarkdownToolbar } from '../MarkdownToolbar';
import { MentionContext } from '../mentionContext';
import type { GitUserRef } from '../../../types';

const CANDIDATES: GitUserRef[] = [
  { login: 'octocat', name: 'The Octocat' },
  { login: 'octodog' },
  { login: 'alice' },
];

/** Controlled harness so the toolbar's value prop tracks edits. */
function Harness({
  onValue,
  search,
}: {
  onValue?: (v: string) => void;
  search?: (q: string) => Promise<GitUserRef[]>;
}) {
  const [value, setValue] = useState('');
  return (
    <MentionContext.Provider value={{ candidates: CANDIDATES, search }}>
      <MarkdownToolbar
        value={value}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
        placeholder="comment"
      />
    </MentionContext.Provider>
  );
}

/** Simulate typing text with the caret at its end. */
function type(textarea: HTMLTextAreaElement, text: string) {
  fireEvent.change(textarea, { target: { value: text, selectionStart: text.length } });
}

describe('MarkdownToolbar @mention autocomplete', () => {
  it('shows matching users after typing @', () => {
    render(<Harness />);
    const ta = screen.getByPlaceholderText('comment') as HTMLTextAreaElement;
    type(ta, '@oc');

    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeTruthy();
    expect(screen.getByText('octocat')).toBeTruthy();
    expect(screen.getByText('octodog')).toBeTruthy();
    expect(screen.queryByText('alice')).toBeNull();
  });

  it('does not open the picker for an email-like token', () => {
    render(<Harness />);
    const ta = screen.getByPlaceholderText('comment') as HTMLTextAreaElement;
    type(ta, 'ping me at bob@oc');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('inserts the handle when an option is clicked', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const ta = screen.getByPlaceholderText('comment') as HTMLTextAreaElement;
    type(ta, 'hey @oc');

    fireEvent.mouseDown(screen.getByText('octocat'));
    expect(onValue).toHaveBeenLastCalledWith('hey @octocat ');
  });

  it('inserts the active option on Enter', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const ta = screen.getByPlaceholderText('comment') as HTMLTextAreaElement;
    type(ta, '@oc');

    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onValue).toHaveBeenLastCalledWith('@octocat ');
  });

  it('closes the picker on Escape without inserting', () => {
    render(<Harness />);
    const ta = screen.getByPlaceholderText('comment') as HTMLTextAreaElement;
    type(ta, '@oc');
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('merges live enterprise search results while typing', async () => {
    vi.useFakeTimers();
    try {
      const search = vi.fn(
        async (): Promise<GitUserRef[]> => [{ login: 'monaoctocat', name: 'Mona Octocat' }],
      );
      render(<Harness search={search} />);
      const ta = screen.getByPlaceholderText('comment') as HTMLTextAreaElement;
      // No local candidate matches "mon", so any hit must come from live search.
      type(ta, '@mon');
      expect(screen.queryByRole('listbox')).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(search).toHaveBeenCalledWith('mon');
      expect(screen.getByText('monaoctocat')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not run live search until a query is typed', () => {
    vi.useFakeTimers();
    try {
      const search = vi.fn(async (): Promise<GitUserRef[]> => []);
      render(<Harness search={search} />);
      const ta = screen.getByPlaceholderText('comment') as HTMLTextAreaElement;
      type(ta, '@');
      vi.advanceTimersByTime(250);
      expect(search).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
