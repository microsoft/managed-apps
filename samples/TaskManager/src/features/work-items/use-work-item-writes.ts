import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import {
  deleteWorkItem,
  fetchChildCounts,
  fetchWorkItem,
  isKnownAreaCode,
  updateWorkItemFields,
  type AdoConfig,
  type WorkItemWrite,
} from "@/lib/ado";
import { useAppStore } from "@/lib/store";
import type { WorkItem } from "@/lib/work-items-data";

/** What a batch write actually did: how many of how many, and the first error. */
export interface BatchWriteResult {
  written: number;
  total: number;
  error: string | null;
}

/**
 * Every Azure DevOps write the work-item views make, in one place: optimistic
 * update -> real connector write -> refetch, with rollback and the connector's
 * own error text on failure. Board items live in `items`; nested items and
 * My Work bugs are owned by their panels and go through `writeChildItem`.
 */
export function useWorkItemWrites({
  config,
  items,
  setItems,
  refetch,
}: {
  config: AdoConfig;
  items: WorkItem[];
  setItems: (update: (current: WorkItem[]) => WorkItem[]) => void;
  refetch: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  // Board id -> human label of the write in flight, and the last write failure.
  const [writing, setWriting] = useState<Record<string, string>>({});
  const [writeError, setWriteError] = useState<string | null>(null);

  /**
   * The ONE write path for the board (drag-and-drop reassignment and detail
   * edits both go through it):
   *
   *   1. apply the change optimistically so the UI responds instantly,
   *   2. send the real field write to Azure DevOps,
   *   3. on success refetch, so the board reflects the true ADO state,
   *   4. on failure REVERT the item to its pre-write snapshot and surface the
   *      connector's own error text — the board never keeps a change ADO
   *      refused.
   *
   * Resolves to null on success, or the real error message on failure.
   */
  async function writeItem(
    id: string,
    optimistic: Partial<WorkItem>,
    write: WorkItemWrite,
    label: string,
  ): Promise<string | null> {
    const before = items.find((it) => it.id === id);
    if (!before) return `Work item ${id} is no longer on the board.`;

    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...optimistic } : it)),
    );
    setWriting((w) => ({ ...w, [id]: label }));
    setWriteError(null);

    try {
      await updateWorkItemFields(config, id, write);
      toast.success(`Work item ${id} updated in Azure DevOps`, {
        description: label,
      });
      // Refetch so what's on screen is what ADO actually stored.
      await refetch();
      return null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Azure DevOps rejected the update.";
      // Roll the optimistic change back to the exact pre-write work item.
      setItems((prev) => prev.map((it) => (it.id === id ? before : it)));
      setWriteError(`${label} failed for ${id} — ${message}`);
      toast.error(`Couldn't update work item ${id}`, { description: message });
      return message;
    } finally {
      setWriting((w) => {
        const next = { ...w };
        delete next[id];
        return next;
      });
    }
  }

  /**
   * The SAME write path as writeItem, for the one operation that has to touch
   * several work items at once: renormalizing a list's StackRanks when the gap
   * between two cards can't be bisected (see lib/stack-rank.ts).
   *
   * Same contract — optimistic update, real Azure DevOps writes, refetch on
   * success, rollback plus the connector's own error text on failure. The
   * writes are sequential so a rejection stops the rest, and because ADO may
   * already have accepted some of them the failure path ALSO refetches, so the
   * board shows what Azure DevOps really holds rather than the rolled-back
   * guess.
   */
  async function writeItems(
    changes: { id: string; optimistic: Partial<WorkItem>; write: WorkItemWrite }[],
    label: string,
  ): Promise<BatchWriteResult> {
    const before = new Map<string, WorkItem>();
    for (const c of changes) {
      const it = items.find((i) => i.id === c.id);
      if (it) before.set(c.id, it);
    }
    const targets = changes.filter((c) => before.has(c.id));
    if (targets.length === 0) {
      return {
        written: 0,
        total: changes.length,
        error: "Those work items are no longer on the board.",
      };
    }

    setItems((prev) =>
      prev.map((it) => {
        const c = targets.find((t) => t.id === it.id);
        return c ? { ...it, ...c.optimistic } : it;
      }),
    );
    setWriting((w) => {
      const next = { ...w };
      for (const c of targets) next[c.id] = label;
      return next;
    });
    setWriteError(null);

    // How many of the sequence Azure DevOps actually accepted before (if ever)
    // it refused one — reported back to the caller so a bulk action can say
    // "3 of 12 written" truthfully instead of implying all-or-nothing.
    let written = 0;

    try {
      for (const c of targets) {
        await updateWorkItemFields(config, c.id, c.write);
        written += 1;
      }
      toast.success(
        `${targets.length} work ${targets.length === 1 ? "item" : "items"} updated in Azure DevOps`,
        { description: label },
      );
      await refetch();
      return { written, total: targets.length, error: null };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Azure DevOps rejected the update.";
      setItems((prev) => prev.map((it) => before.get(it.id) ?? it));
      setWriteError(`${label} failed — ${message}`);
      toast.error("Couldn't update the work items", { description: message });
      // Some of the sequence may already have been accepted, so go and ask.
      void refetch();
      return { written, total: targets.length, error: message };
    } finally {
      setWriting((w) => {
        const next = { ...w };
        for (const c of targets) delete next[c.id];
        return next;
      });
    }
  }

  /**
   * APPLY ONE CHANGE TO EVERY SELECTED WORK ITEM (My Work multi-select).
   *
   * No new write mechanism: this is a DISPATCHER over the two the app already
   * has, because a My Work selection can legitimately mix both kinds of item.
   *   • Anything on the board goes through `writeItems` in ONE batch — same
   *     optimistic update, same rollback to the exact pre-write items, same
   *     refetch, same real Azure DevOps error text, and the same honest
   *     "written of total" it already returns.
   *   • A top-level BUG is not in the board's list (it comes from My Work's own
   *     query), so it goes through `writeChildItem`, the same path its own
   *     single-item menu already uses.
   *
   * `build` returns null for an item the action doesn't apply to — a tag toggle
   * that would change nothing, for instance — and those are skipped rather than
   * sent, exactly as the single-item path skips them.
   *
   * REPORTING IS PER ITEM AND NEVER OPTIMISTIC: successes are counted only
   * where the write actually resolved without error, every failure keeps Azure
   * DevOps' own message, and a partial result says so. Nothing here reports a
   * blanket success.
   */
  async function writeBulkSelection(
    targets: WorkItem[],
    build: (
      item: WorkItem,
    ) => { optimistic: Partial<WorkItem>; write: WorkItemWrite } | null,
    label: string,
  ): Promise<void> {
    const planned = targets
      .map((item) => ({ item, plan: build(item) }))
      .filter(
        (p): p is { item: WorkItem; plan: NonNullable<typeof p.plan> } =>
          p.plan !== null,
      );

    if (planned.length === 0) {
      toast.info("Nothing to change", {
        description: `${label} would not change any of the ${targets.length} selected work items.`,
      });
      return;
    }

    const onBoard = planned.filter((p) => items.some((i) => i.id === p.item.id));
    const offBoard = planned.filter(
      (p) => !items.some((i) => i.id === p.item.id),
    );

    let written = 0;
    const failures: string[] = [];

    if (onBoard.length > 0) {
      const res = await writeItems(
        onBoard.map((p) => ({
          id: p.item.id,
          optimistic: p.plan.optimistic,
          write: p.plan.write,
        })),
        label,
      );
      written += res.written;
      if (res.error) failures.push(res.error);
    }

    // Sequential, like the board batch: one refusal shouldn't be raced by the
    // rest, and each item's real error is kept against its own id.
    for (const p of offBoard) {
      const err = await writeChildItem(p.item.id, p.plan.write, label);
      if (err) failures.push(`${p.item.id} — ${err}`);
      else written += 1;
    }

    if (failures.length > 0) {
      toast.error(
        `${label}: ${written} of ${planned.length} written, ${failures.length} failed`,
        { description: failures.slice(0, 3).join(" · ") },
      );
      setWriteError(
        `${label} — ${written} of ${planned.length} work items written. ` +
          `Failures: ${failures.join(" | ")}`,
      );
    } else {
      toast.success(
        `${written} of ${planned.length} work ${planned.length === 1 ? "item" : "items"} updated in Azure DevOps`,
        { description: label },
      );
    }

    // Whatever happened, the tab's own data is re-read so the cards show what
    // Azure DevOps really holds rather than the optimistic guess.
    void queryClient.invalidateQueries({ queryKey: ["ado-my-bugs"] });
    void queryClient.invalidateQueries({ queryKey: ["ado-child-counts"] });
  }

  /**
   * THE WRITE PATH FOR A NESTED (child) WORK ITEM.
   *
   * A child is a real Azure DevOps work item, but it is NOT in the board's
   * `items` list (the board query returns the team's User Stories, and children
   * are usually Tasks or Bugs), so `writeItem`'s optimistic/rollback bookkeeping
   * — which is keyed on that list — can't own it. This is the same contract
   * against the list that DOES own it: My Work applies the optimistic change to
   * the child row, this sends the real write and reports the outcome, and My
   * Work refetches on success or rolls its row back on failure.
   *
   * Identical in every other respect to `writeItem`: a real
   * `updateWorkItemFields` call, the connector's own error text on failure
   * (never a fabricated success), the same toasts, and the same `writeError`
   * line in the tab-level refresh panel.
   *
   * Resolves to null on success, or the real error message on failure.
   */
  async function writeChildItem(
    id: string,
    write: WorkItemWrite,
    label: string,
  ): Promise<string | null> {
    setWriting((w) => ({ ...w, [id]: label }));
    setWriteError(null);
    try {
      await updateWorkItemFields(config, id, write);
      toast.success(`Work item ${id} updated in Azure DevOps`, {
        description: label,
      });
      return null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Azure DevOps rejected the update.";
      setWriteError(`${label} failed for ${id} — ${message}`);
      toast.error(`Couldn't update work item ${id}`, { description: message });
      return message;
    } finally {
      setWriting((w) => {
        const next = { ...w };
        delete next[id];
        return next;
      });
    }
  }

  /**
   * DELETE A NESTED WORK ITEM — the app's most destructive action.
   *
   * Only reachable from a nested item's right-click menu, and only after an
   * explicit confirmation naming the item. It moves the work item to the Azure
   * DevOps RECYCLE BIN (recoverable by an ADO administrator); the permanent
   * `destroy=true` purge is never used — see deleteWorkItem.
   *
   * Open to EVERY user. The app deliberately does not
   * second-guess who may delete: Azure DevOps' own permissions are the real
   * authority, so a user without delete rights gets ADO's refusal surfaced
   * verbatim — the correct outcome, rather than one the UI pre-empts with a
   * guess about what the service would have said.
   *
   * Nothing is stubbed out locally: the row disappears because the child
   * queries are refetched from Azure DevOps, and if the delete didn't actually
   * apply the row is still there afterwards, which is exactly what should
   * happen. A refusal (permissions, most likely) surfaces ADO's own words.
   */
  async function deleteChildItem(
    child: WorkItem,
    typeLabel: string | null,
  ): Promise<boolean> {
    const label = typeLabel ?? "work item";

    // Does it have nested items of its OWN? Read from ADO's real relations, so
    // the confirmation can say so instead of the user finding out afterwards.
    // A failed read doesn't block the delete — it just says it couldn't check.
    let ownChildren: number | null = null;
    try {
      const counts = await fetchChildCounts(config, [child.id]);
      ownChildren = counts[child.id] ?? 0;
    } catch {
      ownChildren = null;
    }

    const nestedNote =
      ownChildren === null
        ? " The app couldn't check whether this item has nested items of its own."
        : ownChildren > 0
          ? ` It has ${ownChildren} nested item${
              ownChildren === 1 ? "" : "s"
            } of its own. Only this item is sent for deletion; what happens to those is checked against Azure DevOps afterwards and reported.`
          : "";

    const ok = await confirm({
      title: `Delete ${label} ${child.id}?`,
      description:
        `“${child.title}” will be moved to the Azure DevOps recycle bin, ` +
        `where an Azure DevOps administrator can restore it. It is not ` +
        `permanently destroyed, but it cannot be restored from this app.` +
        nestedNote,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return false;

    setWriting((w) => ({ ...w, [child.id]: "Delete" }));
    setWriteError(null);
    let deleted = false;
    try {
      const result = await deleteWorkItem(config, child.id);

      // What became of its own children — observed, never assumed.
      const survivors = result.survivingChildIds.length;
      const childNote = result.childCheckError
        ? `Its nested items couldn't be checked — ${result.childCheckError}`
        : result.childIds.length === 0
          ? undefined
          : survivors === 0
            ? `Its ${result.childIds.length} nested item${
                result.childIds.length === 1 ? "" : "s"
              } are gone from Azure DevOps too.`
            : `${survivors} of its ${result.childIds.length} nested item${
                result.childIds.length === 1 ? "" : "s"
              } still exist in Azure DevOps — they were not deleted with it.`;

      if (result.deleted) {
        deleted = true;
        toast.success(
          `${label} ${child.id} moved to the Azure DevOps recycle bin`,
          { description: childNote },
        );
      } else {
        // Accepted but NOT actually gone, or unconfirmable: never reported as
        // a success, and the row stays visible because nothing was faked.
        const message = result.verifyError
          ? `Azure DevOps accepted the delete for ${child.id} but the app couldn't confirm it — ${result.verifyError}`
          : `Azure DevOps accepted the delete but work item ${child.id} is still there.`;
        setWriteError(message);
        toast.error(`Couldn't confirm the delete of ${child.id}`, {
          description: message,
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Azure DevOps rejected the delete.";
      setWriteError(`Delete failed for ${child.id} — ${message}`);
      toast.error(`Couldn't delete work item ${child.id}`, {
        description: message,
      });
    } finally {
      setWriting((w) => {
        const next = { ...w };
        delete next[child.id];
        return next;
      });
      // Refetch the nested lists and their counts either way: on success the
      // row disappears and the parent's count drops because ADO says so, and on
      // failure the row is confirmed still present rather than left ambiguous.
      void queryClient.invalidateQueries({ queryKey: ["ado-child-counts"] });
      void queryClient.invalidateQueries({ queryKey: ["ado-child-work-items"] });
      void refetch();
    }
    return deleted;
  }

  async function saveWorkItemDetails(
    target: WorkItem,
    patch: Partial<WorkItem>,
  ): Promise<string | null> {
    const areaChanged =
      typeof patch.area === "string" &&
      patch.area !== target.area &&
      isKnownAreaCode(patch.area) &&
      Boolean(patch.areaPath);
    const assignmentChanged =
      patch.assignee !== target.assignee ||
      patch.assigneeEmail !== target.assigneeEmail;
    const targetDateChanged =
      (patch.targetDate ?? null) !== (target.targetDate ?? null);
    const write = {
      title: patch.title,
      description: patch.description,
      state: patch.state,
      ...(areaChanged ? { areaPath: patch.areaPath } : {}),
      ...(assignmentChanged
        ? {
            assignee: {
              name: patch.assignee ?? null,
              email: patch.assigneeEmail ?? null,
            },
          }
        : {}),
      ...(targetDateChanged ? { targetDate: patch.targetDate ?? null } : {}),
    };
    const label = areaChanged
      ? `Save work item details · Set area to ${patch.area}`
      : "Save work item details";
    const isBoardItem = items.some((item) => item.id === target.id);
    const error = isBoardItem
      ? await writeItem(target.id, patch, write, label)
      : await writeChildItem(target.id, write, label);
    if (!error && !isBoardItem) {
      void queryClient.invalidateQueries({ queryKey: ["ado-my-bugs"] });
      void queryClient.invalidateQueries({
        queryKey: ["ado-child-work-items"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["ado-child-counts"],
      });
    }
    return error;
  }

  async function refreshWorkItemDetails(target: WorkItem): Promise<WorkItem> {
    const latest = await fetchWorkItem(config, target.id);
    setItems((current) =>
      current.map((candidate) => (candidate.id === latest.id ? latest : candidate)),
    );
    useAppStore.getState().refreshWorkItem(latest);
    return latest;
  }


  return {
    writing,
    writeError,
    writeItem,
    writeItems,
    writeBulkSelection,
    writeChildItem,
    deleteChildItem,
    saveWorkItemDetails,
    refreshWorkItemDetails,
  };
}

export type WorkItemWrites = ReturnType<typeof useWorkItemWrites>;
