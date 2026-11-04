/**
 * Whether the reader has asked their OS to keep animation to a minimum.
 *
 * Kept next to the other host-preference probes rather than inlined at the call
 * site: the same three guards (no window, no `matchMedia`, an engine that throws
 * on an unknown query) apply everywhere. All three mean "the host never told us
 * either way", which is not the same as asking for less motion, so they answer
 * `false` and leave the decision to whatever the feature does by default.
 */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}
