import { useEffect, useState } from 'react';
import { useCodeFlow } from '../../state/useCodeFlow';
import { useSettings } from '../../settings/useSettings';
import { formatCountdown } from './formatCountdown';

/**
 * Countdown to the next automatic poll, doubling as a manual refresh button —
 * the PR view polls in the background, and reviewers deserve to know when.
 */
export function RefreshTimer() {
  const { actions, lastRefreshAt } = useCodeFlow();
  const intervalSeconds = useSettings().settings.refreshIntervalSeconds;
  const polling = intervalSeconds > 0;
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [polling]);

  const refresh = async () => {
    setBusy(true);
    try {
      await actions.refreshNow();
      setNow(Date.now());
    } finally {
      setBusy(false);
    }
  };

  const remaining =
    polling && lastRefreshAt != null
      ? Math.max(0, (lastRefreshAt + intervalSeconds * 1000 - now) / 1000)
      : null;

  const label = busy
    ? '↻ …'
    : remaining == null
      ? '↻ Refresh'
      : `↻ ${formatCountdown(remaining)}`;

  return (
    <button
      className="topbar__refresh"
      onClick={() => void refresh()}
      disabled={busy}
      title={
        polling
          ? `Comments and votes refresh every ${formatCountdown(intervalSeconds)} — click to refresh now`
          : 'Auto-refresh is off — click to refresh comments and votes'
      }
      aria-label="Refresh now"
    >
      {label}
    </button>
  );
}
