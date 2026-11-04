/**
 * Pure helpers for the @mention autocomplete in the comment editor.
 *
 * These functions are deliberately free of React/DOM concerns so the trigger
 * detection, candidate filtering and text insertion can be unit-tested in
 * isolation from the textarea wiring.
 */
import type { GitUserRef } from '../../types';

/** A detected `@mention` token currently under the caret. */
export interface MentionQuery {
  /** Index of the triggering `@` character. */
  start: number;
  /** Caret index (exclusive end of the query span). */
  end: number;
  /** Text typed between the `@` and the caret (may be empty). */
  query: string;
}

const TRIGGER = '@';
/** Characters allowed inside a GitHub login (alphanumerics + hyphen). */
const LOGIN_CHAR = /[A-Za-z0-9-]/;
/** A valid GitHub-style handle: starts alphanumeric, then alnum/hyphen. */
const VALID_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Detect whether the caret sits inside an `@mention` token. Returns the token
 * span and query text, or `null` when there is no active mention.
 *
 * A mention is only recognized when the `@` is at the start of the text or
 * preceded by whitespace / an opening bracket, so the `@` inside an email
 * address never triggers the picker.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  if (caret < 0 || caret > text.length) return null;

  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === TRIGGER) {
      const prev = i > 0 ? text[i - 1] : '';
      if (prev === '' || /[\s(<]/.test(prev)) {
        return { start: i, end: caret, query: text.slice(i + 1, caret) };
      }
      return null;
    }
    // Any non-login character before hitting an `@` means we're not in a token.
    if (!LOGIN_CHAR.test(ch)) return null;
  }
  return null;
}

/**
 * Rank and trim mention candidates for a query. Prefix matches on the login are
 * prioritized, then case-insensitive substring matches on login or display
 * name, sorted alphabetically. An empty query returns the leading candidates.
 */
export function filterCandidates(
  candidates: GitUserRef[],
  query: string,
  limit = 8,
): GitUserRef[] {
  const q = query.toLowerCase();
  const matches = candidates.filter((c) => {
    if (!q) return true;
    return (
      c.login.toLowerCase().includes(q) ||
      (c.name?.toLowerCase().includes(q) ?? false)
    );
  });

  matches.sort((a, b) => {
    const ap = a.login.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.login.toLowerCase().startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.login.localeCompare(b.login);
  });

  return matches.slice(0, limit);
}

/**
 * Replace the mention token in `text` with `@login `, returning the new text
 * and the caret position immediately after the inserted mention.
 */
export function applyMention(
  text: string,
  range: MentionQuery,
  login: string,
): { text: string; caret: number } {
  const before = text.slice(0, range.start);
  const after = text.slice(range.end);
  const insert = `${TRIGGER}${login} `;
  const next = before + insert + after;
  return { text: next, caret: before.length + insert.length };
}

/**
 * Merge collaborator and participant lists into a single deduped, sorted set of
 * mentionable users. Deduping is case-insensitive by login; entries whose login
 * is not a valid GitHub handle (e.g. a commit-author display name) are dropped
 * so we never insert an un-mentionable token.
 */
export function mergeUsers(
  primary: GitUserRef[],
  extra: GitUserRef[],
): GitUserRef[] {
  const byLogin = new Map<string, GitUserRef>();
  for (const user of [...primary, ...extra]) {
    if (!user?.login || !VALID_LOGIN.test(user.login)) continue;
    const key = user.login.toLowerCase();
    const existing = byLogin.get(key);
    if (!existing) {
      byLogin.set(key, user);
    } else if (!existing.avatarUrl && user.avatarUrl) {
      // Prefer the richer record (one that carries an avatar).
      byLogin.set(key, { ...existing, ...user });
    }
  }
  return [...byLogin.values()].sort((a, b) =>
    a.login.toLowerCase().localeCompare(b.login.toLowerCase()),
  );
}
