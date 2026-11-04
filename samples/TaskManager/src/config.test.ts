import { describe, expect, it } from "vitest";
import { DEFAULT_ETA_MESSAGE_TEMPLATE, isAdoConfigured, parseConfig } from "@/config";

describe("config", () => {
  it("uses empty or neutral defaults", () => {
    const { config, issues } = parseConfig({});
    expect(issues).toEqual([]);
    expect(config.ado).toMatchObject({
      organization: "",
      project: "",
      areaPath: "",
      areas: [],
      boardWorkItemTypes: ["User Story", "Feature", "Epic"],
      excludedStates: ["Closed", "Removed"],
      completedStates: ["Closed"],
    });
    expect(config.storage).toEqual({ provider: "local", prefix: "taskmanager" });
    expect(config.teams.etaMessageTemplate).toBe(DEFAULT_ETA_MESSAGE_TEMPLATE);
    expect(isAdoConfigured(config)).toBe(false);
  });

  it("parses lists, trims values and normalizes the area path", () => {
    const { config } = parseConfig({
      VITE_ADO_ORG: " contoso ",
      VITE_ADO_PROJECT: "Fabrikam Web",
      VITE_ADO_AREA_PATH: "Fabrikam Web/Team A/",
      VITE_ADO_AREAS: "Frontend, Backend,,Frontend",
      VITE_TEAM_MEMBERS: "Avery Example,Jordan Sample",
    });
    expect(config.ado.organization).toBe("contoso");
    expect(config.ado.areaPath).toBe("Fabrikam Web\\Team A");
    expect(config.ado.areas).toEqual(["Frontend", "Backend"]);
    expect(config.team.members).toEqual(["Avery Example", "Jordan Sample"]);
    expect(isAdoConfigured(config)).toBe(true);
  });

  it("rejects unsafe URLs and storage prefixes, reporting why", () => {
    const { config, issues } = parseConfig({
      VITE_APP_URL: "http://apps.example.com/task-manager",
      VITE_ISSUE_TRACKER_BASE_URL: "javascript:alert(1)",
      VITE_APP_STORAGE_PREFIX: "bad prefix!",
    });
    expect(config.links).toEqual({ appUrl: "", issueTrackerBaseUrl: "" });
    expect(config.storage.prefix).toBe("taskmanager");
    expect(issues).toHaveLength(3);
  });
});
