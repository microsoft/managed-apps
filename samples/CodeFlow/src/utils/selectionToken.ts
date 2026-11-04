/**
 * Decides whether a text selection is worth echoing across the rest of the file.
 *
 * Selecting an identifier and seeing every other occurrence light up is only
 * useful when the selection *is* an identifier. Dragging across half a line, or
 * catching a stray character on the way to the scrollbar, would otherwise paint
 * the file for no reason — so most selections are deliberately rejected here.
 *
 * Pure and DOM-free: the hook reads the selection, this decides what it means.
 */

/** Below this the selection is almost always an accidental drag. */
export const MIN_SELECTION_LENGTH = 2;

/**
 * Above this it is prose or a whole expression, not a token. Generous, because
 * long identifiers are real; the whitespace rule already rejects most sentences.
 */
export const MAX_SELECTION_LENGTH = 120;

const WORD_TOKEN = /^[A-Za-z0-9_]+$/;
const HAS_WORD_CHAR = /[A-Za-z0-9_]/;

/**
 * Normalize a raw selection into the token to highlight, or null to highlight
 * nothing.
 *
 * Surrounding whitespace is trimmed — double-clicking a word in some browsers
 * picks up the trailing space — but a selection with whitespace *inside* it is
 * rejected: two words are a phrase, and phrase matching is what the find widget
 * is for. A selection of pure punctuation (`);`, `=>`) is rejected too, since
 * every line would match.
 */
export function selectionToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // A selection that spans lines is a block, not a word.
  if (/[\n\r]/.test(raw)) return null;

  const token = raw.trim();
  if (token.length < MIN_SELECTION_LENGTH) return null;
  if (token.length > MAX_SELECTION_LENGTH) return null;
  if (/\s/.test(token)) return null;
  if (!HAS_WORD_CHAR.test(token)) return null;

  return token;
}

/**
 * Whether the token should match only on word boundaries.
 *
 * `foo` should not light up the `foo` inside `foobar` — that is what makes the
 * highlight read as "the same thing", rather than "the same letters". But a
 * selection like `foo.bar` or `--flag` has no clean boundary to anchor on, so it
 * falls back to a plain substring search.
 *
 * The character class matches the one `diffSearch` uses for its own whole-word
 * option, so a highlight and a search of the same word agree.
 */
export function isWordToken(token: string): boolean {
  return WORD_TOKEN.test(token);
}

/**
 * The text to pre-fill the find widget with when Ctrl+F is pressed.
 *
 * Normally that is just whatever is selected. The catch is the occurrence
 * highlight: drawing it wraps every match — the selected one included — in a
 * `<mark>`, which rewrites the very text node the selection is anchored in. The
 * DOM's own range-adjustment rules then collapse that selection, so by the time
 * Ctrl+F arrives the browser reports nothing selected, even though the user can
 * still see their word lit up across the file. Selecting a word and hitting
 * Ctrl+F opened an empty find box.
 *
 * So when the live selection has been swallowed like that, fall back to
 * `highlighted` — the token the highlight is currently drawing, read from the
 * selection before the marks went in. It is non-null only while the highlight is
 * active, which is exactly when the text under the selection was rewritten; any
 * other time the selection is intact and wins on its own.
 *
 * `useSelectionHighlight` now puts the selection back after the rewrite, so
 * `live` normally survives and wins on its own. This stays as the backstop for
 * what restoring cannot cover — the cell having left the document, above all.
 */
export function findSeed(
  live: string | null | undefined,
  highlighted?: string | null,
): string | undefined {
  return live?.trim() || highlighted?.trim() || undefined;
}
