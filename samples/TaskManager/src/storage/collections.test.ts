import { describe, expect, it } from "vitest";
import { createMemoryProvider, describeCollections, ValidationError } from "@/storage/core";
import {
  allCollections,
  feedbackCollection,
  retroNotesCollection,
  tagConfigCollection,
  trackerScenariosCollection,
  trackersCollection,
  workItemNotesCollection,
} from "@/storage/collections";
import { createStorage, providerRegistry } from "@/storage";

describe("app collections on the storage interface", () => {
  it("store and validate every app collection", async () => {
    const provider = createMemoryProvider();
    const retro = provider.collection(retroNotesCollection);
    const note = await retro.create({ text: "Ship it", column: "went-well" });
    expect(note).toMatchObject({ text: "Ship it", column: "went-well" });
    await expect(retro.create({ text: "x", column: "nope" as "improve" })).rejects.toBeInstanceOf(ValidationError);

    const tags = provider.collection(tagConfigCollection);
    const tag = await tags.create({ tag: "urgent", label: "Urgent", description: "", marker: "icon-flame" });
    expect(tag.marker).toBe("icon-flame");

    const trackers = provider.collection(trackersCollection);
    const tracker = await trackers.create({ name: "Launch", description: "Contoso launch", tags: ["urgent"], rowGroups: [] });
    expect(tracker.rowGroups).toEqual([]);

    const scenarios = provider.collection(trackerScenariosCollection);
    await scenarios.create({ trackerId: tracker.id, scenarios: [] }, { id: tracker.id });
    expect(await scenarios.get(tracker.id)).toMatchObject({ trackerId: tracker.id });

    const notes = provider.collection(workItemNotesCollection);
    await notes.create({ workItemId: "42", note: "Blocked on review" }, { id: "42" });
    expect((await notes.get("42"))?.note).toBe("Blocked on review");

    const feedback = provider.collection(feedbackCollection);
    await expect(
      feedback.create({ title: "", kind: "bug", description: "", status: "open", creatorName: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("round-trips app data through export and import", async () => {
    const source = createMemoryProvider({ prefix: "taskmanager" });
    await source.collection(retroNotesCollection).create({ text: "Keep pairing", column: "improve" });
    source.kv("settings").set("adoConnection", { organization: "contoso", project: "Fabrikam", areaRoot: "", wiql: "" });
    const snapshot = await source.exportAll();

    const target = createMemoryProvider({ prefix: "taskmanager" });
    const retro = target.collection(retroNotesCollection);
    await target.importAll(snapshot, { mode: "replace" });
    expect((await retro.listAll()).map((n) => n.text)).toEqual(["Keep pairing"]);
  });

  it("describes every collection for shared backends", () => {
    const described = describeCollections(allCollections);
    expect(described.map((d) => d.name)).toEqual([
      "retroNotes",
      "tagConfig",
      "trackers",
      "trackerScenarios",
      "workItemNotes",
      "feedback",
    ]);
    for (const d of described) expect(d.schema).toMatchObject({ type: "object" });
  });

  it("selects providers from the registry and falls back to local", () => {
    expect(Object.keys(providerRegistry)).toEqual(expect.arrayContaining(["local", "memory"]));
    expect(createStorage("memory").id).toBe("memory");
    expect(createStorage("does-not-exist").capabilities.shared).toBe(false);
  });
});
