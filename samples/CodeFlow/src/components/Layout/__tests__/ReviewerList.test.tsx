import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewerList, MAX_VISIBLE_REVIEWERS } from '../ReviewerList';
import type { Reviewer } from '../../../types';

function reviewers(n: number): Reviewer[] {
  return Array.from({ length: n }, (_, i) => ({
    user: { login: `dev${i + 1}` },
    state: 'COMMENTED' as const,
  }));
}

describe('ReviewerList', () => {
  const author: Reviewer = {
    user: { login: 'alice' }, state: 'APPROVED', source: 'codeflow',
    commitId: 'first', approvedCommitIds: ['first'],
  };

  it('explicitly distinguishes app-only author approval from GitHub reviews', () => {
    render(<ReviewerList reviewers={[author]} headSha="first" />);
    expect(screen.getByText('Author approved (app only)')).toBeInTheDocument();
    expect(screen.getByTitle(/does not count toward GitHub merge requirements/))
      .toHaveClass('reviewer--approved');
  });

  it('marks author approval stale when the current head was never approved', () => {
    render(<ReviewerList reviewers={[author]} headSha="second" />);
    expect(screen.getByText('Author approved (app only, earlier commit)')).toBeInTheDocument();
    expect(screen.getByTitle(/does not count toward GitHub merge requirements/))
      .toHaveClass('reviewer--dismissed');
  });

  it('names app-only status even when the author badge is collapsed', () => {
    render(<ReviewerList reviewers={[...reviewers(MAX_VISIBLE_REVIEWERS), author]} headSha="first" />);
    expect(screen.getByRole('button', { name: '+1' })).toHaveAttribute(
      'title', 'alice: author approved (app only); does not count toward GitHub merge requirements',
    );
  });

  it('renders nothing when there are no reviewers', () => {
    const { container } = render(<ReviewerList reviewers={[]} />);
    expect(container.querySelector('.topbar__reviewers')).toBeNull();
  });

  it('shows every reviewer when the list fits', () => {
    render(<ReviewerList reviewers={reviewers(MAX_VISIBLE_REVIEWERS)} />);
    expect(screen.getAllByText(/^dev\d+$/)).toHaveLength(MAX_VISIBLE_REVIEWERS);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('collapses the overflow behind a +N chip', () => {
    render(<ReviewerList reviewers={reviewers(MAX_VISIBLE_REVIEWERS + 3)} />);
    expect(screen.getAllByText(/^dev\d+$/)).toHaveLength(MAX_VISIBLE_REVIEWERS);
    expect(screen.getByRole('button', { name: '+3' })).toBeTruthy();
  });

  it('names the hidden reviewers and their votes in the chip tooltip', () => {
    const list = reviewers(MAX_VISIBLE_REVIEWERS + 1);
    list[MAX_VISIBLE_REVIEWERS] = { user: { login: 'lucy' }, state: 'CHANGES_REQUESTED' };
    render(<ReviewerList reviewers={list} />);
    expect(screen.getByRole('button', { name: '+1' }).getAttribute('title')).toBe(
      'lucy: changes requested',
    );
  });

  it('expands to the full list and back on click', () => {
    render(<ReviewerList reviewers={reviewers(MAX_VISIBLE_REVIEWERS + 4)} />);
    const chip = screen.getByRole('button', { name: '+4' });
    expect(chip.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(chip);
    expect(screen.getAllByText(/^dev\d+$/)).toHaveLength(MAX_VISIBLE_REVIEWERS + 4);

    const collapse = screen.getByRole('button', { name: 'Show fewer' });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(collapse);
    expect(screen.getAllByText(/^dev\d+$/)).toHaveLength(MAX_VISIBLE_REVIEWERS);
  });

  it('only allows the reviewer row to wrap once it is expanded', () => {
    const { container } = render(<ReviewerList reviewers={reviewers(MAX_VISIBLE_REVIEWERS + 2)} />);
    const row = container.querySelector('.topbar__reviewers')!;
    expect(row.className).not.toContain('topbar__reviewers--expanded');

    fireEvent.click(screen.getByRole('button', { name: '+2' }));
    expect(row.className).toContain('topbar__reviewers--expanded');
  });

  it('renders the vote icon for each review state', () => {
    render(
      <ReviewerList
        reviewers={[
          { user: { login: 'a' }, state: 'APPROVED' },
          { user: { login: 'b' }, state: 'CHANGES_REQUESTED' },
          { user: { login: 'c' }, state: 'DISMISSED' },
        ]}
      />,
    );
    expect(screen.getByText('✓')).toBeTruthy();
    expect(screen.getByText('✗')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });
});
