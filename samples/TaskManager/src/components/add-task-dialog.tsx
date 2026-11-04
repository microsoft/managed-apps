// Create a nested Task or User Story underneath one of your work items.
//
// Dressed as a 95 dialog like every other window in this app (`.w95-dialog`
// frame, title bar, beveled buttons, square and instant — see the dialog notes
// in styles/win95.css).
//
// NOTHING HERE IS FABRICATED:
//   * The item is created for real (lib/ado.ts -> createChildWorkItem), and the
//     parent link is VERIFIED by reading the new item's relations back from
//     Azure DevOps. An item that was created but could NOT be parented is
//     reported as exactly that, with its id and a link to open it — never as a
//     plain success, because an orphan the user doesn't know about is the one
//     outcome they can't recover from.
//   * The assignee list is built from identities the app has actually seen —
//     the signed-in user and the engineers who own live work items — plus an
//     explicit "Unassigned". There is no free-text identity box, so a name
//     Azure DevOps would reject can't be typed in the first place.
//   * The picker OPENS on the signed-in user, since a task you add to your own
//     work item is nearly always yours. It uses that same seen-for-real
//     identity, and when the app has NO identity for them that Azure DevOps
//     would accept it opens on "Unassigned" instead — preselecting a value the
//     create would only reject would be worse than preselecting nothing.
//   * The area path (and the iteration, when ADO returns one) are inherited
//     from the PARENT and shown before the click.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ExternalLink,
  ListPlus,
  Loader2,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PersonAvatar } from "@/components/person-avatar";
import { safeUrl } from "@/lib/safe-url";
import {
  ADO_NESTED_WORK_ITEM_TYPES,
  createChildWorkItem,
  fetchWorkItemPlacement,
  workItemUrl,
  type AdoConfig,
  type CreatedChildWorkItem,
  type NestedWorkItemCreateType,
} from "@/lib/ado";
import type { WorkItem } from "@/lib/work-items-data";

/** One pickable owner for the new item: a REAL identity, never a typed guess. */
export interface AssigneeOption {
  /** The identity written to [System.AssignedTo] (email / UPN). */
  email: string;
  /** Display name to show for it. */
  name: string;
  /** True for the signed-in user, which sorts first and is labelled "(you)". */
  isSelf?: boolean;
}

/** Sentinel for the explicit "Unassigned" choice (never sent to ADO). */
const UNASSIGNED = "__unassigned__";

export function AddTaskDialog({
  open,
  parent,
  config,
  assignees,
  layerIndex = 0,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** The work item that becomes the new item's parent. */
  parent: WorkItem;
  config: AdoConfig;
  /** Real identities to choose from (see the note at the top of this file). */
  assignees: AssigneeOption[];
  /** Raises this child dialog above the detail-pane stack that opened it. */
  layerIndex?: number;
  onClose: () => void;
  /**
   * A work item was created in Azure DevOps. Called even when the parent link or
   * the assignment failed, so the caller can refresh what it shows — the item
   * exists either way.
   */
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const defaultWorkItemType: NestedWorkItemCreateType =
    parent.workItemType === "Epic" || parent.workItemType === "Feature"
      ? "User Story"
      : "Task";
  const [workItemType, setWorkItemType] =
    useState<NestedWorkItemCreateType>(defaultWorkItemType);
  /**
   * The user's EXPLICIT pick, or null while they haven't touched the picker —
   * `selected` below resolves null to the signed-in user.
   *
   * Null is deliberately a different thing from UNASSIGNED: choosing
   * "Unassigned" is a real decision and must survive the signed-in identity
   * arriving a moment later, which it wouldn't if both were the same value.
   */
  const [assignee, setAssignee] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectOpenRef = useRef(false);
  /** A finished create whose outcome needs reporting (partial success). */
  const [outcome, setOutcome] = useState<CreatedChildWorkItem | null>(null);

  // Reset every time the dialog is opened for a work item, so a previous
  // attempt's text or error can never bleed into the next one.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setWorkItemType(defaultWorkItemType);
    setAssignee(null); // back to defaulting to the signed-in user
    setError(null);
    setOutcome(null);
    setSaving(false);
    selectOpenRef.current = false;
  }, [defaultWorkItemType, open, parent.id]);

  /**
   * The parent's iteration path — the board hydrates area paths but not
   * iterations, so this one field is read while the dialog is open. A failure
   * is not fatal: the item is then created without an iteration and Azure
   * DevOps applies the project default, which the dialog says plainly.
   */
  const placementQuery = useQuery({
    queryKey: [
      "ado-work-item-placement",
      config.organization,
      config.project,
      parent.id,
    ],
    queryFn: () => fetchWorkItemPlacement(config, parent.id),
    enabled: open,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // The parent's OWN area path from the live board data (already known), with
  // the read-back value preferred when it arrives.
  const areaPath = placementQuery.data?.areaPath ?? parent.areaPath ?? null;
  const iterationPath = placementQuery.data?.iterationPath ?? null;

  /**
   * The signed-in user's own entry in the list, when there is one.
   *
   * Its address is the identity AZURE DEVOPS knows them by — read back from
   * ADO's own [System.AssignedTo] on an item they already own, falling back to
   * the profile UPN, and never the Office 365 `mail` alias that ADO rejects as
   * an unknown identity (see `selfIdentity` in my-work-panel.tsx and
   * adoWriteIdentity in lib/current-user.ts). When NEITHER could be resolved,
   * the caller leaves this option out of the list altogether — so there is
   * genuinely nothing here to preselect, and the default below stays
   * "Unassigned" rather than becoming a value the create would 400 on.
   */
  const selfOption = useMemo(
    () => assignees.find((a) => a.isSelf) ?? null,
    [assignees],
  );

  /**
   * What the picker actually shows: the user's own pick once they've made one,
   * otherwise the signed-in user, otherwise "Unassigned".
   *
   * DERIVED rather than written into state when the dialog opens, because the
   * identity can still be resolving at that moment. Deriving means the default
   * appears as soon as it lands, without ever overwriting a choice the user has
   * already made — and anyone can still pick someone else, or Unassigned.
   */
  const selected = assignee ?? selfOption?.email ?? UNASSIGNED;

  const chosen = useMemo(
    () => assignees.find((a) => a.email === selected) ?? null,
    [assignees, selected],
  );
  const canSubmit = title.trim().length > 0 && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setOutcome(null);
    try {
      const created = await createChildWorkItem(config, {
        parentBoardId: parent.id,
        workItemType,
        title,
        description,
        assigneeEmail: chosen?.email ?? null,
        assigneeName: chosen?.name ?? null,
        areaPath,
        iterationPath,
      });

      // The item EXISTS from here on, whatever else went wrong — so the caller
      // refreshes in every branch below.
      onCreated();

      const clean =
        created.parented &&
        !created.linkError &&
        !created.verifyError &&
        !created.assignError;
      if (clean) {
        toast.success(
          created.id
            ? `${workItemType} ${created.id} created under ${parent.id}`
            : `${workItemType} created under ${parent.id}`,
          {
            description: chosen
              ? `Assigned to ${chosen.name}`
              : "Left unassigned",
          },
        );
        onClose();
        return;
      }

      // Anything less than a clean success stays on screen with the real
      // outcome rather than being dismissed with a green toast.
      setOutcome(created);
      if (!created.parented) {
        const unconfirmed = Boolean(created.verifyError) && !created.linkError;
        toast.error(
          !created.id
            ? `The ${workItemType.toLowerCase()} was created but couldn't be linked`
            : unconfirmed
              ? `${workItemType} ${created.id} created — link to ${parent.id} unconfirmed`
              : `${workItemType} ${created.id} was created but not linked to ${parent.id}`,
          { description: created.linkError ?? created.verifyError ?? undefined },
        );
      } else {
        toast.warning(`${workItemType} ${created.id} created with a problem`, {
          description: created.assignError ?? created.verifyError ?? undefined,
        });
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : `Azure DevOps rejected the new ${workItemType.toLowerCase()}.`;
      setError(message);
      toast.error(`Couldn't create the ${workItemType.toLowerCase()}`, {
        description: message,
      });
    } finally {
      setSaving(false);
    }
  }

  const outcomeUrl =
    outcome?.id != null ? workItemUrl(config, String(outcome.id)) : null;

  function trackSelectOpen(open: boolean) {
    if (open) {
      selectOpenRef.current = true;
      return;
    }
    window.setTimeout(() => {
      selectOpenRef.current = false;
    }, 0);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving && !selectOpenRef.current) onClose();
      }}
    >
      <DialogContent
        className="w95-dialog max-w-lg gap-0"
        overlayStyle={{ zIndex: 79 + layerIndex * 10 }}
        style={{ zIndex: 80 + layerIndex * 10 }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (selectOpenRef.current) event.preventDefault();
        }}
      >
        <DialogHeader className="space-y-0">
          <div className="w95-titlebar">
            <ListPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <DialogTitle className="min-w-0 flex-1 truncate text-left text-[12px] font-bold text-white">
              New nested item under {parent.id}
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
            Creates a real Task or User Story in Azure DevOps nested under work
            item {parent.id}.
          </DialogDescription>
        </DialogHeader>

        <div className="w95-in m-1 space-y-2.5 p-3">
          {/* WHAT this task will hang off, and where it will land. */}
          <div className="space-y-1">
            <p className="text-[11px] leading-snug">
              <span className="font-bold">Parent:</span>{" "}
              <span className="font-mono text-[10px] text-[#404040]">
                {parent.id}
              </span>{" "}
              {parent.title}
            </p>
            <p className="text-[10px] leading-snug text-[#404040]">
              Inherits area path{" "}
              <span className="font-mono">{areaPath || "(none returned)"}</span>
              {" · "}
              iteration{" "}
              {placementQuery.isLoading ? (
                <span className="font-mono">reading…</span>
              ) : iterationPath ? (
                <span className="font-mono">{iterationPath}</span>
              ) : (
                <span className="italic">
                  not available — Azure DevOps will apply its own default
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              className="w-[70px] shrink-0 text-[11px] font-bold"
              htmlFor="new-nested-item-type"
            >
              Type
            </label>
            <Select
              value={workItemType}
              disabled={saving}
              onOpenChange={trackSelectOpen}
              onValueChange={(value) => {
                if (value === "Task" || value === "User Story") {
                  setWorkItemType(value);
                }
              }}
            >
              <SelectTrigger
                className="w-[150px]"
                size="sm"
                id="new-nested-item-type"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[2000]">
                {ADO_NESTED_WORK_ITEM_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              className="w-[70px] shrink-0 text-[11px] font-bold"
              htmlFor="new-task-title"
            >
              Title
            </label>
            <input
              id="new-task-title"
              type="text"
              value={title}
              disabled={saving}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing"
              className="min-w-[16rem] flex-1"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <label
              className="w-[70px] shrink-0 pt-1 text-[11px] font-bold"
              htmlFor="new-task-description"
            >
              Description
            </label>
            <textarea
              id="new-task-description"
              value={description}
              disabled={saving}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional description"
              className="min-w-[16rem] flex-1 resize-y"
            />
          </div>

          {/* Only identities the app has really seen, plus Unassigned — no
              free-text box, so an identity ADO would reject can't be typed. */}
          <div className="flex flex-wrap items-center gap-2">
            <label
              className="w-[70px] shrink-0 text-[11px] font-bold"
              htmlFor="new-task-assignee"
            >
              Assign to
            </label>
            <Select
              value={selected}
              disabled={saving}
              onOpenChange={trackSelectOpen}
              onValueChange={(v) => setAssignee(v)}
            >
              <SelectTrigger className="w-[260px]" size="sm" id="new-task-assignee">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent className="z-[2000]">
                <SelectItem value={UNASSIGNED}>
                  <span className="flex items-center gap-1.5 text-[#606060]">
                    <PersonAvatar name="Unassigned" className="h-4 w-4" />
                    Unassigned
                  </span>
                </SelectItem>
                {assignees.map((a) => (
                  <SelectItem key={a.email} value={a.email}>
                    {a.name}
                    {a.isSelf ? " (you)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {chosen && (
            <p className="pl-[78px] font-mono text-[10px] text-[#404040]">
              → {chosen.email}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pl-[78px]">
            <button
              type="button"
              className="w95-btn w95-btn--default"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Creating in Azure DevOps…
                </>
              ) : (
                <>
                  <UserPlus className="h-3.5 w-3.5" />
                  Create {workItemType.toLowerCase()}
                </>
              )}
            </button>
          </div>

          {/* The task was never created — the connector's own words. */}
          {error && (
            <p className="w95-field px-2 py-1 text-[11px] font-bold text-[#a80000]">
              Azure DevOps rejected the new {workItemType.toLowerCase()} — {error}
            </p>
          )}

          {/* The task WAS created, but something after it wasn't clean. This
              never reads as success: the id is always named so the user can go
              and look at what actually exists. */}
          {outcome && (
            <div className="w95-field space-y-1.5 px-2 py-1.5">
              <p className="flex items-start gap-1.5 text-[11px] font-bold text-[#a80000]">
                <TriangleAlert
                  className="mt-px h-3.5 w-3.5 shrink-0"
                  fill="#ffff00"
                  stroke="#000000"
                  aria-hidden="true"
                />
                {outcome.parented
                  ? `${outcome.workItemType} ${outcome.id} was created under ${parent.id}, but not everything worked.`
                  : !outcome.id
                    ? `The ${outcome.workItemType.toLowerCase()} was created, but Azure DevOps returned no id for it.`
                    : outcome.verifyError
                      ? `${outcome.workItemType} ${outcome.id} was created, but the app couldn't confirm whether it was linked to ${parent.id}.`
                      : `${outcome.workItemType} ${outcome.id} was created, but Azure DevOps has NOT linked it to ${parent.id}.`}
              </p>
              {/* Said as precisely as it is known: a link that was REFUSED is
                  a definite orphan; a link that couldn't be READ BACK is an
                  unknown, and is never described as a failure. */}
              {!outcome.parented &&
                (outcome.verifyError && !outcome.linkError ? (
                  <p className="text-[11px] leading-snug">
                    It may or may not be nested under {parent.id}. Check it in
                    Azure DevOps before creating another one.
                  </p>
                ) : (
                  <p className="text-[11px] leading-snug">
                    It exists on its own, so it will not appear in this item's
                    nested list. Link it to {parent.id} in Azure DevOps, or
                    delete it.
                  </p>
                ))}
              {outcome.linkError && (
                <p className="text-[10px] leading-snug text-[#404040]">
                  Link error — {outcome.linkError}
                </p>
              )}
              {outcome.verifyError && (
                <p className="text-[10px] leading-snug text-[#404040]">
                  Couldn't confirm the result — {outcome.verifyError}
                </p>
              )}
              {outcome.assignError && (
                <p className="text-[10px] leading-snug text-[#404040]">
                  The {outcome.workItemType.toLowerCase()} is not assigned to{" "}
                  {chosen?.name ?? "the chosen owner"}{" "}
                  — {outcome.assignError}
                </p>
              )}
              {outcomeUrl && (
                <a
                  href={safeUrl(outcomeUrl) ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#000080] underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open {outcome.workItemType.toLowerCase()} {outcome.id} in Azure
                  DevOps
                </a>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="justify-end gap-2 px-2 pb-3 sm:justify-end">
          <button
            type="button"
            className="w95-btn min-w-[75px] justify-center"
            onClick={onClose}
          >
            {outcome ? "Close" : "Cancel"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
