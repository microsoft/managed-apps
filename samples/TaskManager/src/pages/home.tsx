import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Hammer,
  LayoutGrid,
  ListChecks,
  ListTree,
  MessageSquarePlus,
  Tags,
  UserCircle2,
} from "lucide-react";
import { LoadingState } from "@/components/states";
import { TabButton } from "@/components/w95-chrome";
import { BoardTab } from "@/features/board/board-tab";
import { useOpenFeedbackCount } from "@/features/feedback/use-open-feedback-count";
import { MyWorkPanel } from "@/features/my-work/my-work-panel";
import { SettingsDialog } from "@/features/settings/settings-dialog";
import { SetupScreen } from "@/features/settings/setup-screen";
import { AppTitleBar } from "@/features/shell/app-title-bar";
import { FakeErrorDialog } from "@/features/shell/fake-error-dialog";
import type { FakeError } from "@/features/shell/fake-errors";
import { LiveStatusView } from "@/features/shell/live-status";
import { RefreshPanel } from "@/features/shell/refresh-panel";
import type { CardMenuState } from "@/features/work-items/card-menu";
import { STALE_AFTER_MS, useBoardItems } from "@/features/work-items/use-board-items";
import { useWorkItemWrites } from "@/features/work-items/use-work-item-writes";
import { copyWorkItemLink, openWorkItemDetails } from "@/features/work-items/work-item-actions";
import { WorkItemDetailsLayer } from "@/features/work-items/work-item-details";
import { useNestedItemMenu } from "@/features/work-items/use-nested-item-menu";
import { WorkItemMenu } from "@/features/work-items/work-item-menu";
import { useAdoConnection } from "@/hooks/use-ado-connection";
import { ADMIN_TABS, DEFAULT_TAB, useAppTab, type AppTab } from "@/hooks/use-app-tab";
import { MenuTargetContext } from "@/hooks/use-menu-target";
import { useNow } from "@/hooks/use-now";
import { useWorkItemDetailPrefetch } from "@/hooks/use-work-item-detail-prefetch";
import { isKnownAreaCode } from "@/lib/ado";
import { useIsAdmin } from "@/lib/admins";
import { useCurrentUserState } from "@/lib/current-user";
import { buildEngineerSections } from "@/lib/engineer-identity";
import { applyFavicon } from "@/lib/win95-icon";
import { ENGINEERS, type WorkItem } from "@/lib/work-items-data";
import "@/styles/win95.css";

// Less-used tabs load on first visit, keeping the initial bundle small.
const TrackersPanel = lazy(() => import("@/features/trackers/trackers-panel").then((m) => ({ default: m.TrackersPanel })));
const TriagePanel = lazy(() => import("@/features/triage/triage-panel").then((m) => ({ default: m.TriagePanel })));
const CompletedTab = lazy(() => import("@/features/completed/completed-tab").then((m) => ({ default: m.CompletedTab })));
const RetroBoard = lazy(() => import("@/features/retro/retro-board").then((m) => ({ default: m.RetroBoard })));
const FeedbackPanel = lazy(() => import("@/features/feedback/feedback-panel").then((m) => ({ default: m.FeedbackPanel })));
const TagsPanel = lazy(() => import("@/features/tags/tags-panel").then((m) => ({ default: m.TagsPanel })));
const BulkEditPanel = lazy(() => import("@/features/bulk-edit/bulk-edit-panel").then((m) => ({ default: m.BulkEditPanel })));

interface TabSpec {
  id: AppTab;
  label: string;
  icon: ReactNode;
  count?: number;
  className?: string;
}

/**
 * The app shell: title bar, tab strip and the active tab. Data, writes and each
 * tab's UI live in `src/features/*`; this file only wires them together.
 */
export function HomePage() {
  const connection = useAdoConnection();
  const config = connection.config;
  const hasConn = connection.isConfigured;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fakeError, setFakeError] = useState<FakeError | null>(null);
  const { tab: requestedTab, setTab, requestedWorkItemId } = useAppTab();
  // Admin tabs are hidden for everyone not listed in admins.json (UI only).
  const isAdmin = useIsAdmin();
  const tab: AppTab = !isAdmin && ADMIN_TABS.has(requestedTab) ? DEFAULT_TAB : requestedTab;
  const now = useNow(30_000);
  const detailPrefetch = useWorkItemDetailPrefetch(config);
  const { user: currentUser } = useCurrentUserState(true);

  const board = useBoardItems(config, hasConn, requestedWorkItemId);
  const { items, setItems, query } = board;
  const writes = useWorkItemWrites({ config, items, setItems, refetch: () => query.refetch() });

  // The ONE work-item context menu, and My Work's multi-selection it may act on.
  const [cardMenu, setCardMenu] = useState<CardMenuState | null>(null);
  const [myWorkSelection, setMyWorkSelection] = useState<WorkItem[]>([]);
  const closeMenu = useCallback(() => setCardMenu(null), []);
  const openNestedItemMenu = useNestedItemMenu(setCardMenu, writes.writeChildItem);
  const feedbackCount = useOpenFeedbackCount();

  useEffect(() => {
    applyFavicon();
  }, []);

  // The menu is anchored to a card in the current view; switching tabs dismisses it.
  useEffect(() => {
    setCardMenu(null);
  }, [tab]);

  const allEngineerSections = useMemo(() => buildEngineerSections(items, ENGINEERS), [items]);
  const uncategorizedCount = useMemo(
    () => items.filter((it) => !isKnownAreaCode(it.area)).length,
    [items],
  );

  const tabs: TabSpec[] = [
    { id: "my-work", label: "My Work", icon: <UserCircle2 className="h-3.5 w-3.5" /> },
    { id: "board", label: "Board", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
    { id: "trackers", label: "Trackers", icon: <ListTree className="h-3.5 w-3.5" /> },
    { id: "triage", label: "Triage", icon: <ClipboardCheck className="h-3.5 w-3.5" />, count: uncategorizedCount },
    { id: "completed", label: "Completed", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    { id: "retro", label: "Retrospective", icon: <Hammer className="h-3.5 w-3.5" /> },
    {
      id: "feedback",
      label: "Feedback",
      icon: <MessageSquarePlus className="h-3.5 w-3.5" />,
      count: feedbackCount,
      className: "sm:ml-auto",
    },
    { id: "tags", label: "Tags", icon: <Tags className="h-3.5 w-3.5" /> },
    { id: "bulk-edit", label: "Bulk edit", icon: <ListChecks className="h-3.5 w-3.5" /> },
  ];

  return (
    <MenuTargetContext.Provider value={cardMenu?.id ?? null}>
      <div className="w95 flex h-screen flex-col overflow-hidden text-[12px] text-black">
        <AppTitleBar
          user={currentUser}
          onOpenSettings={() => setSettingsOpen(true)}
          onFakeError={setFakeError}
        />

        <main className="flex w-full min-h-0 flex-1 flex-col gap-3 overflow-hidden p-2.5">
          {board.status === "config" && <SetupScreen onOpenSettings={() => setSettingsOpen(true)} />}

          {board.status !== "config" && board.status !== "ready" && (
            <LiveStatusView
              status={board.status}
              errorMessage={board.errorMessage}
              onRefresh={board.refreshAll}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}

          {board.status === "ready" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="w95-tabstrip shrink-0">
                {tabs.filter((spec) => isAdmin || !ADMIN_TABS.has(spec.id)).map((spec) => (
                  <TabButton
                    key={spec.id}
                    active={tab === spec.id}
                    onClick={() => setTab(spec.id)}
                    icon={spec.icon}
                    label={spec.label}
                    count={spec.count}
                    className={spec.className}
                  />
                ))}
              </div>

              <div className="w95-window flex min-h-0 flex-1 flex-col gap-3 p-3 pt-[18px]">
                {(tab === "my-work" || tab === "board") && (
                  <RefreshPanel
                    refresh={board.refresh}
                    now={now}
                    fetching={query.isFetching}
                    canRefresh={hasConn}
                    onRefresh={board.refreshAll}
                    capped={board.capped}
                    writeError={writes.writeError}
                    writingCount={Object.keys(writes.writing).length}
                    fetchError={board.staleDataError}
                    staleAfterMs={STALE_AFTER_MS}
                  />
                )}

                {tab === "my-work" && (
                  <MyWorkPanel
                    items={items}
                    config={config}
                    onPrefetchItem={detailPrefetch.prefetch}
                    onPrefetchNestedItem={detailPrefetch.prefetchNested}
                    onCancelPrefetch={detailPrefetch.cancelPrefetch}
                    writing={writes.writing}
                    onOpenItem={openWorkItemDetails}
                    onCardContextMenu={(item, x, y) => setCardMenu({ id: item.id, x, y, kind: "board" })}
                    onChildContextMenu={(child, x, y, onWrite) =>
                      setCardMenu({ id: child.id, x, y, kind: "child", item: child, childType: child.workItemType, onWrite })
                    }
                    onBugContextMenu={(bug, x, y, onWrite) =>
                      setCardMenu({
                        id: bug.id,
                        x,
                        y,
                        kind: "child",
                        item: bug,
                        childType: bug.workItemType,
                        canDelete: false,
                        onWrite,
                      })
                    }
                    onSelectionChange={setMyWorkSelection}
                    writeChild={writes.writeChildItem}
                  />
                )}

                {tab === "board" && (
                  <BoardTab
                    items={items}
                    config={config}
                    allEngineerSections={allEngineerSections}
                    writes={writes}
                    detailPrefetch={detailPrefetch}
                    menuOpen={cardMenu !== null}
                    onOpenMenu={setCardMenu}
                    onCloseMenu={closeMenu}
                  />
                )}

                <Suspense fallback={<LoadingState rows={5} />}>
                {tab === "trackers" && (
                  <TrackersPanel
                    config={config}
                    requesterName={currentUser?.displayName ?? "A teammate"}
                    onOpenItem={openWorkItemDetails}
                  />
                )}

                {tab === "triage" && (
                  <div className="min-h-0 flex-1 overflow-y-auto pr-1 xl:overflow-hidden xl:pr-0">
                    <TriagePanel
                      items={items}
                      config={config}
                      onPrefetchItem={detailPrefetch.prefetch}
                      onCancelPrefetch={detailPrefetch.cancelPrefetch}
                      onWritten={() => query.refetch()}
                      onOpenItem={openWorkItemDetails}
                      onCardContextMenu={(item, x, y, source) =>
                        setCardMenu({ id: item.id, x, y, kind: "link", item, canToggleTags: source === "recent" })
                      }
                    />
                  </div>
                )}

                {tab === "completed" && (
                  <CompletedTab config={config} hasConn={hasConn} onOpenMenu={setCardMenu} />
                )}

                {tab === "retro" && <RetroBoard />}

                {tab === "feedback" && <FeedbackPanel />}

                {tab === "tags" && (
                  <TagsPanel
                    items={items}
                    onPrefetchItem={detailPrefetch.prefetch}
                    onCancelPrefetch={detailPrefetch.cancelPrefetch}
                    onOpenItem={openWorkItemDetails}
                    onCardContextMenu={(item, x, y) =>
                      setCardMenu({ id: item.id, x, y, kind: "link", item, canToggleTags: true })
                    }
                  />
                )}

                {tab === "bulk-edit" && <BulkEditPanel items={items} writeItems={writes.writeItems} />}
                </Suspense>
              </div>
            </div>
          )}
        </main>

        <WorkItemMenu
          cardMenu={cardMenu}
          setCardMenu={setCardMenu}
          items={items}
          config={config}
          hasConn={hasConn}
          myWorkSelection={myWorkSelection}
          clearSelection={() => setMyWorkSelection([])}
          writes={writes}
        />

        <WorkItemDetailsLayer
          items={items}
          config={config}
          hasConnection={hasConn}
          currentUser={currentUser}
          engineerSections={allEngineerSections}
          onNestedContextMenu={openNestedItemMenu}
          onDeleteItem={writes.deleteChildItem}
          onRefreshItem={writes.refreshWorkItemDetails}
          onSaveItem={writes.saveWorkItemDetails}
          onCopyLink={(item) => copyWorkItemLink(config, hasConn, item.id, item.title)}
        />

        <FakeErrorDialog error={fakeError} onClose={() => setFakeError(null)} />
        <SettingsDialog
          open={settingsOpen}
          initial={config}
          isOverridden={connection.isOverridden}
          onClose={() => setSettingsOpen(false)}
          onApply={(next) => {
            connection.save(next);
            setSettingsOpen(false);
          }}
          onReset={() => {
            connection.reset();
            setSettingsOpen(false);
          }}
        />
      </div>
    </MenuTargetContext.Provider>
  );
}
