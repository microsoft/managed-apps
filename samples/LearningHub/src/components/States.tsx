import type { ReactNode } from 'react';
import { ArrowClockwiseRegular } from '@fluentui/react-icons/headless/svg/arrow-clockwise';
import { ErrorCircleRegular } from '@fluentui/react-icons/headless/svg/error-circle';
import { errorMessage } from '../lib/format';

export function Skeleton({ className = '', label }: { className?: string; label?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden={label ? undefined : true} aria-label={label} />;
}

/** A labelled loading block for screen readers plus shimmer placeholders. */
export function LoadingBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="loading-block" role="status" aria-label={label} aria-busy="true">
      {children}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
}

export function ErrorState({ title, error, onRetry, retrying, compact }: ErrorStateProps) {
  return (
    <div className={`state state--error${compact ? ' state--compact' : ''}`} role="alert">
      <ErrorCircleRegular className="state__icon" />
      <div className="state__text">
        <p className="state__title">{title}</p>
        {error !== undefined && <p className="state__detail">{errorMessage(error)}</p>}
      </div>
      {onRetry && (
        <button type="button" className="button button--small" onClick={onRetry} disabled={retrying}>
          <ArrowClockwiseRegular />
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state state--empty">
      <div className="state__text">
        <p className="state__title">{title}</p>
        {children && <div className="state__detail">{children}</div>}
      </div>
      {action}
    </div>
  );
}
