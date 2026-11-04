/** Format an ISO date as a short relative string (e.g. "3h ago"). */
export function relativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Format an ISO date as a full local datetime. This is what a relative
 * timestamp such as "2h ago" reveals on hover, so it carries the year and the
 * weekday too — enough to pin the moment down without any further arithmetic.
 */
export function absoluteTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Tooltip text for a relative timestamp, or `undefined` when the date is
 * missing or unparseable — so the attribute is dropped rather than rendered
 * empty, which would otherwise mask a tooltip inherited from an ancestor.
 */
export function timeTitle(iso: string | undefined): string | undefined {
  return absoluteTime(iso) || undefined;
}

/** Up-to-two-letter initials from a name/login. */
export function initials(nameOrLogin: string | undefined): string {
  if (!nameOrLogin) return '?';
  const parts = nameOrLogin.replace(/[@]/g, '').trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Deterministic hue (0-359) derived from a seed string via a simple string
 * hash. The same seed always yields the same hue, so a given user keeps a
 * stable avatar color across renders and sessions.
 */
export function avatarHue(seed: string | undefined): number {
  if (!seed) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) | 0;
  }
  return ((hash % 360) + 360) % 360;
}

/**
 * Deterministic background/foreground colors for a generated initials avatar.
 * Fixed saturation and lightness keep white text readable across all hues.
 */
export function avatarColors(seed: string | undefined): { background: string; color: string } {
  return {
    background: `hsl(${avatarHue(seed)}, 55%, 42%)`,
    color: '#fff',
  };
}
