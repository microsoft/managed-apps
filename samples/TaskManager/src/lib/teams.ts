import { connectorError, connectors } from "@/connectors";
import { appConfig } from "@/config";
import { escapeHtml } from "@/lib/clipboard";
import { safeUrl } from "@/lib/safe-url";

export interface EtaRequest {
  recipient: string;
  assigneeName: string;
  requesterName: string;
  workItemId: string;
  workItemTitle: string;
  workItemUrl: string;
}

/**
 * Renders the ETA message template (`VITE_ETA_MESSAGE_TEMPLATE`) as HTML.
 * Placeholders: {assignee}, {requester}, {id}, {title}, {link}. Every value is
 * HTML-escaped; {link} becomes an anchor to the work item ("{id}: {title}").
 */
export function renderEtaMessage(template: string, request: EtaRequest): string {
  const href = safeUrl(request.workItemUrl);
  if (!href || !/^https:\/\//i.test(href)) {
    throw new Error("The work item link is not a valid https URL.");
  }
  const label = `${request.workItemId}: ${request.workItemTitle}`;
  const values: Record<string, string> = {
    assignee: escapeHtml(request.assigneeName),
    requester: escapeHtml(request.requesterName),
    id: escapeHtml(request.workItemId),
    title: escapeHtml(request.workItemTitle),
    link: `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`,
  };
  const body = escapeHtml(template).replace(
    /\{(assignee|requester|id|title|link)\}/g,
    (_, key: string) => values[key],
  );
  return `<p>${body}</p>`;
}

/** Sends the ETA request as a Teams chat message from the connector's bot. */
export async function requestWorkItemEta(
  request: EtaRequest,
  template: string = appConfig.teams.etaMessageTemplate,
): Promise<void> {
  if (!request.recipient.trim()) {
    throw new Error("Azure DevOps did not return an address for this owner.");
  }
  const message = renderEtaMessage(template, request);
  const result = await connectors().teams.postChatMessage(request.recipient, message);
  if (!result.success) {
    throw connectorError(result.error, "Teams did not accept the ETA request.");
  }
}
