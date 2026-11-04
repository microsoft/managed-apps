import type { Connectors } from "./index";
import { createAzureDevOpsConnector } from "./azureDevOps";
import { createOffice365UsersConnector } from "./office365Users";
import { createTeamsConnector } from "./teams";

/** Live adapters backed by the generated connector clients. Imported only by `main.tsx`. */
export function createLiveConnectors(): Connectors {
  return {
    azureDevOps: createAzureDevOpsConnector(),
    office365Users: createOffice365UsersConnector(),
    teams: createTeamsConnector(),
  };
}
