import { ConflictError, isStorageError } from '../storage/core';

/** Trims and lowercases an identifier (user id, email, search term) for comparisons. */
export function normalizeId(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s@._-]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** FNV-1a, stable across sessions; used for deterministic tints and motifs. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function seededRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Something went wrong.';
}

/** Turns a storage failure into a readable Error that starts with the attempted action. */
export function storageError(action: string, error: unknown): Error {
  let reason: string;
  if (error instanceof ConflictError) reason = 'Someone else changed this at the same time. Try again.';
  else if (isStorageError(error, 'not-found')) reason = 'It no longer exists.';
  else if (isStorageError(error, 'validation')) reason = 'Some of the values aren’t valid.';
  else if (isStorageError(error)) reason = error.message;
  else reason = errorMessage(error);
  return new Error(`${action}: ${reason}`, { cause: error });
}

/** Turns a connector failure into a readable Error. */
export function connectorError(action: string, error: { message?: string } | undefined): Error {
  return new Error(`${action}: ${error?.message || 'The connector request failed.'}`);
}
