import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { openWorkItemDetails } from "@/features/work-items/work-item-actions";
import { fetchLiveWorkItems, fetchWorkItem, type AdoConfig } from "@/lib/ado";
import { errorText } from "@/lib/errors";
import type { WorkItem } from "@/lib/work-items-data";

/** Data older than this is considered stale and triggers a refresh attempt. */
export const STALE_AFTER_MS = 5 * 60_000;

export type LiveStatus = "config" | "loading" | "error" | "empty" | "ready";

/**
 * The board's live work items. TanStack Query owns the connector data; `items`
 * mirrors the last successful result so writes can be shown optimistically
 * (and rolled back). A failed refresh never replaces good data on screen.
 */
export function useBoardItems(config: AdoConfig, hasConn: boolean, requestedWorkItemId: string | null) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["ado-work-items", config.organization, config.project, config.areaRoot, config.wiql],
    queryFn: () => fetchLiveWorkItems(config),
    enabled: hasConn,
    retry: false,
    staleTime: STALE_AFTER_MS,
    refetchInterval: STALE_AFTER_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (query.data) setItems(query.data.items);
  }, [query.data]);

  /**
   * The app-wide refresh: refetches the board query and invalidates the lazy
   * child/bug queries (only mounted ones refetch, so they stay lazy).
   */
  const refreshAll = useCallback(() => {
    void query.refetch();
    void queryClient.invalidateQueries({ queryKey: ["ado-child-counts"] });
    void queryClient.invalidateQueries({ queryKey: ["ado-child-work-items"] });
    void queryClient.invalidateQueries({ queryKey: ["ado-my-bugs"] });
  }, [query, queryClient]);

  // `?workItem=<id>` deep link: fetch that item and open its details once.
  const handledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedWorkItemId) {
      handledRef.current = null;
      return;
    }
    if (!hasConn) return;
    const requestKey = `${config.organization}\u0000${config.project}\u0000${requestedWorkItemId}`;
    if (handledRef.current === requestKey) return;
    handledRef.current = requestKey;
    let cancelled = false;
    void fetchWorkItem(config, requestedWorkItemId)
      .then((workItem) => {
        if (!cancelled) openWorkItemDetails(workItem);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(`Couldn't open work item ${requestedWorkItemId}`, {
          description: errorText(error, "Azure DevOps did not return the requested work item."),
        });
      });
    return () => {
      cancelled = true;
      if (handledRef.current === requestKey) handledRef.current = null;
    };
  }, [config, hasConn, requestedWorkItemId]);

  const hasGoodData = items.length > 0;
  let status: LiveStatus;
  if (!hasConn) status = "config";
  else if (query.isError && !hasGoodData) status = "error";
  else if (query.isLoading && !hasGoodData) status = "loading";
  else if (!hasGoodData) status = query.isFetching ? "loading" : "empty";
  else status = "ready";

  return {
    items,
    setItems,
    query,
    refreshAll,
    status,
    /** A failed refresh while good data stays on screen. */
    staleDataError: query.isError && hasGoodData ? errorText(query.error, "Couldn't reach Azure DevOps.") : null,
    errorMessage: errorText(
      query.error,
      "Couldn't reach Azure DevOps. Check the organization, project, and that the connection has access.",
    ),
    refresh: query.data
      ? {
          at: query.data.fetchedAt,
          durationMs: query.data.durationMs,
          total: query.data.idCount,
          shown: query.data.hydrated,
          pages: query.data.pages,
        }
      : null,
    capped: query.data?.capped ?? false,
  };
}
