import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adoNumericId,
  areaCategoryCode,
  defaultWiql,
  fetchLiveWorkItems,
  fetchWorkItem,
  normalizeAreaPath,
  toggleTag,
  workItemUrl,
  type AdoConfig,
} from "@/lib/ado";
import { fakeConnectors } from "@/test/fake-connectors";

const CONFIG: AdoConfig = {
  organization: "contoso",
  project: "Fabrikam Web",
  areaRoot: "Fabrikam Web\\Team A",
  wiql: "",
};

const ROWS: Record<number, Record<string, unknown>> = {
  101: {
    "System.Title": "Add sign-in page",
    "System.AreaPath": "Fabrikam Web\\Team A\\Frontend",
    "System.State": "Active",
    "System.WorkItemType": "User Story",
    "System.AssignedTo": { displayName: "Avery Example", uniqueName: "avery@contoso.example" },
    "System.Tags": "urgent; Needs Review",
    "System.Description": "<p>Use the <b>new</b> layout</p>",
    "System.CreatedDate": "2026-01-02T03:04:05Z",
    "Microsoft.VSTS.Common.StackRank": 10.5,
  },
  102: {
    "System.Title": "Fix 'quoted' bug",
    "System.AreaPath": "Fabrikam Web\\Team A",
    "System.State": "New",
    "System.AssignedTo": "Jordan Sample <jordan@contoso.example>",
  },
};

function adoFake() {
  return fakeConnectors({
    azureDevOps: {
      httpRequest: vi.fn(async (_org, request) => {
        const body = JSON.parse(request.Body ?? "{}");
        if (request.Uri.includes("/_apis/wit/wiql")) {
          const after = Number(/\[System\.Id\] > (\d+)/.exec(body.query)?.[1] ?? 0);
          return { success: true, data: { workItems: Object.keys(ROWS).map(Number).filter((id) => id > after).map((id) => ({ id })) } };
        }
        if (request.Uri.includes("workitemsbatch")) {
          return { success: true, data: { value: body.ids.map((id: number) => ({ id, fields: ROWS[id] })) } };
        }
        return { success: false, error: { message: "unexpected request" } };
      }),
    },
  });
}

describe("WIQL building", () => {
  it("scopes the board query to the area root and escapes quotes", () => {
    const wiql = defaultWiql("Contoso's Team/");
    expect(wiql).toContain("[System.AreaPath] UNDER 'Contoso''s Team'");
    expect(wiql).toContain("[System.WorkItemType] IN ('User Story','Feature','Epic')");
    expect(wiql).toContain("[System.State] NOT IN ('Closed','Removed')");
    expect(wiql).toMatch(/ORDER BY \[System\.Id\] ASC$/);
  });

  it("normalizes area paths and buckets items by sub-area", () => {
    expect(normalizeAreaPath("A/B\\C\\")).toBe("A\\B\\C");
    expect(areaCategoryCode("Root\\Frontend\\Login", "Root")).toBe("Frontend");
    expect(areaCategoryCode("Root", "Root")).toBe("Other");
    expect(areaCategoryCode(undefined, "Root")).toBe("Other");
    expect(areaCategoryCode("Elsewhere\\Leaf", "Root")).toBe("Leaf");
  });

  it("builds work item links only from the configured org/project", () => {
    expect(adoNumericId("#42")).toBe(42);
    expect(adoNumericId("abc")).toBeNull();
    expect(workItemUrl(CONFIG, "#42")).toBe("https://dev.azure.com/contoso/Fabrikam%20Web/_workitems/edit/42");
    expect(workItemUrl({ ...CONFIG, organization: "" }, "#42")).toBeNull();
  });

  it("toggles whole tags only, preserving the others", () => {
    expect(toggleTag(["urgent-later", "Docs"], "urgent")).toEqual({ tags: ["urgent-later", "Docs", "urgent"], added: true });
    expect(toggleTag(["Urgent", "Docs"], " urgent ")).toEqual({ tags: ["Docs"], added: false });
  });
});

describe("work item parsing through the connector adapter", () => {
  beforeEach(() => {
    adoFake();
  });

  it("pages WIQL ids, hydrates rows and maps fields", async () => {
    const result = await fetchLiveWorkItems(CONFIG);
    expect(result.idCount).toBe(2);
    expect(result.hydrateMode).toBe("batch-rest");
    const story = result.items.find((item) => item.id === "#101")!;
    expect(story).toMatchObject({
      title: "Add sign-in page",
      area: "Frontend",
      state: "Active",
      assignee: "Avery Example",
      assigneeEmail: "avery@contoso.example",
      tags: ["urgent", "Needs Review"],
      description: "Use the new layout",
      stackRank: 10.5,
      createdDate: "2026-01-02T03:04:05Z",
    });
    const bug = result.items.find((item) => item.id === "#102")!;
    expect(bug).toMatchObject({ area: "Other", assignee: "Jordan Sample", assigneeEmail: "jordan@contoso.example", stackRank: null });
  });

  it("fetches a single work item for deep links", async () => {
    await expect(fetchWorkItem(CONFIG, "#102")).resolves.toMatchObject({ title: "Fix 'quoted' bug" });
    await expect(fetchWorkItem({ ...CONFIG, project: "" }, "#102")).rejects.toThrow(/not configured/);
  });
});
