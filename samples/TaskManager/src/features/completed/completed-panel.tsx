import { CobwebIndicator } from "@/components/cobweb-indicator";
import { PersonAvatar as EngineerAvatar } from "@/components/person-avatar";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { DetailTagChips, TagChips } from "@/components/tag-chips";
import { useTagVisualFrameClasses } from "@/lib/tag-visuals";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineSectionHeading } from "@/components/w95-chrome";
import {
  formatDuration,
  formatRefreshTime,
  formatRelativeTime,
} from "@/lib/time-format";
import { Field } from "@/features/work-items/work-item-details";
import { useIsMenuTarget } from "@/hooks/use-menu-target";
import {
  COMPLETED_WINDOW_MONTHS,
  completionDate,
  workItemUrl,
  type AdoConfig,
  type FetchCompletedResult,
} from "@/lib/ado";
import { type EngineerSection } from "@/lib/engineer-identity";
import { safeUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { areaMeta, isAncientWorkItem, stateMeta, type WorkItem } from "@/lib/work-items-data";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, RefreshCw } from "lucide-react";

// Completion date, formatted for display. Returns null when Azure DevOps gave
// us no usable date — the UI then says so instead of inventing one.
function formatCompletedDate(item: WorkItem): string | null {
  const iso = completionDate(item);
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * COMPLETED tab — the Board's engineer region, over the separate completed-work
 * query: one window per engineer, same card styling / photos / zebra striping /
 * "Open in ADO" button / click-to-open detail window.
 *
 * Deliberate differences from the Board: no category backlog region, no
 * drag-and-drop (this is a historical record, so there is nothing to reassign),
 * and the ordering is by completion date rather than StackRank — which the
 * header says out loud.
 */
export function CompletedPanel({
  sections,
  unassigned,
  result,
  loading,
  fetching,
  error,
  now,
  photos,
  config,
  onRefresh,
  onOpenItem,
  onCardContextMenu,
}: {
  sections: EngineerSection[];
  unassigned: WorkItem[];
  result: FetchCompletedResult | null;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  now: number;
  photos: Record<string, string>;
  config: AdoConfig;
  onRefresh: () => void;
  onOpenItem: (id: string) => void;
  // Right-click on a completed card -> the link-only context menu.
  onCardContextMenu?: (item: WorkItem, x: number, y: number) => void;
}) {
  const total = sections.reduce((n, s) => n + s.items.length, 0) + unassigned.length;
  const windowStart = result?.since ? new Date(result.since) : null;

  // Which date field actually backed these results, stated honestly: the true
  // ClosedDate when ADO returned one for every item, otherwise the mix.
  const dateNote = result
    ? result.hydrated === 0
      ? ""
      : result.withClosedDate === result.hydrated
        ? "Completion dates are [Microsoft.VSTS.Common.ClosedDate]."
        : result.withClosedDate === 0
          ? "Azure DevOps returned no closed dates — showing [System.ChangedDate] (last changed)."
          : `Completion dates are [Microsoft.VSTS.Common.ClosedDate] where Azure DevOps returned one (${result.withClosedDate.toLocaleString()} of ${result.hydrated.toLocaleString()}), otherwise [System.ChangedDate].`
    : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Status strip: scope, count, sort order, and the refresh control. */}
      <div className="w95-panel flex shrink-0 flex-wrap items-center gap-2 px-2 py-2 text-[11px]">
        <span className="w95-status inline-flex items-center gap-1.5 font-bold">
          <CheckCircle2 className="h-3 w-3" />
          Completed work — last {COMPLETED_WINDOW_MONTHS} months
        </span>
        <span className="w95-status">
          <span className="font-bold">{total.toLocaleString()}</span>{" "}
          {total === 1 ? "work item" : "work items"} · Closed only
        </span>
        <span className="w95-status">Sorted by most recently completed first</span>
        {windowStart && (
          <span className="w95-status">
            Since {windowStart.toLocaleDateString()}
          </span>
        )}
        {result && (
          <span className="w95-status">
            Refreshed {formatRefreshTime(result.fetchedAt)} (
            {formatRelativeTime(result.fetchedAt, now)}) in{" "}
            {formatDuration(result.durationMs)}
          </span>
        )}
        <button
          type="button"
          className="w95-btn ml-auto shrink-0"
          onClick={onRefresh}
          disabled={fetching}
        >
          {fetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {fetching ? "Refreshing…" : "Refresh"}
        </button>
        {dateNote && (
          <span className="w95-status w-full text-[10px] text-[#404040]">
            {dateNote}
          </span>
        )}
        {result?.capped && (
          <span className="w95-status inline-flex w-full items-center gap-1 text-[10px] font-bold text-[#a80000]">
            <AlertTriangle className="h-3 w-3" /> Azure DevOps capped this
            result set — some completed work items are not shown.
          </span>
        )}
        {error && (
          <span className="w95-status inline-flex w-full items-center gap-1 text-[10px] font-bold text-[#a80000]">
            <AlertTriangle className="h-3 w-3" /> Last refresh failed — {error}
            {result ? " (showing the last successful result)" : ""}
          </span>
        )}
      </div>

      {loading && !result ? (
        <div className="w95-window px-3 py-3">
          <LoadingState rows={5} />
        </div>
      ) : !result && error ? (
        <div className="w95-window px-3 py-2">
          <ErrorState
            title="Couldn't load completed work items"
            description={error}
            action={
              <button
                type="button"
                className="w95-btn w95-btn--default"
                onClick={onRefresh}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            }
          />
        </div>
      ) : total === 0 ? (
        <div className="w95-window px-3 py-2">
          <EmptyState
            icon={CheckCircle2}
            title="No completed work items"
            description={`No User Stories under this area tree were closed in the last ${COMPLETED_WINDOW_MONTHS} months.`}
            action={
              <button type="button" className="w95-btn" onClick={onRefresh}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
            }
          />
        </div>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col">
          <InlineSectionHeading
            title="Completed by Engineer"
            subtitle="Closed work items, newest completion first"
          />
          <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-x-1.5 gap-y-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1900px]:grid-cols-6 min-[2400px]:grid-cols-7">
            {sections.map((section) => (
              <CompletedGroup
                key={section.key}
                name={section.name}
                photoUrl={photos[section.email ?? ""]}
                items={section.items}
                config={config}
                onOpenItem={onOpenItem}
                onCardContextMenu={onCardContextMenu}
              />
            ))}
            {unassigned.length > 0 && (
              <CompletedGroup
                name="Unassigned / other"
                items={unassigned}
                config={config}
                onOpenItem={onOpenItem}
                onCardContextMenu={onCardContextMenu}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** One engineer's window of completed work items. */
function CompletedGroup({
  name,
  photoUrl,
  items,
  config,
  onOpenItem,
  onCardContextMenu,
}: {
  name: string;
  photoUrl?: string;
  items: WorkItem[];
  config: AdoConfig;
  onOpenItem: (id: string) => void;
  onCardContextMenu?: (item: WorkItem, x: number, y: number) => void;
}) {
  return (
    <div className="w95-window flex flex-col">
      <div className="w95-titlebar">
        <EngineerAvatar name={name} photoUrl={photoUrl} />
        <p className="min-w-0 flex-1 truncate">{name}</p>
        <span className="ml-auto shrink-0 whitespace-nowrap px-1 text-[10px] font-normal">
          {items.length} {items.length === 1 ? "work item" : "work items"}
        </span>
      </div>
      <div className="w95-in mt-[3px] max-h-[13rem] min-h-0 flex-1 space-y-1 overflow-y-auto p-1">
        {items.map((item, i) => (
          <CompletedCard
            key={item.id}
            item={item}
            zebra={i % 2 === 1}
            adoUrl={workItemUrl(config, item.id)}
            onOpen={() => onOpenItem(item.id)}
            onContextMenu={
              onCardContextMenu
                ? (x, y) => onCardContextMenu(item, x, y)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A completed work item card — the Board's StoryCard styling (bevel, category
 * accent, zebra band, "Open in ADO" button, click to open the properties
 * window), minus drag-and-drop, plus the state and the real completion date.
 */
function CompletedCard({
  item,
  adoUrl,
  onOpen,
  onContextMenu,
  zebra = false,
}: {
  item: WorkItem;
  adoUrl: string | null;
  onOpen: () => void;
  // Right-click: opens the link-only Win95 menu ("Copy link"). Completed work
  // is read-only, so no write action is offered here.
  onContextMenu?: (x: number, y: number) => void;
  zebra?: boolean;
}) {
  const area = areaMeta(item.area);
  const state = stateMeta(item.state);
  const href = safeUrl(adoUrl);
  const completed = formatCompletedDate(item);
  const tagVisualFrameClass = useTagVisualFrameClasses(item);
  // Completed work gets the cobweb too: it is a comment on how long the item
  // has EXISTED, not on whether anyone still owes it work.
  const ancient = isAncientWorkItem(item);
  // The link-only menu still marks its card, so "which row did I click?" is
  // answered on this read-only tab too.
  const menuTarget = useIsMenuTarget(item.id);
  return (
    <div
      onClick={onOpen}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(e.clientX, e.clientY);
            }
          : undefined
      }
      title={
        onContextMenu
          ? "Click to open · right-click to copy the link · completed work is read-only"
          : "Click to open · completed work is read-only"
      }
      className={cn(
        // `relative` is the positioning context for the corner cobweb below.
        "w95-item group relative flex cursor-default items-start gap-1 border-l-4 px-1.5 py-0.5",
        zebra ? "bg-[#e4e1dc]" : "bg-[#c0c0c0]",
        "shadow-[inset_-1px_-1px_0_0_#0a0a0a,inset_1px_1px_0_0_#ffffff,inset_-2px_-2px_0_0_#808080,inset_2px_2px_0_0_#dfdfdf]",
        area?.border,
        menuTarget && "w95-menutarget",
        tagVisualFrameClass,
      )}
    >
      {ancient && <CobwebIndicator seed={item.id} />}
      {/* Centred to match the board card's drag handle — same leading-glyph
          slot, same alignment, so the two card types stay a matched family. */}
      <CheckCircle2 className="h-3 w-3 shrink-0 self-center text-[#808080]" />
      <div className="min-w-0 flex-1">
        <p className="flex items-start gap-1 text-[10px] font-bold leading-tight">
          <span className="min-w-0">{item.title}</span>
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-none">
          <span
            className={cn(
              "inline-flex items-center gap-1 px-1 py-px text-[9px] font-medium ring-1 ring-black/20",
              state.badge,
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", state.dot)} />
            {item.state}
          </span>
          <TagChips item={item} />
          {/* Real date only — an item ADO gave no date for says so. */}
          <span className="inline-flex items-center gap-1 text-[9px] text-[#404040]">
            <Clock className="h-2.5 w-2.5" />
            {completed ?? "date unavailable"}
          </span>
          <span
            className={cn(
              "ml-auto shrink-0 px-1 py-px text-[9px] font-medium ring-1 ring-black/20",
              area?.tag,
            )}
          >
            {area?.name}
          </span>
        </div>
      </div>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Open ${item.id} in Azure DevOps`}
          aria-label={`Open work item ${item.id} in Azure DevOps`}
          className="w95-btn w95-iconbtn mt-px text-black"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

/**
 * Read-only properties window for a completed work item. The Completed tab is a
 * historical view, so there is no editing and no write path here at all — the
 * only action is opening the real work item in Azure DevOps.
 *
 * Long unbroken titles/descriptions WRAP inside the frame (`break-words` +
 * `min-w-0` on the flex chain) rather than stretching the window.
 */
export function CompletedDetailDialog({
  item,
  adoUrl,
  onClose,
}: {
  item: WorkItem | null;
  adoUrl: string | null;
  onClose: () => void;
}) {
  const area = item ? areaMeta(item.area) : null;
  const href = safeUrl(adoUrl);
  const completed = item ? formatCompletedDate(item) : null;

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w95-dialog max-w-lg gap-0 overflow-hidden">
        {item && (
          <>
            <DialogHeader className="min-w-0 space-y-0">
              <div className="w95-titlebar">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <DialogTitle className="min-w-0 flex-1 truncate text-left text-[12px] font-bold text-white">
                  {item.id} — Completed work item
                </DialogTitle>
                <button
                  type="button"
                  className="w95-titlebtn text-[10px] leading-none"
                  onClick={onClose}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <DialogDescription className="sr-only">
                Read-only properties for a completed work item.
              </DialogDescription>
            </DialogHeader>

            <div className="min-w-0 space-y-3 px-2 py-2.5">
              <div className="w95-panel flex min-w-0 flex-wrap items-center gap-2 px-2 py-1.5 text-[11px]">
                <span
                  className={cn(
                    "px-1 py-px font-medium ring-1 ring-black/20",
                    area?.tag,
                  )}
                >
                  {area?.name}
                </span>
                <span className="min-w-0 break-all font-mono text-[10px]">
                  {item.areaPath || "no area path returned"}
                </span>
                <span
                  className={cn(
                    "ml-auto",
                    !item.assignee && "text-[#606060]",
                  )}
                >
                  {item.assignee ? `Completed by ${item.assignee}` : "Unassigned"}
                </span>
              </div>

              <Field label="Title">
                <div className="w95-field min-w-0 break-words px-1.5 py-1 text-[11px] [overflow-wrap:anywhere]">
                  {item.title}
                </div>
              </Field>

              <Field label="Description">
                <div className="w95-field max-h-40 min-w-0 overflow-y-auto whitespace-pre-wrap break-words px-1.5 py-1 text-[11px] [overflow-wrap:anywhere]">
                  {item.description || "No description"}
                </div>
              </Field>

              <div className="grid min-w-0 grid-cols-2 gap-3">
                <Field label="State">
                  <div className="w95-field min-w-0 break-words px-1.5 py-1 text-[11px]">
                    {item.state || "unknown"}
                  </div>
                </Field>
                <Field label="Completed">
                  <div className="w95-field min-w-0 break-words px-1.5 py-1 text-[11px]">
                    {completed ?? "date unavailable"}
                  </div>
                </Field>
              </div>

              <Field label="Tags">
                <div className="w95-field flex min-w-0 flex-wrap items-center gap-1 px-1.5 py-1">
                  {item.tags && item.tags.length > 0 ? (
                    <DetailTagChips tags={item.tags} />
                  ) : (
                    <span className="text-[11px] italic text-[#404040]">
                      No tags
                    </span>
                  )}
                </div>
              </Field>
            </div>

            <DialogFooter className="gap-2 px-2 pb-2">
              {href && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w95-btn text-black"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open in ADO
                </a>
              )}
              <button
                type="button"
                className="w95-btn w95-btn--default"
                onClick={onClose}
              >
                Close
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
