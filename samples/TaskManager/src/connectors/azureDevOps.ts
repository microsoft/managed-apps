import { AzureDevOpsService } from "../../generated";
import type {
  AddWorkItemLinkRequest,
  CreateWorkItemRequest,
  UpdateWorkItemRequest,
  VstsHttpRequestBodyParameters,
} from "../../generated/models/AzureDevOpsModel";
import type { ConnectorResult } from "./result";

/**
 * Azure DevOps adapter (connector api-id `shared_visualstudioteamservices`).
 * Exposes only the operations this app uses. `src/lib/ado.ts` builds on it.
 */

export type AdoHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AdoHttpRequest {
  Method: AdoHttpMethod;
  /** Path relative to the organization, e.g. `{project}/_apis/wit/wiql?api-version=7.0`. */
  Uri: string;
  Headers?: Record<string, unknown>;
  Body?: string;
}

export type AdoCreateLinkType = "Hierarchy-forward" | "Hierarchy-reverse" | "Related";

export interface AdoWorkItemBody {
  title?: string;
  description?: string;
  iteration?: string;
  area?: string;
  linkUrl?: string;
  linkType?: AdoCreateLinkType;
  userEnteredFields?: Record<string, unknown>;
}

export interface AdoWorkItemResponse {
  id?: number;
  rev?: number;
  url?: string;
  fields?: {
    System_AreaPath?: string;
    System_IterationPath?: string;
    System_WorkItemType?: string;
    System_State?: string;
    System_Title?: string;
    System_Description?: string;
    System_Tags?: string;
    System_AssignedTo?: string;
    [field: string]: unknown;
  };
}

export interface AdoTeamMember {
  displayName?: string;
  uniqueName?: string;
}

export interface AzureDevOpsConnector {
  /** Raw REST call through the connector (WIQL, batch reads, JSON-Patch updates, deletes). */
  httpRequest(organization: string, request: AdoHttpRequest): Promise<ConnectorResult<unknown>>;
  createWorkItem(
    organization: string,
    project: string,
    workItemType: string,
    body: AdoWorkItemBody & { title: string },
  ): Promise<ConnectorResult<AdoWorkItemResponse>>;
  updateWorkItem(
    organization: string,
    id: string,
    body: AdoWorkItemBody,
    project: string,
    workItemType: string,
  ): Promise<ConnectorResult<AdoWorkItemResponse>>;
  addWorkItemLink(
    organization: string,
    project: string,
    workItemType: string,
    workItemId: number,
    link: { linkType: string; targetUrl: string; comment?: string },
  ): Promise<ConnectorResult<AdoWorkItemResponse>>;
  /** Typed batch read with a fixed field set (fallback when REST hydration is unavailable). */
  listWorkItems(
    organization: string,
    project: string,
    ids: string,
    workItemType: string,
  ): Promise<ConnectorResult<{ value?: Record<string, unknown>[] }>>;
  /** People who can be assigned work in the project. */
  listProjectMembers(
    organization: string,
    project: string,
  ): Promise<ConnectorResult<{ value?: AdoTeamMember[] }>>;
}

type HttpRequestOperation = (
  account: string,
  parameters: VstsHttpRequestBodyParameters,
) => Promise<ConnectorResult<unknown>>;

/**
 * HttpRequest ("Send an HTTP request to Azure DevOps") is resolved at runtime: some data policies
 * remove it from codegen. The app still compiles, and `npm run check-setup` explains what's missing.
 */
function httpRequestOperation(): HttpRequestOperation {
  const candidate = (AzureDevOpsService as unknown as Record<string, unknown>).HttpRequest;
  if (typeof candidate !== "function") {
    throw new Error(
      "The Azure DevOps connector in this environment doesn't include \"Send an HTTP request to Azure DevOps\" (HttpRequest). " +
        "Ask your admin to allow it in the data policy, then re-add the connector.",
    );
  }
  return (candidate as HttpRequestOperation).bind(AzureDevOpsService);
}

export function createAzureDevOpsConnector(): AzureDevOpsConnector {
  return {
    httpRequest: (organization, request) =>
      httpRequestOperation()(organization, request as VstsHttpRequestBodyParameters),
    createWorkItem: (organization, project, workItemType, body) =>
      AzureDevOpsService.CreateWorkItem(organization, project, workItemType, body as CreateWorkItemRequest),
    updateWorkItem: (organization, id, body, project, workItemType) =>
      AzureDevOpsService.UpdateWorkItem(organization, id, body as UpdateWorkItemRequest, project, workItemType),
    addWorkItemLink: (organization, project, workItemType, workItemId, link) =>
      AzureDevOpsService.AddWorkItemLinkAsync(
        organization,
        project,
        workItemType,
        workItemId,
        link as AddWorkItemLinkRequest,
      ),
    listWorkItems: async (organization, project, ids, workItemType) => {
      const result = await AzureDevOpsService.ListWorkItems(organization, project, ids, workItemType);
      return { ...result, data: result.data as { value?: Record<string, unknown>[] } | undefined };
    },
    listProjectMembers: (organization, project) =>
      AzureDevOpsService.ListBuildRequestersAsync(organization, project),
  };
}
