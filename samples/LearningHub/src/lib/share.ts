import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppHostContext } from '../connectors/host';

export { buildShareUrl, shareUrlFor } from './shareUrl';

/**
 * The app id from the host. Fetched ahead of time so a Share click can copy synchronously within
 * the click's user activation.
 */
export function useAppId() {
  const host = useContext(AppHostContext);
  return useQuery({
    queryKey: ['app-context', 'appId'],
    queryFn: () => host.getAppId(),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}

type TextField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Selects all of `field` and runs the legacy copy command. Reports success only if the field really
 * has focus and a full selection: execCommand('copy') returns true even when nothing was selected
 * (e.g. the field sits outside an open modal dialog, where the page is inert).
 */
function copyFromField(field: TextField): boolean {
  field.focus({ preventScroll: true });
  field.select();
  const selected =
    document.activeElement === field &&
    field.value.length > 0 &&
    field.selectionStart === 0 &&
    field.selectionEnd === field.value.length;
  if (!selected) return false;
  try {
    // Deprecated but still the only synchronous fallback inside a cross-origin iframe.
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

/** Where a temporary field can take focus: inside the open modal dialog if there is one. */
function focusableHost(): HTMLElement {
  const fromFocus = document.activeElement?.closest<HTMLElement>('dialog[open]');
  if (fromFocus) return fromFocus;
  const dialogs = document.querySelectorAll<HTMLElement>('dialog[open]');
  return dialogs.length > 0 ? dialogs[dialogs.length - 1] : document.body;
}

/**
 * Copies text: the async Clipboard API first (an embedding frame may not grant clipboard-write),
 * then execCommand on `field` if given (it's left focused and selected either way, ready for a
 * manual copy), else on a temporary hidden field. Returns false if nothing was copied.
 */
export async function copyText(text: string, field?: TextField | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied in the iframe; try the legacy path.
  }
  if (field) return copyFromField(field);

  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.tabIndex = -1;
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  focusableHost().appendChild(area);
  try {
    return copyFromField(area);
  } finally {
    area.remove();
    previous?.focus({ preventScroll: true });
  }
}
