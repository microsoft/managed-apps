import { vi } from "vitest";
import { registerConnectors, type Connectors } from "@/connectors";
import type { AzureDevOpsConnector } from "@/connectors/azureDevOps";
import type { Office365UsersConnector } from "@/connectors/office365Users";
import type { TeamsConnector } from "@/connectors/teams";

const notStubbed = (name: string) => () => Promise.reject(new Error(`${name} is not stubbed in this test`));

/** Fake connector adapters. Every method rejects unless the test overrides it. */
export function fakeConnectors(overrides: {
  azureDevOps?: Partial<AzureDevOpsConnector>;
  office365Users?: Partial<Office365UsersConnector>;
  teams?: Partial<TeamsConnector>;
} = {}): Connectors {
  const connectors: Connectors = {
    azureDevOps: {
      httpRequest: vi.fn(notStubbed("httpRequest")),
      createWorkItem: vi.fn(notStubbed("createWorkItem")),
      updateWorkItem: vi.fn(notStubbed("updateWorkItem")),
      addWorkItemLink: vi.fn(notStubbed("addWorkItemLink")),
      listWorkItems: vi.fn(notStubbed("listWorkItems")),
      listProjectMembers: vi.fn(notStubbed("listProjectMembers")),
      ...overrides.azureDevOps,
    },
    office365Users: {
      myProfile: vi.fn(notStubbed("myProfile")),
      photoMetadata: vi.fn(notStubbed("photoMetadata")),
      photo: vi.fn(notStubbed("photo")),
      ...overrides.office365Users,
    },
    teams: {
      postChatMessage: vi.fn(notStubbed("postChatMessage")),
      ...overrides.teams,
    },
  };
  registerConnectors(connectors);
  return connectors;
}
