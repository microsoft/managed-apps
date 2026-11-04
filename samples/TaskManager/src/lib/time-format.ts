// Refresh status-line formatters.
export function formatRefreshTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

// "2 minutes ago" / "1 hour ago" — paired with the exact clock time so the
// status shows both. `now` is passed in so the caller's ticking clock drives
// re-renders (the value itself always derives from the real fetch timestamp).
export function formatRelativeTime(epochMs: number, now: number): string {
  const secs = Math.max(0, Math.round((now - epochMs) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
