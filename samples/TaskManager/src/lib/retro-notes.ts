/**
 * RETRO NOTES — the data layer behind the Retrospective tab, on the app's
 * storage interface (`retroNotes` collection). The board component only calls
 * these functions; it never touches storage directly.
 */

import { errorText } from "@/lib/errors";
import {
  withConflictRetry,
  type Collection,
  type Stored,
} from "@/storage/core";
import {
  MAX_RETRO_NOTE_LENGTH,
  RETRO_COLUMN_IDS,
  type RetroColumnId,
  type RetroNote,
} from "@/storage/collections";

export { MAX_RETRO_NOTE_LENGTH, RETRO_COLUMN_IDS, type RetroColumnId };
export type RetroNoteRecord = Stored<RetroNote>;
export type RetroNotes = Collection<RetroNote>;

export const RETRO_NOTES_QUERY_KEY = ["retro-notes"] as const;

/** Every note, oldest first. */
export async function listNotes(notes: RetroNotes): Promise<RetroNoteRecord[]> {
  return await notes.listAll({ orderBy: [{ field: "createdAt", direction: "asc" }] });
}

export async function addNote(
  notes: RetroNotes,
  column: RetroColumnId,
  text: string,
): Promise<RetroNoteRecord | null> {
  const trimmed = text.trim().slice(0, MAX_RETRO_NOTE_LENGTH);
  if (!trimmed) return null;
  return await notes.create({ text: trimmed, column });
}

/**
 * Edits a note's text. Re-reads the note on every attempt and retries when
 * someone else changed it first (ConflictError), so a concurrent edit is never
 * silently overwritten with a stale copy.
 */
export async function renameNote(
  notes: RetroNotes,
  id: string,
  text: string,
): Promise<RetroNoteRecord | null> {
  const trimmed = text.trim().slice(0, MAX_RETRO_NOTE_LENGTH);
  if (!trimmed) return null;
  return await withConflictRetry(async () => {
    const current = await notes.get(id);
    if (!current) throw new Error("That note was deleted by someone else.");
    if (current.text === trimmed) return current;
    return await notes.update(id, { text: trimmed }, { ifVersion: current.version });
  });
}

export async function deleteNote(notes: RetroNotes, id: string): Promise<void> {
  await notes.delete(id);
}

/** A note that could NOT be deleted, with the real error. */
export interface RetroDeleteFailure {
  text: string;
  error: string;
}

/** What a bulk delete actually did. Counts, not a boolean. */
export interface RetroClearResult {
  requested: number;
  deleted: number;
  failures: RetroDeleteFailure[];
}

/**
 * Deletes the given notes one by one. A failure never aborts the run: the
 * remaining notes are still attempted and each failure is reported.
 */
export async function deleteNotes(
  notes: RetroNotes,
  targets: readonly RetroNoteRecord[],
): Promise<RetroClearResult> {
  const failures: RetroDeleteFailure[] = [];
  let deleted = 0;
  for (const note of targets) {
    try {
      await notes.delete(note.id);
      deleted += 1;
    } catch (error) {
      failures.push({ text: note.text, error: errorText(error, "The note could not be deleted.") });
    }
  }
  return { requested: targets.length, deleted, failures };
}

export function isRetroColumnId(value: string): value is RetroColumnId {
  return (RETRO_COLUMN_IDS as readonly string[]).includes(value);
}
