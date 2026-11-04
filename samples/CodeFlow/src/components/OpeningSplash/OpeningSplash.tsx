import { useEffect, useState } from 'react';
import type { DeepLinkTarget } from '../../utils/deepLink';
import { describeSplashDetail, describeSplashTarget } from './describeTarget';

/** How long to wait before reassuring the reviewer that we're still working. */
const SLOW_AFTER_MS = 6000;

/**
 * Full-screen "we're on it" state while a pull request opens — whether the
 * reviewer followed a deep link or clicked a row on the dashboard. Without it
 * the app sits on the dashboard while the PR loads, which reads as a silent
 * failure: reviewers assume the click didn't register and try again, or give up
 * on the link entirely.
 */
export function OpeningSplash({ target }: { target: DeepLinkTarget | null }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="loader">
      <div className="loader__card splash" role="status" aria-live="polite">
        <div className="loader__brand">
          <img className="loader__logo" src="/codeflow-logo.svg" alt="" width={46} height={46} />
          <div>
            <h1>{target ? 'Opening pull request' : 'Opening CodeFlow…'}</h1>
            {target && <p className="loader__tag">{describeSplashTarget(target)}</p>}
          </div>
        </div>
        <div className="splash__bar">
          <span />
        </div>
        <p className="splash__hint">
          {target ? describeSplashDetail(target) : 'Taking you to the app…'}
        </p>
        {slow && (
          <p className="splash__hint splash__hint--slow">
            Still working — large pull requests can take a few moments.
          </p>
        )}
      </div>
    </div>
  );
}
