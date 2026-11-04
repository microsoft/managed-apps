const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Inline busy indicator for buttons waiting on the server. Self-animating SVG, so it needs no
 * stylesheet; it holds still when the user prefers reduced motion.
 */
export function Spinner() {
  const still = reducedMotion();
  return (
    <svg viewBox="0 0 20 20" width="1em" height="1em" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {!still && (
          <animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur="0.8s" repeatCount="indefinite" />
        )}
      </path>
    </svg>
  );
}
