// Clipboard helpers, with real fallbacks and real errors.
//
// Two entry points:
//   * `copyTextToClipboard(text)`  — plain text (writeText, then execCommand).
//   * `copyLinkToClipboard(link)`  — a NAMED hyperlink: writes text/html AND
//     text/plain so a paste into Teams, Outlook, Word or OneNote lands as a
//     link showing the work item's id and title instead of a bare URL. It
//     degrades onto `copyTextToClipboard`, so it is the same ladder plus one
//     rung on top.
//
// ---------------------------------------------------------------------------
//
// `navigator.clipboard.writeText` is the right API but it is NOT always
// available: it needs a secure context, and it can reject outright (permissions
// policy, a document that isn't focused, or an embedding iframe that doesn't
// grant clipboard-write — which is exactly the situation this app runs in when
// it is previewed or embedded). Silently doing nothing in those cases is the
// worst outcome, so:
//
//   1. try the async Clipboard API when it exists;
//   2. fall back to a hidden <textarea> + document.execCommand("copy"), which
//      still works in an iframe because it rides a real user gesture;
//   3. throw a plain Error describing WHY it failed, so the caller can surface
//      it (a toast) rather than pretending the copy happened.
export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) throw new Error("There was nothing to copy.");

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path — a rejection here is usually a
      // permissions/focus problem, which execCommand often survives.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("The clipboard isn't available in this context.");
  }

  const area = document.createElement("textarea");
  area.value = text;
  // Off-screen but still focusable/selectable; `readOnly` stops mobile
  // keyboards popping up, and the fixed position prevents a scroll jump.
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);

  try {
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    if (!ok) {
      throw new Error("The browser blocked the copy.");
    }
  } catch (err) {
    throw new Error(
      err instanceof Error && err.message
        ? err.message
        : "The browser blocked the copy.",
    );
  } finally {
    area.remove();
  }
}

/** A hyperlink to put on the clipboard: where it points, and what it reads as. */
export interface ClipboardLink {
  /** Absolute http(s) URL. Scheme-checked again here before any markup. */
  url: string;
  /** The visible text of the pasted link, e.g. "38731613: Fix the widget". */
  label: string;
}

/**
 * How the link ACTUALLY landed — never assume, the caller reports what happened.
 *
 * "rich"  — text/html went on, so a rich target pastes a named link.
 * "plain" — only text/plain landed ("<label> — <url>").
 */
export type CopyLinkResult = "rich" | "plain";
export type CopyRichResult = CopyLinkResult;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape text for interpolation into the copied markup — both element text and
 * a quoted attribute value. Work item titles really do contain `&`, `<` and
 * quotes, and this markup is handed to Outlook/Word/OneNote, so it is escaped
 * at the point of construction rather than trusted.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Only an ABSOLUTE http(s) URL may become an `href` in copied markup.
 *
 * The caller already passes the URL through `safeUrl()`, but that also permits
 * `mailto:`/`tel:` and relative paths — neither of which is a meaningful work
 * item link once it has been pasted into another application. Parsing with no
 * base means a relative URL throws and is rejected, so anything that isn't a
 * real http(s) address falls back to the plain-text path instead of being
 * written into an anchor.
 */
function isAbsoluteHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Whether this browser/context exposes the rich (multi-flavour) write path. */
function canWriteRich(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    typeof window !== "undefined" &&
    typeof window.ClipboardItem === "function" &&
    typeof Blob === "function"
  );
}

/**
 * Copy arbitrary trusted HTML with a plain-text fallback.
 *
 * Callers must escape untrusted values before interpolating them into `html`.
 * Both clipboard flavours are written together when the browser permits it;
 * embedded contexts that reject rich writes fall back to the same plain-text
 * ladder used everywhere else in this module.
 */
export async function copyHtmlToClipboard({
  html,
  plainText,
}: {
  html: string;
  plainText: string;
}): Promise<CopyRichResult> {
  if (!html.trim() || !plainText.trim()) {
    throw new Error("There was nothing to copy.");
  }

  if (canWriteRich()) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ]);
      return "rich";
    } catch {
      // Fall through to plain text when an embed or browser rejects text/html.
    }
  }

  await copyTextToClipboard(plainText);
  return "plain";
}

/**
 * Copy a NAMED link: the pasted result reads as its label, not as a raw URL.
 *
 * Three rungs, most capable first — `navigator.clipboard.write` with a
 * `ClipboardItem` is a good deal less available than `writeText` (it needs a
 * secure context, it is missing in older browsers, and a permissions policy or
 * an embedding iframe — exactly how this app is previewed — can refuse it), so
 * it is feature-detected AND wrapped, and a refusal degrades rather than
 * failing:
 *
 *   1. text/html + text/plain together → a real hyperlink in Teams, Outlook,
 *      Word, OneNote, and the plain flavour anywhere else in the SAME copy;
 *   2. `copyTextToClipboard` → navigator.clipboard.writeText;
 *   3. …which itself falls back to the hidden-textarea execCommand path.
 *
 * Never silently does nothing: if every rung fails, the error from the bottom
 * rung propagates for the caller to surface. Resolves with which rung won, so
 * the caller can say what really happened instead of claiming rich formatting
 * that a browser may have refused.
 */
export async function copyLinkToClipboard(
  link: ClipboardLink,
): Promise<CopyLinkResult> {
  return copyLinksToClipboard([link]);
}

/** Copy one or more named links, separated by a single space in both formats. */
export async function copyLinksToClipboard(
  links: ClipboardLink[],
): Promise<CopyLinkResult> {
  const normalized = links.map((link) => {
    const url = link.url.trim();
    if (!url) throw new Error("There was nothing to copy.");
    return { url, label: link.label.trim() || url };
  });
  if (normalized.length === 0) throw new Error("There was nothing to copy.");

  const plain = normalized
    .map(({ url, label }) => (label === url ? url : `${label} — ${url}`))
    .join(" ");

  if (
    canWriteRich() &&
    normalized.every(({ url }) => isAbsoluteHttpUrl(url))
  ) {
    try {
      const html = normalized
        .map(
          ({ url, label }) =>
            `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`,
        )
        .join(" ");
      return await copyHtmlToClipboard({ html, plainText: plain });
    } catch {
      // Refused (permissions policy, iframe, unfocused document, or a browser
      // that advertises `write` but won't take text/html) — fall through to the
      // plain rungs rather than leaving the clipboard untouched.
    }
  }

  await copyTextToClipboard(plain);
  return "plain";
}
