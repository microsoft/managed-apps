import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "@/App";
import { queryClient } from "@/lib/query-client";
import { createMemoryProvider } from "@/storage/core";
import { KV_NAMESPACES } from "@/storage/collections";
import { fakeConnectors } from "@/test/fake-connectors";

vi.mock("../../admins.json", () => ({ default: { admins: ["Avery@Contoso.example"] } }));

function adoReturning(ids: number[], profile: { displayName: string; userPrincipalName: string } | null = null) {
  return fakeConnectors({
    azureDevOps: {
      httpRequest: vi.fn(async (_org, request) => {
        const body = JSON.parse(request.Body ?? "{}");
        if (request.Uri.includes("/_apis/wit/wiql")) {
          const after = Number(/\[System\.Id\] > (\d+)/.exec(body.query)?.[1] ?? 0);
          return { success: true, data: { workItems: ids.filter((id) => id > after).map((id) => ({ id })) } };
        }
        if (request.Uri.includes("workitemsbatch")) {
          return {
            success: true,
            data: {
              value: body.ids.map((id: number) => ({
                id,
                fields: { "System.Title": `Item ${id}`, "System.State": "Active", "System.AreaPath": "Fabrikam" },
              })),
            },
          };
        }
        return { success: true, data: { value: [] } };
      }),
    },
    office365Users: {
      myProfile: vi.fn().mockResolvedValue(profile ? { success: true, data: profile } : { success: false }),
    },
  });
}

describe("app shell", () => {
  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it("shows the first-run setup screen until Azure DevOps is configured", async () => {
    adoReturning([]);
    render(<App storage={createMemoryProvider()} />);
    expect(await screen.findByText("Set up Task Manager")).toBeTruthy();
    expect(screen.getByText(/Local mode: data stays in this browser/)).toBeTruthy();
  });

  it("loads live work items into the tabs once a connection is saved", async () => {
    adoReturning([7, 8]);
    const storage = createMemoryProvider();
    storage.kv(KV_NAMESPACES.settings).set("adoConnection", {
      organization: "contoso",
      project: "Fabrikam",
      areaRoot: "",
      wiql: "",
    });
    render(<App storage={storage} />);
    expect(await screen.findByRole("button", { name: /My Work/ })).toBeTruthy();
    for (const label of ["Board", "Trackers", "Triage", "Feedback"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
    // Not listed in admins.json (no profile resolved), so the admin tabs are hidden.
    for (const label of ["Completed", "Retrospective", "Tags", "Bulk edit"]) {
      expect(screen.queryByRole("button", { name: new RegExp(`^${label}`) })).toBeNull();
    }
  });

  it("renders every tab, including admin tabs for a listed admin", async () => {
    adoReturning([7, 8], { displayName: "Avery Example", userPrincipalName: "avery@contoso.example" });
    const storage = createMemoryProvider();
    storage.kv(KV_NAMESPACES.settings).set("adoConnection", {
      organization: "contoso",
      project: "Fabrikam",
      areaRoot: "",
      wiql: "",
    });
    render(<App storage={storage} />);
    await screen.findByRole("button", { name: /^Bulk edit/ });
    const expectations: Array<[string, RegExp]> = [
      ["Board", /Engineers/],
      ["Trackers", /No trackers yet/],
      ["Triage", /Uncategorized work items/],
      ["Completed", /Completed/],
      ["Retrospective", /Sprint retrospective/],
      ["Feedback", /Suggest a feature/],
      ["Tags", /Tag configuration/],
      ["Bulk edit", /No tags configured/],
    ];
    for (const [tab, text] of expectations) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${tab}`) }));
      expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
      expect(screen.queryByText("Something went wrong")).toBeNull();
    }
  });
});
