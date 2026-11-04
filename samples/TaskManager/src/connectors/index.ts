import type { AzureDevOpsConnector } from "./azureDevOps";
import type { Office365UsersConnector } from "./office365Users";
import type { TeamsConnector } from "./teams";

export type { ConnectorResult } from "./result";
export { connectorError } from "./result";
export type * from "./azureDevOps";
export type * from "./office365Users";
export type * from "./teams";

/**
 * The connector adapters the app talks to. The live implementations (which wrap
 * the generated clients) are registered once in `main.tsx`; tests register fakes.
 * Only `src/connectors/**` may import `generated/` (enforced by ESLint).
 */
export interface Connectors {
  azureDevOps: AzureDevOpsConnector;
  office365Users: Office365UsersConnector;
  teams: TeamsConnector;
}

let registered: Connectors | null = null;

export function registerConnectors(connectors: Connectors): void {
  registered = connectors;
}

export function connectors(): Connectors {
  if (!registered) {
    throw new Error("Connectors are not registered. Run `npm run check-setup` and see README › Setup.");
  }
  return registered;
}
