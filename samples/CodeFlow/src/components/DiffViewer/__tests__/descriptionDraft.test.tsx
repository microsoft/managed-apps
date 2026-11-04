import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DescriptionView } from '../DescriptionView';
import type { CommentThread } from '../../../types';

/**
 * The PR-level comment box is the one the bug report was written about. It is
 * also the hardest case, because the box itself is hidden until asked for: a
 * restored draft is worth nothing if the composer it lives in stays closed.
 */

const addIssueComment = vi.fn(async () => {});

const ctx = {
  pr: { title: 'Some PR', body: 'body text', coordinates: { owner: 'o', name: 'r', number: 1 } },
  prKey: 'o/r#1',
  comparison: { files: [] as { filename: string }[] },
  threads: [] as CommentThread[],
  commentBackendLabel: 'GitHub',
  currentUser: { login: 'alice' },
  actions: { addIssueComment },
};

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ctx,
  useFileThreads: () => [],
}));

const PLACEHOLDER = 'Leave a comment on this pull request…';
const box = () => screen.queryByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement | null;

beforeEach(() => {
  addIssueComment.mockClear();
  addIssueComment.mockResolvedValue(undefined);
});

describe('the pull request comment box across a refresh', () => {
  it('stays shut when there is nothing part-written', () => {
    render(<DescriptionView />);
    expect(box()).toBeNull();
  });

  it('reopens itself holding the comment that was being written', () => {
    const view = render(<DescriptionView />);
    fireEvent.click(screen.getByRole('button', { name: '+ Comment' }));
    fireEvent.change(box()!, { target: { value: 'a considered opinion' } });

    // The refresh: the review tree goes away and comes back.
    view.unmount();
    render(<DescriptionView />);

    expect(box()).not.toBeNull();
    expect(box()!.value).toBe('a considered opinion');
  });

  it('stays shut again once the comment has been posted', async () => {
    const view = render(<DescriptionView />);
    fireEvent.click(screen.getByRole('button', { name: '+ Comment' }));
    fireEvent.change(box()!, { target: { value: 'posting this one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(addIssueComment).toHaveBeenCalledWith('posting this one'));

    view.unmount();
    render(<DescriptionView />);
    expect(box()).toBeNull();
  });

  it('stays shut when the reviewer changed their mind and cancelled', () => {
    const view = render(<DescriptionView />);
    fireEvent.click(screen.getByRole('button', { name: '+ Comment' }));
    fireEvent.change(box()!, { target: { value: 'actually, no' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    view.unmount();
    render(<DescriptionView />);
    expect(box()).toBeNull();
  });
});
