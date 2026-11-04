import { useEffect, useState } from "react";

// Ticking clock so the relative time ages on its own between refreshes.
// The interval is cleared on unmount.
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
