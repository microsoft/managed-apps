import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, Hash, Loader2, RefreshCw, Timer } from "lucide-react";
import { formatDuration, formatRefreshTime, formatRelativeTime } from "@/lib/time-format";

/**
 * The refresh control and the whole info/telemetry panel, mounted within the
 * My Work and Board tabs that consume the refreshed work-item data.
 *
 * It keeps every reading it had in the old body card: connection scope, the
 * live work-item count, exact AND relative refresh timestamps, refresh
 * duration, the query total (excluding Closed/Removed), page count, the honest
 * StackRank sort indicator, the truncation warning, and any write failure.
 */
export function RefreshPanel({
  refresh,
  now,
  fetching,
  canRefresh,
  onRefresh,
  capped,
  writeError,
  writingCount,
  fetchError,
  staleAfterMs,
}: {
  refresh: {
    at: number;
    durationMs: number;
    total: number;
    shown: number;
    pages: number;
  } | null;
  now: number;
  fetching: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
  capped: boolean;
  writeError: string | null;
  writingCount: number;
  /** A refresh that failed while good data stayed on screen (non-destructive). */
  fetchError: string | null;
  staleAfterMs: number;
}) {
  // Is the data on screen past its staleness horizon? (A refresh is attempted
  // automatically at that point; this just labels what the user is looking at.)
  const stale = refresh !== null && now - refresh.at > staleAfterMs;
  return (
    <div className="w95-panel mr-auto flex max-w-full flex-wrap items-center gap-1.5 px-1.5 py-1.5">
      <button
        type="button"
        className="w95-btn w95-btn--default shrink-0"
        onClick={onRefresh}
        disabled={!canRefresh || fetching}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", fetching && "animate-spin")} />
        Refresh
      </button>

      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        {/* The fetched work-item total is shown ONCE, by the "… work items
            returned" segment below (refresh.total = the true query total). */}
        {fetching && (
          <span className="w95-status inline-flex items-center gap-1">
            <RefreshCw className="h-3 w-3 animate-spin" /> Updating…
          </span>
        )}
        {writingCount > 0 && (
          <span className="w95-status inline-flex items-center gap-1 font-bold text-[#000080]">
            <Loader2 className="h-3 w-3 animate-spin" /> Writing {writingCount}{" "}
            {writingCount === 1 ? "change" : "changes"} to Azure DevOps…
          </span>
        )}

        {refresh ? (
          <>
            <span className="w95-status inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> Last refreshed
              <span className="font-bold">{formatRefreshTime(refresh.at)}</span>
              <span className="w95-field px-1 font-bold">
                {formatRelativeTime(refresh.at, now)}
              </span>
            </span>
            <span className="w95-status inline-flex items-center gap-1">
              <Timer className="h-3 w-3" /> Took
              <span className="font-bold">{formatDuration(refresh.durationMs)}</span>
            </span>
            <span className="w95-status inline-flex items-center gap-1">
              <Hash className="h-3 w-3" />
              <span className="font-bold">{refresh.total.toLocaleString()}</span>
              {refresh.total === 1 ? "work item" : "work items"} returned
              {refresh.shown !== refresh.total && (
                <span className="text-[#404040]">
                  · {refresh.shown.toLocaleString()} shown
                </span>
              )}
              {refresh.pages > 1 && (
                <span className="text-[#404040]">· {refresh.pages} pages</span>
              )}
            </span>
            {/* No sort indicator: ordering is always StackRank. */}
          </>
        ) : (
          <span className="w95-status text-[#404040]">
            Refresh timing appears here after the first successful load.
          </span>
        )}

        {/* A refresh that failed while the board kept its last good data. The
            board is NOT replaced by an error state — this says so plainly. */}
        {fetchError && (
          <span className="w95-status inline-flex items-center gap-1 font-bold text-[#a80000]">
            <AlertTriangle className="h-3 w-3" /> Refresh failed — still showing
            the last known good data. {fetchError}
          </span>
        )}
        {stale && !fetchError && !fetching && (
          <span className="w95-status inline-flex items-center gap-1 font-bold text-[#804000]">
            <Clock className="h-3 w-3" /> Data is more than 5 minutes old —
            refreshing…
          </span>
        )}

        {capped && (
          <span className="w95-status inline-flex items-center gap-1 font-bold text-[#a80000]">
            <AlertTriangle className="h-3 w-3" /> Result truncated by Azure
            DevOps — some work items may be missing.
          </span>
        )}
        {writeError && (
          <span className="w95-status inline-flex items-center gap-1 font-bold text-[#a80000]">
            <AlertTriangle className="h-3 w-3" /> {writeError}
          </span>
        )}
      </div>
    </div>
  );
}
