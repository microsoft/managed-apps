import { Inbox, RefreshCw, Settings2 } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import type { LiveStatus } from "@/features/work-items/use-board-items";

/** What the page shows instead of the tabs while live data isn't available yet. */
export function LiveStatusView({
  status,
  errorMessage,
  onRefresh,
  onOpenSettings,
}: {
  status: Exclude<LiveStatus, "ready" | "config">;
  errorMessage: string;
  onRefresh: () => void;
  onOpenSettings: () => void;
}) {
  if (status === "loading") {
    return (
      <div className="w95-window px-3 py-3">
        <LoadingState rows={6} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="w95-window px-3 py-2">
        <ErrorState
          title="Couldn't load live work items"
          description={errorMessage}
          action={
            <div className="flex items-center gap-2">
              <button type="button" className="w95-btn w95-btn--default" onClick={onRefresh}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
              <button type="button" className="w95-btn" onClick={onOpenSettings}>
                <Settings2 className="h-3.5 w-3.5" /> Connection…
              </button>
            </div>
          }
        />
      </div>
    );
  }
  return (
    <div className="w95-window px-3 py-2">
      <EmptyState
        icon={Inbox}
        title="No work items found"
        description="The query returned no work items for the configured project and area path."
        action={
          <div className="flex items-center gap-2">
            <button type="button" className="w95-btn" onClick={onOpenSettings}>
              <Settings2 className="h-3.5 w-3.5" /> Adjust scope…
            </button>
            <button type="button" className="w95-btn" onClick={onRefresh}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>
        }
      />
    </div>
  );
}
