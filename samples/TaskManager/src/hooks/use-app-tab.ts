import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { closeWorkItemDetails } from "@/features/work-items/work-item-actions";

export const APP_TABS = [
  "my-work",
  "board",
  "trackers",
  "triage",
  "completed",
  "retro",
  "feedback",
  "tags",
  "bulk-edit",
] as const;

export type AppTab = (typeof APP_TABS)[number];

export const DEFAULT_TAB: AppTab = "my-work";

/** Tabs shown only to users listed in admins.json (see src/lib/admins.ts). */
export const ADMIN_TABS: ReadonlySet<AppTab> = new Set<AppTab>(["completed", "retro", "tags", "bulk-edit"]);

export function isAppTab(value: string | null): value is AppTab {
  return value !== null && (APP_TABS as readonly string[]).includes(value);
}

/** Parses a `?workItem=` deep link (digits only). */
export function parseWorkItemParam(raw: string | null): string | null {
  const value = raw?.trim() ?? "";
  return /^\d+$/.test(value) ? value : null;
}

/**
 * The active tab, addressable as `?tab=<name>` so links can open a specific
 * tab and Back/Forward follow tab changes. `?workItem=<id>` opens the Board
 * with that work item's details. Invalid values are canonicalized away.
 */
export function useAppTab(): {
  tab: AppTab;
  setTab: (tab: AppTab) => void;
  requestedWorkItemId: string | null;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const rawWorkItem = searchParams.get("workItem");
  const requestedWorkItemId = parseWorkItemParam(rawWorkItem);
  const tab: AppTab = requestedWorkItemId ? "board" : isAppTab(rawTab) ? rawTab : DEFAULT_TAB;

  const setTab = useCallback(
    (nextTab: AppTab) => {
      if (nextTab === tab) return;
      const next = new URLSearchParams(searchParams);
      next.set("tab", nextTab);
      if (nextTab !== "trackers") next.delete("tracker");
      // A workItem deep link owns the initial Board destination only; explicit
      // navigation consumes it and dismisses its details window.
      next.delete("workItem");
      closeWorkItemDetails();
      setSearchParams(next, { flushSync: true, preventScrollReset: true });
    },
    [searchParams, setSearchParams, tab],
  );

  useEffect(() => {
    const invalidTab = rawTab !== null && !isAppTab(rawTab);
    const invalidWorkItem = rawWorkItem !== null && requestedWorkItemId === null;
    const workItemNeedsBoard = requestedWorkItemId !== null && rawTab !== "board";
    if (!invalidTab && !invalidWorkItem && !workItemNeedsBoard) return;
    const next = new URLSearchParams(searchParams);
    if (invalidWorkItem) next.delete("workItem");
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  }, [rawTab, rawWorkItem, requestedWorkItemId, searchParams, setSearchParams, tab]);

  return { tab, setTab, requestedWorkItemId };
}
