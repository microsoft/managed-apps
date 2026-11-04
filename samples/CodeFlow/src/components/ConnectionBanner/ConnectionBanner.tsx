import type { ConnectionFaultKind } from '../../services/connectionHealth';

interface Props {
  kind: ConnectionFaultKind;
  onRetry?: () => void;
}

/**
 * Explains a connection that has stopped authenticating.
 *
 * This exists because the failure is otherwise deeply misleading. GitHub
 * answers an uncredentialed request with a rate-limit error, so the reviewer
 * sees "API rate limit exceeded" and reasonably concludes they are being
 * throttled for using the app too hard — when in fact they are the only person
 * *not* signed in, and are sharing a 60-requests-an-hour anonymous pool with
 * every other anonymous caller on the gateway.
 *
 * It does not offer a self-service link: the host's connection repair flow is
 * not callable from app code (see `connectionHealth.ts`).
 */
export function ConnectionBanner({ kind, onRetry }: Props) {
  const unauthenticated = kind === 'unauthenticated';

  return (
    <aside className="connban" role="alert" aria-label="GitHub connection problem">
      <span className="connban__icon" aria-hidden="true">
        ⚠️
      </span>
      <div className="connban__text">
        <strong className="connban__title">
          {unauthenticated
            ? 'CodeFlow cannot sign in to GitHub as you'
            : "You've hit GitHub's rate limit"}
        </strong>
        <span className="connban__sub">
          {unauthenticated
            ? `Requests are reaching GitHub without your credentials, so GitHub treats CodeFlow as an anonymous caller and cuts it off after 60 requests an hour — a pool shared with everyone else on the gateway. This is not a limit on you, and it will not clear on its own: the GitHub connection this app uses has stopped authenticating. Reconnect or recreate it in your environment's connections (or re-run the GitHub connector setup step), then retry.`
            : `Your quota will reset shortly. CodeFlow has paused automatic refreshes until then.`}
        </span>
      </div>
      {onRetry && (
        <button className="btn btn--sm connban__retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </aside>
  );
}
