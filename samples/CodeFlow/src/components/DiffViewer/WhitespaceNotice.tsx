/**
 * Tells the reviewer when the diff they are looking at is hiding something.
 *
 * Hiding whitespace-only changes is on by default, which means the app is
 * quietly withholding real changes — a line-ending flip is a genuine edit that
 * can break a shell script and will show up in blame. Silently hiding it would
 * be worse than the noisy diff it replaces, so whenever anything is actually
 * folded away the viewer says so, gives the true counts, and offers a one-click
 * way back to the unabridged diff.
 */
export function WhitespaceNotice({
  hidden,
  rawAdditions,
  rawDeletions,
  wholeFile,
  onShow,
}: {
  /** Number of whitespace-only lines folded away. Never rendered when 0. */
  hidden: number;
  rawAdditions: number;
  rawDeletions: number;
  /** True when essentially the whole file was rewritten this way. */
  wholeFile: boolean;
  onShow: () => void;
}) {
  if (hidden <= 0) return null;

  const lines = hidden === 1 ? '1 line' : `${hidden} lines`;

  return (
    <div className="diff__wsnotice" role="status">
      <span className="diff__wsnotice-icon" aria-hidden="true">
        ¶
      </span>
      <span className="diff__wsnotice-text">
        {wholeFile ? (
          <>
            <strong>This file was rewritten end to end</strong> — every line changed, but
            only its whitespace did. Usually an editor converting line endings (CRLF vs
            LF) on save. Showing the {lines} as unchanged so the real edit stands out.
          </>
        ) : (
          <>
            Hiding {lines} that changed only in whitespace — line endings, indentation or
            trailing spaces.
          </>
        )}{' '}
        <span className="diff__wsnotice-counts">
          Full diff: +{rawAdditions} / −{rawDeletions}.
        </span>
      </span>
      <button className="btn btn--sm diff__wsnotice-btn" onClick={onShow}>
        Show whitespace changes
      </button>
    </div>
  );
}
