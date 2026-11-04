import { useState } from 'react';
import { Avatar } from '../Avatar';
import type { Reviewer, ReviewState } from '../../types';

const VOTE_ICON: Record<ReviewState, string> = {
  APPROVED: '✓',
  CHANGES_REQUESTED: '✗',
  COMMENTED: '⏸',
  DISMISSED: '—',
  PENDING: '⏳',
};

const VOTE_CLASS: Record<ReviewState, string> = {
  APPROVED: 'reviewer--approved',
  CHANGES_REQUESTED: 'reviewer--rejected',
  COMMENTED: 'reviewer--commented',
  DISMISSED: 'reviewer--dismissed',
  PENDING: 'reviewer--pending',
};

/**
 * How many badges stay on the header before the rest collapse behind a "+N".
 *
 * The header is a single flex row where the title block is the leftover space,
 * so an unbounded reviewer list squeezes the title to nothing and its metadata
 * wraps into a tall stack. Capping the row keeps the header one line high no
 * matter how many people are on the review.
 */
export const MAX_VISIBLE_REVIEWERS = 5;

function stateLabel(state: ReviewState): string {
  return state.replace('_', ' ').toLowerCase();
}

function voteLabel(reviewer: Reviewer, headSha?: string): string {
  if (reviewer.source !== 'codeflow') return stateLabel(reviewer.state);
  const stale = headSha && !reviewer.approvedCommitIds?.includes(headSha);
  return `author approved (app only${stale ? ', earlier commit' : ''}); does not count toward GitHub merge requirements`;
}

export function ReviewerList({ reviewers, headSha }: { reviewers: Reviewer[]; headSha?: string }) {
  const [expanded, setExpanded] = useState(false);

  if (reviewers.length === 0) return null;

  const overflowing = reviewers.length > MAX_VISIBLE_REVIEWERS;
  const collapsed = overflowing && !expanded;
  const visible = collapsed ? reviewers.slice(0, MAX_VISIBLE_REVIEWERS) : reviewers;
  const hidden = collapsed ? reviewers.slice(MAX_VISIBLE_REVIEWERS) : [];

  return (
    <div className={`topbar__reviewers ${expanded ? 'topbar__reviewers--expanded' : ''}`}>
      {visible.map((r) => (
        <ReviewerBadge key={`${r.source ?? 'github'}:${r.user.login}`} reviewer={r} headSha={headSha} />
      ))}
      {overflowing && (
        <button
          type="button"
          className="reviewer reviewer--more"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          title={
            collapsed
              ? hidden.map((r) => `${r.user.login}: ${voteLabel(r, headSha)}`).join('\n')
              : 'Show fewer reviewers'
          }
        >
          {collapsed ? `+${hidden.length}` : 'Show fewer'}
        </button>
      )}
    </div>
  );
}

export function ReviewerBadge({ reviewer, headSha }: { reviewer: Reviewer; headSha?: string }) {
  const { user, state } = reviewer;
  const appOnly = reviewer.source === 'codeflow';
  const stale = appOnly && headSha && !reviewer.approvedCommitIds?.includes(headSha);
  return (
    <span className={`reviewer ${VOTE_CLASS[stale ? 'DISMISSED' : state]}`} title={`${user.login}: ${voteLabel(reviewer, headSha)}`}>
      <Avatar user={user} size={20} />
      <span className="reviewer__icon">{VOTE_ICON[state]}</span>
      <span className="reviewer__name">{user.login}</span>
      {appOnly && <span>Author approved (app only{stale ? ', earlier commit' : ''})</span>}
    </span>
  );
}
