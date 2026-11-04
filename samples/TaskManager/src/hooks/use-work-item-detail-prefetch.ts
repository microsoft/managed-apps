import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { prepareRichText } from "@/lib/rich-text-document-cache";
import {
  ADO_WORK_ITEM_TYPE,
  fetchDescendantWorkItems,
  fetchProjectMembers,
  fetchWorkItemTypeStates,
  type AdoConfig,
} from "@/lib/ado";
import type { WorkItem } from "@/lib/work-items-data";
import { useAppStore } from "@/lib/store";

const HOVER_INTENT_MS = 100;
let descendantPrefetchRunning = false;
let queuedDescendantPrefetch: (() => Promise<void>) | null = null;

function queueDescendantPrefetch(task: () => Promise<void>) {
  if (descendantPrefetchRunning) {
    queuedDescendantPrefetch = task;
    return;
  }
  descendantPrefetchRunning = true;
  void task().finally(() => {
    descendantPrefetchRunning = false;
    const next = queuedDescendantPrefetch;
    queuedDescendantPrefetch = null;
    if (next) queueDescendantPrefetch(next);
  });
}

export function useWorkItemDetailPrefetch(config: AdoConfig) {
  const queryClient = useQueryClient();
  const timerRef = useRef<number | null>(null);

  const cancelPrefetch = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedulePrefetch = useCallback(
    (item: WorkItem, prepareDialog: boolean) => {
      cancelPrefetch();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (prepareDialog) useAppStore.getState().prepareWorkItem(item);
        const workItemType = item.workItemType?.trim() || ADO_WORK_ITEM_TYPE;
        const description = item.descriptionHtml ?? item.description;
        prepareRichText(description, /<[a-z][\s\S]*>/i.test(description));

        queueDescendantPrefetch(() =>
          queryClient.prefetchQuery({
            queryKey: [
              "ado-child-work-items",
              "tree",
              config.organization,
              config.project,
              item.id,
            ],
            queryFn: () => fetchDescendantWorkItems(config, [item.id]),
            staleTime: 5 * 60_000,
            gcTime: Infinity,
            retry: false,
          }),
        );
        void queryClient.prefetchQuery({
          queryKey: [
            "ado-work-item-type-states",
            config.organization,
            config.project,
            workItemType,
          ],
          queryFn: () => fetchWorkItemTypeStates(config, workItemType),
          staleTime: 30 * 60_000,
          gcTime: Infinity,
          retry: false,
        });
        void queryClient.prefetchQuery({
          queryKey: [
            "ado-project-members",
            config.organization,
            config.project,
          ],
          queryFn: () => fetchProjectMembers(config),
          staleTime: 30 * 60_000,
          gcTime: Infinity,
          retry: false,
        });
      }, HOVER_INTENT_MS);
    },
    [cancelPrefetch, config, queryClient],
  );
  const prefetch = useCallback(
    (item: WorkItem) => schedulePrefetch(item, true),
    [schedulePrefetch],
  );
  const prefetchNested = useCallback(
    (item: WorkItem) => schedulePrefetch(item, false),
    [schedulePrefetch],
  );

  useEffect(() => cancelPrefetch, [cancelPrefetch]);

  return { prefetch, prefetchNested, cancelPrefetch };
}
