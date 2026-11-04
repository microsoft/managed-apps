// BULK EDIT tab — bulk Azure DevOps writes over the board's loaded work items.
//
// One "promote to the top of the stack" control per configured tag (see the
// Tags tab). Each shows exactly what it will touch, asks for confirmation, and
// reports what Azure DevOps really applied. Azure DevOps project permissions
// decide whether any write is allowed.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpNarrowWide,
  CheckCircle2,
  ListChecks,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/hooks/use-confirm";
import { TagChips } from "@/components/tag-chips";
import { tagVisualFrameClasses } from "@/lib/tag-visuals";
import { useTagConfig } from "@/lib/tag-config";
import { EmptyState } from "@/components/states";
import {
  areaMeta,
  compareByStackRank,
  hasExactTag,
  stateMeta,
  type WorkItem,
} from "@/lib/work-items-data";
import { RANK_BASE, RANK_STEP } from "@/lib/stack-rank";
import type { WorkItemWrite } from "@/lib/ado";

export interface BatchWriteResult {
  written: number;
  total: number;
  error: string | null;
}

/**
 * Work items carrying ONE exact tag, in their current backlog order.
 *
 * Exact WHOLE-tag matching (hasExactTag, case-insensitive) — unchanged from the
 * rest of the app, so `urgent` never matches `urgent-later` and
 * `Needs Review` never matches `Needs Review - Deferred`.
 */
function itemsWithTag(items: WorkItem[], tag: string): WorkItem[] {
  return items.filter((it) => hasExactTag(it, tag)).sort(compareByStackRank);
}

/**
 * The Stack Ranks that put `targets` above EVERYTHING else on the board.
 *
 * "Top of the stack" is implemented GLOBALLY, not per list: the board's lists
 * (each engineer's, each backlog category's) are all sorted by the same single
 * [Microsoft.VSTS.Common.StackRank] field ascending, so one rank series placed
 * below the lowest rank currently in play lands every promoted item at the top
 * of whichever list it appears in — and keeps it in the same place in the real
 * Azure DevOps backlog too.
 *
 * Relative order among the promoted items is preserved (they arrive already in
 * StackRank order and are spaced RANK_STEP apart in that same order), and items
 * already sitting at exactly the rank they'd be given are dropped so the run
 * never writes a field it wouldn't change.
 */
function planPromotion(
  items: WorkItem[],
  targets: WorkItem[],
): { id: string; rank: number }[] {
  if (targets.length === 0) return [];
  const targetIds = new Set(targets.map((t) => t.id));
  const others = items
    .filter((it) => !targetIds.has(it.id))
    .map((it) => it.stackRank)
    .filter((r): r is number => typeof r === "number" && Number.isFinite(r));
  const anchor = others.length > 0 ? Math.min(...others) : RANK_BASE;

  return targets
    .map((item, i) => ({
      id: item.id,
      rank: anchor - (targets.length - i) * RANK_STEP,
      current: item.stackRank,
    }))
    .filter((entry) => entry.current !== entry.rank)
    .map(({ id, rank }) => ({ id, rank }));
}

/** The board's shared batch write path (optimistic → ADO → refetch → rollback). */
type WriteItems = (
  changes: { id: string; optimistic: Partial<WorkItem>; write: WorkItemWrite }[],
  label: string,
) => Promise<BatchWriteResult>;

export function BulkEditPanel({
  items,
  writeItems,
}: {
  items: WorkItem[];
  writeItems: WriteItems;
}) {
  const { tags, status } = useTagConfig();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="w95-panel flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 text-[11px]">
        <span className="flex items-center gap-1 font-bold">
          <ListChecks className="h-3.5 w-3.5" /> Bulk edit
        </span>
        <span className="text-[#404040]">
          Bulk changes to live work items. Azure DevOps permissions decide what
          any write is actually allowed to do.
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-2">
          {status === "ready" && tags.length === 0 && (
            <EmptyState
              icon={CheckCircle2}
              title="No tags configured"
              description="Add tags on the Tags tab to get a promote-to-top control for each one."
            />
          )}
          {tags.map((tag) => (
            <PromoteControl
              key={tag.key}
              items={items}
              writeItems={writeItems}
              tag={tag.tag}
              title={`Promote “${tag.label}” items to the top of the stack`}
              noun={`“${tag.label}”`}
              buttonLabel={`Promote “${tag.label}” items`}
              writeLabel={`Promote ${tag.tag} items to the top of the stack`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * ONE tag's promotion: preview → confirm → batch write → result.
 *
 * One is rendered per configured tag. They are fully independent — their
 * own preview, confirmation, in-flight state and summary — and share nothing
 * but the board's `items` and its single batch write path.
 */
function PromoteControl({
  items,
  writeItems,
  tag,
  title,
  noun,
  buttonLabel,
  writeLabel,
}: {
  items: WorkItem[];
  writeItems: WriteItems;
  /** The exact whole tag this control matches on. */
  tag: string;
  /** The window caption. */
  title: string;
  /** How the matched items are described in prose, e.g. "hot". */
  noun: string;
  buttonLabel: string;
  /** What the write is called in the app's own write log. */
  writeLabel: string;
}) {
  const { tags: configuredTags } = useTagConfig();
  const confirm = useConfirm();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; message: string }
    | { kind: "warn"; message: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  const targets = useMemo(() => itemsWithTag(items, tag), [items, tag]);
  const plan = useMemo(() => planPromotion(items, targets), [items, targets]);

  async function promote() {
    setResult(null);
    if (targets.length === 0) {
      setResult({
        kind: "warn",
        message: `No work item on the board carries the tag “${tag}”, so there is nothing to promote. Nothing was written.`,
      });
      return;
    }
    if (plan.length === 0) {
      setResult({
        kind: "warn",
        message: `All ${targets.length} ${noun} work ${targets.length === 1 ? "item is" : "items are"} already at the top of the stack rank — nothing needed changing, so nothing was written.`,
      });
      return;
    }

    const ok = await confirm({
      title: `Promote ${plan.length} ${noun} work ${plan.length === 1 ? "item" : "items"} to the top of the stack?`,
      description: `This writes a new Stack Rank to ${plan.length} real work ${plan.length === 1 ? "item" : "items"} in Azure DevOps (${targets
        .slice(0, 6)
        .map((t) => t.id)
        .join(", ")}${targets.length > 6 ? `, +${targets.length - 6} more` : ""}). They will sit above every other item on the board, keeping their current order among themselves.`,
      confirmLabel: "Promote to top",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) {
      setResult({ kind: "warn", message: "Cancelled — nothing was written." });
      return;
    }

    setRunning(true);
    try {
      const changes = plan.map(({ id, rank }) => ({
        id,
        optimistic: { stackRank: rank } as Partial<WorkItem>,
        write: { stackRank: rank } as WorkItemWrite,
      }));
      const outcome = await writeItems(changes, writeLabel);
      if (outcome.error) {
        setResult({
          kind: "error",
          message: `${outcome.written} of ${outcome.total} work items were updated in Azure DevOps before it rejected the run; ${outcome.total - outcome.written} failed. Azure DevOps said: ${outcome.error} The board has been refreshed from Azure DevOps, so it shows what really applied.`,
        });
      } else {
        setResult({
          kind: "ok",
          message: `${outcome.written} of ${outcome.total} work ${outcome.total === 1 ? "item" : "items"} promoted to the top of the stack rank in Azure DevOps. 0 failed.`,
        });
      }
    } finally {
      setRunning(false);
    }
  }

  return (
        <div className="w95-window">
          <div className="w95-titlebar">
            <span className="flex items-center gap-1">
              <ArrowUpNarrowWide className="h-3.5 w-3.5" />
              {title}
            </span>
          </div>
          <div className="flex flex-col gap-2 p-2 text-[11px]">
            <p>
              Finds every work item tagged{" "}
              <span className="font-mono font-bold">{tag}</span> (exact whole
              tag, case-insensitive) and gives each one a new Stack Rank above
              every other item currently on the board.
            </p>
            <p className="text-[#404040]">
              <span className="font-bold">Scope: global, not per list.</span> Every
              list on the board — each engineer's, and each backlog category —
              is ordered by the same single Stack Rank field, so one rank series
              placed below the board's lowest rank puts these items at the top of
              every list they appear in, and at the top of the real Azure DevOps
              backlog. Their order relative to each other is preserved.
            </p>
            <p className="text-[#404040]">
              <span className="font-bold">Each tag's button is independent.</span>{" "}
              A work item carrying several tags appears in each of their
              previews. The set promoted LAST ends up on top, so run the most
              urgent one last.
            </p>

            <div className="w95-divider" />

            <p className="font-bold">
              Preview — {targets.length} {noun} work{" "}
              {targets.length === 1 ? "item" : "items"}
              {targets.length > 0 && plan.length !== targets.length && (
                <span className="font-normal text-[#404040]">
                  {" "}
                  ({plan.length} would be written; the rest are already ranked
                  where they'd land)
                </span>
              )}
            </p>

            {targets.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Nothing to promote"
                description={`No live work item carries the tag “${tag}” right now, so this button has nothing to do.`}
              />
            ) : (
              <ul className="flex flex-col gap-0.5">
                {targets.map((item, i) => {
                  const area = areaMeta(item.area);
                  const state = stateMeta(item.state);
                  const newRank = plan.find((p) => p.id === item.id)?.rank ?? null;
                  return (
                    <li
                      key={item.id}
                      className={cn(
                        "relative flex flex-wrap items-center gap-1.5 px-1.5 py-0.5 ring-1 ring-black/10",
                        i % 2 === 1 ? "bg-[#e4e1dc]" : "bg-[#cfccc7]",
                        tagVisualFrameClasses(item, configuredTags),
                      )}
                    >
                      <TagChips item={item} />
                      <span className="min-w-0 flex-1 truncate" title={item.title}>
                        {item.title}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-[#404040]">
                        {item.id}
                      </span>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 px-1 py-px text-[9px] font-medium ring-1 ring-black/20",
                          state.badge,
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", state.dot)} />
                        {item.state}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 px-1 py-px text-[9px] font-medium ring-1 ring-black/20",
                          area?.tag,
                        )}
                      >
                        {area?.name}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[9px]",
                          item.assignee ? "text-[#404040]" : "text-[#606060]",
                        )}
                      >
                        {item.assignee ?? "Unassigned"}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-[#404040]">
                        rank {item.stackRank ?? "none"}
                        {newRank !== null ? ` → ${newRank}` : " (no change)"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="w95-btn w95-btn--default"
                onClick={() => void promote()}
                disabled={running || targets.length === 0}
              >
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUpNarrowWide className="h-3.5 w-3.5" />
                )}
                {running
                  ? "Writing to Azure DevOps…"
                  : `${buttonLabel} (${plan.length || targets.length})…`}
              </button>
              <span className="flex items-center gap-1 text-[10px] text-[#404040]">
                <AlertTriangle className="h-3.5 w-3.5 text-[#808000]" />
                Asks for confirmation first — this changes real work items.
              </span>
            </div>

            {result && (
              <div
                className={cn(
                  "w95-status px-2 py-1 text-[11px]",
                  result.kind === "error" && "font-bold text-[#800000]",
                )}
              >
                {result.message}
              </div>
            )}
          </div>
        </div>
  );
}
