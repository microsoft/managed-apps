import { describe, expect, it } from "vitest";
import { createMemoryProvider } from "@/storage/core";
import { feedbackCollection, workItemNotesCollection } from "@/storage/collections";
import { loadWorkItemNotes, saveWorkItemNote, workItemNoteKey } from "@/lib/work-item-notes";
import { closeFeedback, createFeedback, listFeedback } from "@/lib/feedback";
import { withRacingWriter } from "@/test/racing-writer";

describe("work item notes", () => {
  it("keys notes by the numeric work item id", async () => {
    const notes = createMemoryProvider().collection(workItemNotesCollection);
    expect(workItemNoteKey(" #42 ")).toBe("42");
    await saveWorkItemNote(notes, "#42", " Waiting on design ");
    await saveWorkItemNote(notes, "42", "Unblocked");
    const loaded = await loadWorkItemNotes(notes, ["#42", "#7"]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ id: "42", workItemId: "42", note: "Unblocked" });
  });
});

describe("feedback", () => {
  it("creates and closes items, retrying on a conflict", async () => {
    const base = createMemoryProvider().collection(feedbackCollection);
    const item = await createFeedback(base, { title: "Dark mode", kind: "feature", description: "Please", creatorName: "Avery" });
    const racing = withRacingWriter(base, () => ({ description: "Please, with contrast" }));
    const closed = await closeFeedback(racing, item.id, "Shipped");
    expect(racing.races).toBe(1);
    expect(closed).toMatchObject({ status: "closed", closingNotes: "Shipped", description: "Please, with contrast" });
    expect((await listFeedback(base)).map((f) => f.title)).toEqual(["Dark mode"]);
  });
});
