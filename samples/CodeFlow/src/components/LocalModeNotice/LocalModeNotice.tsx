import { useSyncExternalStore } from 'react';
import {
  appStorage,
  dismissStorageNotice,
  getStorageNotice,
  subscribeStorageNotice,
} from '../../storage';

/**
 * Tells the reviewer where their data lives. With the default `local` provider
 * nothing leaves this browser, so notes and approvals are not visible to anyone
 * else; that is worth saying out loud. Also surfaces storage failures (for
 * example a full browser quota) that would otherwise be silent.
 */
export function LocalModeNotice() {
  const notice = useSyncExternalStore(subscribeStorageNotice, getStorageNotice, getStorageNotice);
  const shared = appStorage().provider.capabilities.shared;

  return (
    <>
      {!shared && (
        <p className="local-mode" role="note">
          <span aria-hidden="true">🔒</span> Local mode: data stays in this browser. Review notes and
          app-only approvals are not shared with other reviewers.
        </p>
      )}
      {notice && (
        <div className="local-mode local-mode--warning" role="alert">
          <span>{notice}</span>
          <button type="button" className="btn btn--sm" onClick={dismissStorageNotice}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
