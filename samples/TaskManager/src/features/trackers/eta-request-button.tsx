import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { appLink } from "@/lib/app-links";
import { errorText } from "@/lib/errors";
import { requestWorkItemEta, renderEtaMessage, type EtaRequest } from "@/lib/teams";
import { appConfig } from "@/config";
import { isFinishedState, type WorkItem } from "@/lib/work-items-data";

const ETA_REQUEST_COOLDOWN_MS = 5 * 60_000;
const etaRequestCooldowns = new Map<string, number>();

/** Strips the message HTML for the confirmation preview (text only, never rendered as HTML). */
function previewText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent?.trim() ?? "";
}

/**
 * "Request ETA" — a Teams connector showcase. Shows the exact message (from
 * VITE_ETA_MESSAGE_TEMPLATE) and asks for confirmation before anything is sent,
 * then rate-limits repeat requests for the same work item.
 */
export function EtaRequestButton({
  item,
  requesterName,
}: {
  item: WorkItem;
  requesterName: string;
}) {
  const confirm = useConfirm();
  const [requestedUntil, setRequestedUntil] = useState<number | null>(() => {
    const stored = etaRequestCooldowns.get(item.id);
    return stored && stored > Date.now() ? stored : null;
  });

  const workItemId = item.id.replace(/^#/, "").trim();
  const request: EtaRequest = {
    recipient: item.assigneeEmail ?? "",
    assigneeName: item.assignee ?? "there",
    requesterName,
    workItemId,
    workItemTitle: item.title,
    workItemUrl: appLink({ tab: "board", workItem: workItemId }),
  };

  const mutation = useMutation({
    mutationFn: () => requestWorkItemEta(request),
    onSuccess: () => {
      const until = Date.now() + ETA_REQUEST_COOLDOWN_MS;
      etaRequestCooldowns.set(item.id, until);
      setRequestedUntil(until);
      toast.success(`ETA request sent to ${item.assignee}.`);
    },
    onError: (error) => {
      toast.error("Couldn’t send the ETA request.", {
        description: errorText(error, "Teams did not respond."),
      });
    },
  });

  useEffect(() => {
    if (!requestedUntil) return;
    const remaining = requestedUntil - Date.now();
    const clear = () => {
      etaRequestCooldowns.delete(item.id);
      setRequestedUntil(null);
    };
    if (remaining <= 0) {
      clear();
      return;
    }
    const timeout = window.setTimeout(clear, remaining);
    return () => window.clearTimeout(timeout);
  }, [requestedUntil, item.id]);

  const available =
    !item.targetDate && !isFinishedState(item.state) && Boolean(item.assignee?.trim());
  if (!available) return null;

  const recentlyRequested = requestedUntil !== null && requestedUntil > Date.now();

  async function send() {
    let preview: string;
    try {
      preview = previewText(renderEtaMessage(appConfig.teams.etaMessageTemplate, request));
    } catch (error) {
      toast.error("Couldn’t prepare the ETA request.", { description: errorText(error) });
      return;
    }
    const ok = await confirm({
      title: `Send a Teams message to ${item.assignee}?`,
      description: `This message will be sent from the Teams connector's bot:\n\n“${preview}”`,
      confirmLabel: "Send message",
      cancelLabel: "Cancel",
    });
    if (ok) mutation.mutate();
  }

  return (
    <button
      type="button"
      className="w95-btn h-auto w-full px-1 py-0.5 text-[9px]"
      disabled={!item.assigneeEmail || mutation.isPending || recentlyRequested}
      title={
        recentlyRequested
          ? "ETA request sent; available again in five minutes"
          : item.assigneeEmail
            ? `Send ${item.assignee} a Teams message`
            : "Azure DevOps did not return an address for this owner"
      }
      onClick={() => {
        if (!recentlyRequested) void send();
      }}
    >
      {recentlyRequested ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <MessageSquareText className="h-3 w-3" />
      )}
      {recentlyRequested
        ? "ETA requested!"
        : mutation.isPending
          ? `Messaging ${item.assignee}...`
          : `Request ETA from ${item.assignee}`}
    </button>
  );
}
