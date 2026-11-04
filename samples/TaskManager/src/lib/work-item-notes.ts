import {
  MAX_WORK_ITEM_NOTE_LENGTH,
  type WorkItemNote,
} from "@/storage/collections";
import { withConflictRetry, type Collection, type Stored } from "@/storage/core";

export { MAX_WORK_ITEM_NOTE_LENGTH };

/**
 * App-owned notes on Azure DevOps work items (`workItemNotes` collection). The
 * record id IS the work item id, so there is exactly one note per work item.
 */
export const WORK_ITEM_NOTES_QUERY_KEY = ["work-item-notes"] as const;

export type WorkItemNoteRecord = Stored<WorkItemNote>;
export type WorkItemNotes = Collection<WorkItemNote>;

/** Normalizes "#123" / " 123 " to the record key "123". */
export function workItemNoteKey(workItemId: string): string {
  const key = workItemId.trim().replace(/^#/, "");
  if (!key) throw new Error("An Azure DevOps work-item id is required.");
  return key;
}

/** Notes for the given work items (missing ones are simply absent). */
export async function loadWorkItemNotes(
  notes: WorkItemNotes,
  workItemIds: readonly string[],
): Promise<WorkItemNoteRecord[]> {
  const ids = Array.from(new Set(workItemIds.map(workItemNoteKey)));
  if (ids.length === 0) return [];
  return await notes.listAll({ where: [{ field: "workItemId", op: "in", value: ids }] });
}

/** Saves (or clears) one work item's note without overwriting a concurrent edit. */
export async function saveWorkItemNote(
  notes: WorkItemNotes,
  workItemId: string,
  rawNote: string,
): Promise<WorkItemNoteRecord> {
  const key = workItemNoteKey(workItemId);
  const note = rawNote.trim().slice(0, MAX_WORK_ITEM_NOTE_LENGTH);
  return await withConflictRetry(async () => {
    const current = await notes.get(key);
    if (!current) return await notes.create({ workItemId: key, note }, { id: key });
    return await notes.update(key, { note }, { ifVersion: current.version });
  });
}
