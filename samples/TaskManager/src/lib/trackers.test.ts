import { describe, expect, it } from "vitest";
import { createMemoryProvider } from "@/storage/core";
import { trackerScenariosCollection, trackersCollection } from "@/storage/collections";
import {
  addTrackerRowChild,
  createTracker,
  removeTrackerRowChild,
  trackerRowGroups,
  validateTracker,
} from "@/lib/trackers";
import {
  createTrackerScenario,
  getTrackerScenarioSet,
  moveTrackerWorkItems,
  trackerScenarios,
  validateIssueUrl,
} from "@/lib/tracker-scenarios";
import type { ResolvedTag } from "@/lib/tag-config";
import { withRacingWriter } from "@/test/racing-writer";

const TAGS: ResolvedTag[] = [
  { key: "a", tag: "Launch", label: "Launch", description: "", marker: "none" },
];

describe("trackers", () => {
  it("validates names, descriptions and registered tags", async () => {
    const trackers = createMemoryProvider().collection(trackersCollection);
    const existing = [await createTracker(trackers, { name: "Launch", description: "d", tags: ["Launch"] })];
    expect(validateTracker({ name: "launch", description: "x", tags: ["Launch"] }, existing, TAGS)).toMatch(/already exists/);
    expect(validateTracker({ name: "New", description: "x", tags: ["Other"] }, existing, TAGS)).toMatch(/no longer registered/);
    expect(validateTracker({ name: "New", description: "x", tags: ["launch"] }, existing, TAGS)).toBeNull();
  });

  it("combines rows and keeps a concurrent change (withConflictRetry)", async () => {
    const base = createMemoryProvider().collection(trackersCollection);
    const tracker = await createTracker(base, { name: "Launch", description: "d", tags: ["Launch"] });
    const racing = withRacingWriter(base, () => ({ description: "edited elsewhere" }));
    const updated = await addTrackerRowChild(racing, tracker.id, "#1", "#2", "Login");
    expect(racing.races).toBe(1);
    expect(updated.description).toBe("edited elsewhere");
    expect(trackerRowGroups(updated)).toMatchObject([{ title: "Login", masterWorkItemId: "#1", childWorkItemIds: ["#2"] }]);

    const ungrouped = await removeTrackerRowChild(base, tracker.id, trackerRowGroups(updated)[0].groupId, "#2");
    expect(trackerRowGroups(ungrouped)).toEqual([]);
  });

  it("drops malformed and overlapping row groups", () => {
    const groups = trackerRowGroups({
      rowGroups: [
        { groupId: "g1", title: "", masterWorkItemId: "#1", childWorkItemIds: ["#2", "#1"], createdAt: "x" },
        { groupId: "g2", title: "dup", masterWorkItemId: "#2", childWorkItemIds: ["#3"], createdAt: "x" },
      ],
    });
    expect(groups).toEqual([
      { groupId: "g1", title: "Combined work items", masterWorkItemId: "#1", childWorkItemIds: ["#2"], createdAt: "x" },
    ]);
  });
});

describe("tracker scenarios", () => {
  it("keeps one record per tracker and always ends with Misc", async () => {
    const sets = createMemoryProvider().collection(trackerScenariosCollection);
    await createTrackerScenario(sets, "t1", "Checkout");
    const moved = await moveTrackerWorkItems(sets, "t1", ["#5"], trackerScenarios(await getTrackerScenarioSet(sets, "t1"))[0].scenarioId);
    const scenarios = trackerScenarios(moved);
    expect(scenarios.map((s) => s.name)).toEqual(["Checkout", "Misc"]);
    expect(scenarios[0].workItemIds).toEqual(["#5"]);
    expect((await sets.listAll()).map((s) => s.id)).toEqual(["t1"]);
    await expect(createTrackerScenario(sets, "t1", "misc")).rejects.toThrow(/reserved/);
  });
});

describe("issue tracker URL validation", () => {
  it("accepts any https URL when no base is configured", () => {
    expect(validateIssueUrl("https://issues.example.com/browse/APP-7#c1", "")).toBe("https://issues.example.com/browse/APP-7");
  });

  it("rejects non-https and unsafe URLs", () => {
    expect(() => validateIssueUrl("http://issues.example.com/1", "")).toThrow();
    expect(() => validateIssueUrl("javascript:alert(1)", "")).toThrow();
    expect(() => validateIssueUrl("https://user:pw@issues.example.com/1", "")).toThrow();
  });

  it("requires the configured base when one is set", () => {
    const base = "https://github.com/contoso/app/issues";
    expect(validateIssueUrl("https://github.com/contoso/app/issues/12", base)).toBe("https://github.com/contoso/app/issues/12");
    expect(() => validateIssueUrl("https://github.com/contoso/app-evil/issues/12", base)).toThrow(/under/);
    expect(() => validateIssueUrl("https://github.example.com/contoso/app/issues/12", base)).toThrow(/under/);
  });
});
