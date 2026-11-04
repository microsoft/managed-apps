import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CompletedDetailDialog, CompletedPanel } from "@/features/completed/completed-panel";
import type { CardMenuState } from "@/features/work-items/card-menu";
import { useNow } from "@/hooks/use-now";
import {
  COMPLETED_WINDOW_MONTHS,
  compareByCompletion,
  fetchCompletedWorkItems,
  workItemUrl,
  type AdoConfig,
} from "@/lib/ado";
import { buildEngineerSections } from "@/lib/engineer-identity";
import { errorText } from "@/lib/errors";
import { usePersonPhotos } from "@/lib/people-photos";
import { ENGINEERS, type WorkItem } from "@/lib/work-items-data";

const STALE_AFTER_MS = 5 * 60_000;
const NO_ITEMS: WorkItem[] = [];

/**
 * COMPLETED tab — a separate, lazy Azure DevOps query (only runs while the tab
 * is open) for work completed in the last few months, grouped by engineer.
 * Read-only: nothing here writes to Azure DevOps.
 */
export function CompletedTab({
  config,
  hasConn,
  onOpenMenu,
}: {
  config: AdoConfig;
  hasConn: boolean;
  onOpenMenu: (menu: CardMenuState) => void;
}) {
  const now = useNow(30_000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const completedQuery = useQuery({
    queryKey: [
      "ado-completed-work-items",
      config.organization,
      config.project,
      config.areaRoot,
      COMPLETED_WINDOW_MONTHS,
    ],
    queryFn: () => fetchCompletedWorkItems(config, COMPLETED_WINDOW_MONTHS),
    enabled: hasConn,
    retry: false,
    staleTime: STALE_AFTER_MS,
    refetchInterval: STALE_AFTER_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const completedItems = completedQuery.data?.items ?? NO_ITEMS;

  // Grouped by the same stable engineer identity the board uses; engineers with
  // nothing completed in the window are omitted.
  const sections = useMemo(
    () =>
      buildEngineerSections(
        completedItems.filter((it) => it.assignee),
        ENGINEERS,
      )
        .filter((section) => section.items.length > 0)
        .map((section) => ({
          ...section,
          items: [...section.items].sort(compareByCompletion),
        })),
    [completedItems],
  );

  // Completed work whose assignee Azure DevOps didn't return.
  const unassigned = useMemo(
    () => completedItems.filter((it) => !it.assignee).slice().sort(compareByCompletion),
    [completedItems],
  );

  const photos = usePersonPhotos(
    useMemo(
      () => sections.map((s) => s.email).filter((e): e is string => Boolean(e)),
      [sections],
    ),
  );

  return (
    <>
      <CompletedPanel
        sections={sections}
        unassigned={unassigned}
        result={completedQuery.data ?? null}
        loading={completedQuery.isLoading}
        fetching={completedQuery.isFetching}
        error={completedQuery.isError ? errorText(completedQuery.error, "Couldn't reach Azure DevOps.") : null}
        now={now}
        photos={photos}
        config={config}
        onRefresh={() => void completedQuery.refetch()}
        onOpenItem={(id) => setSelectedId(id)}
        onCardContextMenu={(item, x, y) => onOpenMenu({ id: item.id, x, y, kind: "link", item })}
      />
      <CompletedDetailDialog
        item={completedItems.find((it) => it.id === selectedId) ?? null}
        adoUrl={selectedId ? workItemUrl(config, selectedId) : null}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}
