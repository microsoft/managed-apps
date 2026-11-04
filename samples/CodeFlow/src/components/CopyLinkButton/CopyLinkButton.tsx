import { useState } from 'react';
import { copyToClipboard, copyRichLink } from '../../utils/deepLink';

interface Props {
  /** Deep link to copy. The button is disabled while this is empty. */
  link: string;
  title?: string;
  /** Glyph shown while idle. Defaults to a link icon. */
  label?: string;
  /** PR number — when provided together with `prTitle`, copies a rich ADO-style link. */
  prNumber?: number;
  /** PR title — when provided together with `prNumber`, copies a rich ADO-style link. */
  prTitle?: string;
}

/** Copies a deep link to the clipboard, with transient success/failure feedback. */
export function CopyLinkButton({ link, title, label = '🔗', prNumber, prTitle }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!link) return;
    const ok =
      prNumber !== undefined && prTitle !== undefined
        ? await copyRichLink(link, `Pull Request ${prNumber}: ${prTitle}`)
        : await copyToClipboard(link);
    setState(ok ? 'copied' : 'failed');
    setTimeout(() => setState('idle'), 2500);
  };

  const glyph = state === 'copied' ? '✓ Copied' : state === 'failed' ? '⚠ Failed' : label;
  const modifier =
    state === 'copied'
      ? ' copy-link-btn--copied'
      : state === 'failed'
        ? ' copy-link-btn--failed'
        : '';

  return (
    <button
      className={`copy-link-btn${modifier}`}
      title={title ?? 'Copy deep link'}
      aria-label={title ?? 'Copy deep link'}
      disabled={!link}
      onClick={(e) => void handleClick(e)}
    >
      {glyph}
    </button>
  );
}
