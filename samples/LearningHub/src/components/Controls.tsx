import { useState, type ReactNode } from 'react';
import { ArrowUpRegular } from '@fluentui/react-icons/headless/svg/arrow-up';
import { PlayRegular } from '@fluentui/react-icons/headless/svg/play';
import { formatDuration, formatDurationLong } from '../lib/time';
import { safeUrl } from '../lib/safeUrl';
import type { Topic } from '../lib/topics';

interface WatchProps {
  url: string | null;
  title: string;
  primary?: boolean;
  small?: boolean;
}

/** Opens the recording in a new tab. Renders nothing unless the link passes safeUrl(). */
export function WatchButton({ url, title, primary, small }: WatchProps) {
  const safe = safeUrl(url);
  if (!safe) return null;
  return (
    <a
      className={`button${primary ? ' button--primary' : ''}${small ? ' button--small' : ''}`}
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
    >
      <PlayRegular />
      Watch recording
      <span className="visually-hidden">
        {' '}
        of {title} (opens in a new tab)
      </span>
    </a>
  );
}

interface VoteProps {
  topic: Topic;
  voted: boolean;
  disabled?: boolean;
  /** Inline pill (arrow and count side by side) for dense lists. */
  compact?: boolean;
  onToggle: () => void;
}

export function VoteButton({ topic, voted, disabled, compact, onToggle }: VoteProps) {
  const [bumps, setBumps] = useState(0);
  return (
    <button
      type="button"
      className={`vote${compact ? ' vote--compact' : ''}${voted ? ' vote--on' : ''}`}
      aria-pressed={voted}
      aria-label={`Vote for ${topic.name}. ${topic.voteCount} ${topic.voteCount === 1 ? 'vote' : 'votes'}`}
      title={voted ? 'Remove your vote' : 'Vote for this topic'}
      disabled={disabled}
      onClick={() => {
        setBumps((b) => b + 1);
        onToggle();
      }}
    >
      <ArrowUpRegular className="vote__icon" />
      <span key={bumps} className={`vote__count${bumps > 0 ? ' vote__count--pop' : ''}`}>
        {topic.voteCount}
      </span>
    </button>
  );
}

type Tone = 'success' | 'info' | 'warning' | 'quiet' | 'plain';

export function StatusChip({ tone = 'plain', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`status status--${tone}`}>{children}</span>;
}

/** Recording length chip ("52 min"); renders nothing when the length is unknown. */
export function Duration({ seconds, className = '' }: { seconds: number | null | undefined; className?: string }) {
  if (!seconds) return null;
  return (
    <span className={`duration ${className}`}>
      <span aria-hidden="true">{formatDuration(seconds)}</span>
      <span className="visually-hidden">{formatDurationLong(seconds)}</span>
    </span>
  );
}
