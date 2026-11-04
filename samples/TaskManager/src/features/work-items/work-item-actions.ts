import { toast } from "sonner";
import { workItemUrl, type AdoConfig } from "@/lib/ado";
import { appLink } from "@/lib/app-links";
import { copyLinksToClipboard } from "@/lib/clipboard";
import { safeUrl } from "@/lib/safe-url";
import { useAppStore } from "@/lib/store";
import type { WorkItem } from "@/lib/work-items-data";

export function openWorkItemDetails(item: WorkItem) {
  useAppStore.getState().openWorkItem(item.id, item);
}

export function closeWorkItemDetails() {
  useAppStore.getState().closeWorkItem();
}

function noLinkToast(id: string, hasConnection: boolean) {
  toast.error(`Couldn't build a link for work item ${id}`, {
    description: hasConnection
      ? "Azure DevOps didn't give this work item a usable id."
      : "Connect an Azure DevOps organization and project first.",
  });
}

/**
 * Copies a NAMED link to a work item ("123: Title [Open in Azure DevOps]") plus a
 * link that opens it in this app. Writes text/html and text/plain, degrading to
 * plain text where the rich write is refused, and reports what happened.
 */
export async function copyWorkItemLink(
  config: AdoConfig,
  hasConnection: boolean,
  id: string,
  title: string,
): Promise<void> {
  const url = safeUrl(workItemUrl(config, id));
  if (!url) {
    noLinkToast(id, hasConnection);
    return;
  }
  const trimmed = title.trim();
  const placeholder = `Work item ${id}`;
  const label = !trimmed || trimmed === placeholder ? placeholder : `${id}: ${trimmed}`;
  try {
    const how = await copyLinksToClipboard([
      { url, label: `${label} [Open in Azure DevOps]` },
      {
        url: appLink({ tab: "board", workItem: id.replace(/^#/, "") }),
        label: "[Open in Task Manager]",
      },
    ]);
    const shown = label.length > 72 ? `${label.slice(0, 71)}…` : label;
    toast.success(`Copied “${shown}”`, {
      description:
        how === "rich"
          ? "Pastes as Azure DevOps and Task Manager links."
          : "Plain text only (this browser wouldn't allow formatted links).",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The browser blocked the copy.";
    toast.error(`Couldn't copy the link to work item ${id}`, {
      description: `${message} The link is ${url}`,
    });
  }
}

/** Opens the work item in Azure DevOps in a new tab. */
export function openWorkItemInAdo(config: AdoConfig, hasConnection: boolean, id: string): void {
  const url = safeUrl(workItemUrl(config, id));
  if (!url) {
    noLinkToast(id, hasConnection);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
