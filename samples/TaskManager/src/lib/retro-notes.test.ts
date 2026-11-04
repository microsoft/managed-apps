import { describe, expect, it } from "vitest";
import { createMemoryProvider } from "@/storage/core";
import { retroNotesCollection } from "@/storage/collections";
import { addNote, deleteNotes, listNotes, renameNote } from "@/lib/retro-notes";
import { withRacingWriter } from "@/test/racing-writer";

describe("retro notes", () => {
  it("adds, lists oldest first and trims text", async () => {
    const notes = createMemoryProvider().collection(retroNotesCollection);
    await addNote(notes, "went-well", "  First  ");
    await addNote(notes, "improve", "Second");
    expect(await addNote(notes, "improve", "   ")).toBeNull();
    expect((await listNotes(notes)).map((n) => n.text)).toEqual(["First", "Second"]);
  });

  it("retries a rename that lost a race (withConflictRetry)", async () => {
    const base = createMemoryProvider().collection(retroNotesCollection);
    const created = await addNote(base, "went-badly", "Flaky build");
    const racing = withRacingWriter(base, () => ({ column: "improve" as const }));
    const renamed = await renameNote(racing, created!.id, "Flaky build, fixed");
    expect(racing.races).toBe(1);
    // The rename re-read the record, so the other writer's change survives.
    expect(renamed).toMatchObject({ text: "Flaky build, fixed", column: "improve" });
  });

  it("reports bulk deletes honestly", async () => {
    const notes = createMemoryProvider().collection(retroNotesCollection);
    await addNote(notes, "went-well", "a");
    await addNote(notes, "went-well", "b");
    const all = await listNotes(notes);
    const result = await deleteNotes(notes, all);
    expect(result).toEqual({ requested: 2, deleted: 2, failures: [] });
    expect(await listNotes(notes)).toEqual([]);
  });
});
