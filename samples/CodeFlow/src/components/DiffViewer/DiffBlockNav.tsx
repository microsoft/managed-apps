import type { DiffBlockNav as Nav } from './useDiffBlockNav';

/**
 * Previous/Next controls that jump between change blocks in the diff, rolling
 * over into the neighbouring changed file at either end.
 */
export function DiffBlockNav({ nav }: { nav: Nav }) {
  const label = nav.total === 0 ? '0' : `${nav.ordinal ?? '–'}/${nav.total}`;
  return (
    <div className="diff__blocknav" role="group" aria-label="Change navigation">
      <button
        type="button"
        className="btn btn--sm diff__blocknav-btn"
        title="Previous change (Alt+↑)"
        aria-label="Previous change"
        disabled={!nav.canPrev}
        onClick={nav.prev}
      >
        ↑
      </button>
      <span
        className="diff__blocknav-count"
        title={`${nav.total} change block${nav.total === 1 ? '' : 's'} in this file`}
        aria-live="polite"
      >
        {label}
      </span>
      <button
        type="button"
        className="btn btn--sm diff__blocknav-btn"
        title="Next change (Alt+↓)"
        aria-label="Next change"
        disabled={!nav.canNext}
        onClick={nav.next}
      >
        ↓
      </button>
    </div>
  );
}
