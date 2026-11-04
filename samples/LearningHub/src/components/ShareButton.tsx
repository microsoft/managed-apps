import { useEffect, useRef, useState } from 'react';
import { OpenRegular } from '@fluentui/react-icons/headless/svg/open';
import { errorMessage } from '../lib/format';
import { copyText, shareUrlFor, useAppId } from '../lib/share';
import { Modal } from './Modal';

/** Inline so sharing doesn't pull in another icon module. */
function LinkGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="1.25em" height="1.25em" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
      <path
        d="M8.5 11.5a3 3 0 0 0 4.24 0l2.5-2.5a3 3 0 0 0-4.24-4.24l-.75.75M11.5 8.5a3 3 0 0 0-4.24 0l-2.5 2.5a3 3 0 0 0 4.24 4.24l.75-.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface ShareButtonProps {
  /** App route to open, e.g. "/sessions/2026-10-08-…". */
  route: string;
  /** Completes the accessible name: "Share {what}". */
  what: string;
}

/**
 * Copies a link that opens this page. If the iframe can't write to the clipboard, a small
 * dialog shows the link, selected, with Copy and Open.
 */
export function ShareButton({ route, what }: ShareButtonProps) {
  const appId = useAppId();
  const [copied, setCopied] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flashCopied = () => {
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2500);
  };

  // While the host is still answering, the dialog shows progress. If it never answers, the link
  // falls back to this page's own address (see buildShareUrl).
  const url = appId.isPending ? null : shareUrlFor(route, appId.data);

  const share = async () => {
    if (!url) {
      setDialogOpen(true);
      return;
    }
    if (await copyText(url)) flashCopied();
    else setDialogOpen(true);
  };

  return (
    <>
      <button type="button" className="button" onClick={() => void share()}>
        <LinkGlyph />
        {copied ? 'Link copied' : 'Share'}
        {!copied && <span className="visually-hidden"> {what}</span>}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? 'Link copied to the clipboard.' : ''}
      </span>
      <Modal open={dialogOpen} onClose={() => setDialogOpen(false)} title="Share link" size="sm">
        <ShareDialogBody
          url={url}
          loading={appId.isPending}
          error={null}
          onRetry={() => void appId.refetch()}
          onClose={() => setDialogOpen(false)}
        />
      </Modal>
    </>
  );
}

interface BodyProps {
  url: string | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onClose: () => void;
}

const COPY_KEYS = /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘C' : 'Ctrl+C';

function ShareDialogBody({ url, loading, error, onRetry, onClose }: BodyProps) {
  // 'manual': the browser blocked copying, so the link is left selected for the user to copy.
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const field = useRef<HTMLInputElement>(null);

  if (!url) {
    return (
      <div className="form">
        {error ? (
          <p className="form-error" role="alert">
            Couldn’t build the link. {errorMessage(error)}
          </p>
        ) : (
          <p role="status">{loading ? 'Getting the link…' : 'The link isn’t available yet.'}</p>
        )}
        <div className="modal__footer">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
          {error ? (
            <button type="button" className="button button--primary" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="form">
      <div className="field">
        <label htmlFor="share-link">Copy this link</label>
        <input
          ref={field}
          id="share-link"
          type="text"
          readOnly
          value={url}
          data-autofocus
          aria-describedby="share-link-hint"
          onFocus={(event) => event.currentTarget.select()}
        />
        <p id="share-link-hint" className={`field__hint${status === 'manual' ? ' field__hint--strong' : ''}`}>
          {status === 'manual'
            ? `Your browser blocked copying. The link is selected: press ${COPY_KEYS} to copy it.`
            : 'It opens this page for anyone with access to the app.'}
        </p>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {status === 'copied' ? 'Link copied to the clipboard.' : status === 'manual' ? `Copying was blocked. Press ${COPY_KEYS} to copy the selected link.` : ''}
      </p>
      <div className="modal__footer">
        <a className="button" href={url} target="_blank" rel="noopener noreferrer">
          <OpenRegular />
          Open<span className="visually-hidden"> (opens in a new tab)</span>
        </a>
        <button
          type="button"
          className="button button--primary"
          onClick={() =>
            void copyText(url, field.current).then((ok) => {
              setStatus(ok ? 'copied' : 'manual');
              // Leave the link focused and selected so Ctrl+C works straight away.
              if (!ok) {
                field.current?.focus();
                field.current?.select();
              }
            })
          }
        >
          {status === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
