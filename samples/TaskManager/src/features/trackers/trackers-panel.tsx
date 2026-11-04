import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  GitFork,
  GripVertical,
  Link2,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { PersonAvatar } from "@/components/person-avatar";
import { TagChip } from "@/components/tag-chips";
import { EtaRequestButton } from "@/features/trackers/eta-request-button";
import { TrackerDialog } from "@/features/trackers/tracker-dialog";
import { TrackerNoteEditor } from "@/features/trackers/tracker-note-editor";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/hooks/use-confirm";
import {
  fetchWorkItemTypeStates,
  fetchTrackerWorkItems,
  updateWorkItemFields,
  type AdoConfig,
  type FetchTrackerResult,
} from "@/lib/ado";
import {
  copyHtmlToClipboard,
  copyLinkToClipboard,
  escapeHtml,
} from "@/lib/clipboard";
import { appLink } from "@/lib/app-links";
import { appConfig } from "@/config";
import {
  trackersCollection,
  trackerScenariosCollection,
  workItemNotesCollection,
} from "@/storage/collections";
import { useAppCollection, useInvalidateOnChange } from "@/storage/hooks";
import { isUnassignedPersonName } from "@/lib/person-display";
import { usePersonPhotos } from "@/lib/people-photos";
import { safeUrl } from "@/lib/safe-url";
import {
  createTrackerScenario,
  createTrackerScenarioFromWorkItem,
  deleteTrackerScenario,
  getTrackerScenarioSet,
  linkTrackerScenarioIssue,
  MAX_SCENARIO_NAME_LENGTH,
  MISC_SCENARIO_ID,
  moveTrackerWorkItems,
  renameTrackerScenario,
  TRACKER_SCENARIOS_QUERY_KEY,
  trackerScenarios,
  type TrackerScenario,
  type TrackerScenarioSet,
} from "@/lib/tracker-scenarios";
import { normalizeTag, useTagConfig } from "@/lib/tag-config";
import {
  listTrackers,
  TRACKERS_QUERY_KEY,
  type TrackerItem,
} from "@/lib/trackers";
import {
  isFinishedState,
  type WorkItem,
} from "@/lib/work-items-data";
import {
  loadWorkItemNotes,
  workItemNoteKey,
  WORK_ITEM_NOTES_QUERY_KEY,
  type WorkItemNoteRecord,
  type WorkItemNotes,
} from "@/lib/work-item-notes";
import { cn } from "@/lib/utils";

const TRACKER_WORK_QUERY_KEY = "tracker-work-items";
const REFRESH_INTERVAL_MS = 60_000;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : error ? String(error) : fallback;
}

type ScenarioStatus = {
  label: "Not Started" | "In Progress" | "Complete";
  className: string;
  color: string;
};

function scenarioStatus(items: readonly WorkItem[]): ScenarioStatus {
  if (
    items.length === 0 ||
    items.every((item) => item.state.trim().toLowerCase() === "new")
  ) {
    return {
      label: "Not Started",
      className: "bg-[#ffe0b2]",
      color: "#ffe0b2",
    };
  }
  if (items.every((item) => isFinishedState(item.state))) {
    return {
      label: "Complete",
      className: "bg-[#e5f3e5]",
      color: "#e5f3e5",
    };
  }
  return {
    label: "In Progress",
    className: "bg-[#fff7bf]",
    color: "#fff7bf",
  };
}

function latestEta(items: readonly WorkItem[]): string | null {
  return (
    items
      .map((item) => item.targetDate?.slice(0, 10) ?? "")
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort()
      .at(-1) ?? null
  );
}

function etaLabel(items: readonly WorkItem[], available: boolean): string {
  if (!available) return "ETA unavailable";
  const eta = latestEta(items);
  if (!eta) return items.length > 0 && items.every((item) => isFinishedState(item.state))
    ? "-"
    : "MISSING ETA";
  const date = new Date(`${eta}T00:00:00`);
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function scenarioOwners(items: readonly WorkItem[]) {
  const owners = new Map<string, { name: string; email: string | null }>();
  for (const item of items) {
    const name = item.assignee?.trim() || "Unassigned";
    const email = item.assigneeEmail?.trim().toLowerCase() || null;
    const key = email ?? name.toLowerCase();
    if (!owners.has(key)) owners.set(key, { name, email });
  }
  return [...owners.values()];
}

function issueNumber(url: string): string {
  return url.match(/\/(?:issues|pull|workitems?|browse)\/([\w-]+)\/?$/i)?.[1] ?? "link";
}

function ScenarioDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w95-dialog gap-0 overflow-hidden sm:max-w-md" showCloseButton={false}>
        <div className="w95-titlebar">
          <ListTree className="h-4 w-4" />
          <DialogTitle className="text-[12px] font-bold text-white">
            Add scenario
          </DialogTitle>
        </div>
        <form
          className="space-y-3 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onSubmit(name);
          }}
        >
          <DialogDescription className="text-[11px] text-black">
            New scenarios start empty. Move work into them from Misc.
          </DialogDescription>
          <div className="grid gap-1">
            <Label htmlFor="scenario-name" className="text-[11px] font-bold">
              Scenario name
            </Label>
            <Input
              id="scenario-name"
              className="w95-input h-8 rounded-none text-[11px]"
              value={name}
              maxLength={MAX_SCENARIO_NAME_LENGTH}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <button type="button" className="w95-btn h-7 px-3 text-[11px]" onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button type="submit" className="w95-btn h-7 px-3 text-[11px]" disabled={pending || !name.trim()}>
              {pending ? "Adding..." : "Add scenario"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameScenarioDialog({
  scenario,
  onOpenChange,
  onSubmit,
  pending,
}: {
  scenario: TrackerScenario | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (scenario) setName(scenario.name);
  }, [scenario]);
  return (
    <Dialog open={Boolean(scenario)} onOpenChange={onOpenChange}>
      <DialogContent className="w95-dialog gap-0 overflow-hidden sm:max-w-md" showCloseButton={false}>
        <div className="w95-titlebar">
          <Pencil className="h-4 w-4" />
          <DialogTitle className="text-[12px] font-bold text-white">
            Rename scenario
          </DialogTitle>
        </div>
        <form
          className="space-y-3 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && name.trim() !== scenario?.name) onSubmit(name);
          }}
        >
          <DialogDescription className="text-[11px] text-black">
            Update the scenario title without changing its work items.
          </DialogDescription>
          <div className="grid gap-1">
            <Label htmlFor="rename-scenario-name" className="text-[11px] font-bold">
              Scenario name
            </Label>
            <Input
              id="rename-scenario-name"
              className="w95-input h-8 rounded-none text-[11px]"
              value={name}
              maxLength={MAX_SCENARIO_NAME_LENGTH}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <button type="button" className="w95-btn h-7 px-3 text-[11px]" onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className="w95-btn h-7 px-3 text-[11px]"
              disabled={
                pending ||
                !name.trim() ||
                name.trim() === scenario?.name
              }
            >
              {pending ? "Saving..." : "Save"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddItemsDialog({
  open,
  onOpenChange,
  scenario,
  items,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenario: TrackerScenario | null;
  items: WorkItem[];
  onSubmit: (ids: string[]) => void;
  pending: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w95-dialog gap-0 overflow-hidden sm:max-w-xl" showCloseButton={false}>
        <div className="w95-titlebar">
          <Plus className="h-4 w-4" />
          <DialogTitle className="text-[12px] font-bold text-white">
            Move items to {scenario?.name}
          </DialogTitle>
        </div>
        <div className="space-y-3 p-3">
          <DialogDescription className="text-[11px] text-black">
            Select work items currently in Misc.
          </DialogDescription>
          <div className="w95-in max-h-80 overflow-y-auto bg-white p-1">
            {items.length === 0 ? (
              <p className="p-3 text-[11px] text-[#606060]">Misc has no work items.</p>
            ) : (
              items.map((item) => (
                <label key={item.id} className="flex cursor-pointer items-start gap-2 px-2 py-1.5 hover:bg-[#000080] hover:text-white">
                  <Checkbox
                    checked={selected.includes(item.id)}
                    onCheckedChange={(checked) =>
                      setSelected((current) =>
                        checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="mr-1 font-bold">{item.id}</span>
                    {item.title}
                  </span>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <button type="button" className="w95-btn h-7 px-3 text-[11px]" onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="w95-btn h-7 px-3 text-[11px]"
              disabled={pending || selected.length === 0}
              onClick={() => onSubmit(selected)}
            >
              {pending ? "Moving..." : "Move selected"}
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IssueLinkDialog({
  open,
  onOpenChange,
  scenario,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenario: TrackerScenario | null;
  onSubmit: (url: string | null) => void;
  pending: boolean;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (open) setUrl(scenario?.issueUrl ?? "");
  }, [open, scenario]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w95-dialog gap-0 overflow-hidden sm:max-w-xl" showCloseButton={false}>
        <div className="w95-titlebar">
          <GitFork className="h-4 w-4" />
          <DialogTitle className="text-[12px] font-bold text-white">
            Link issue
          </DialogTitle>
        </div>
        <form
          className="space-y-3 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(url.trim() || null);
          }}
        >
          <DialogDescription className="text-[11px] text-black">
            {appConfig.links.issueTrackerBaseUrl
              ? `Use an issue under ${appConfig.links.issueTrackerBaseUrl}.`
              : "Paste the https link to an issue in your team's issue tracker."}
          </DialogDescription>
          <div className="grid gap-1">
            <Label htmlFor="scenario-issue-url" className="text-[11px] font-bold">
              Issue URL
            </Label>
            <Input
              id="scenario-issue-url"
              className="w95-input h-8 rounded-none text-[11px]"
              value={url}
              placeholder={`${appConfig.links.issueTrackerBaseUrl || "https://github.com/contoso/app/issues"}/123`}
              autoFocus
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <DialogFooter>
            <button type="button" className="w95-btn h-7 px-3 text-[11px]" onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            {scenario?.issueUrl && (
              <button type="button" className="w95-btn h-7 px-3 text-[11px]" disabled={pending} onClick={() => onSubmit(null)}>
                Remove link
              </button>
            )}
            <button type="submit" className="w95-btn h-7 px-3 text-[11px]" disabled={pending || !url.trim()}>
              {pending ? "Saving..." : "Save link"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveItemDialog({
  item,
  rows,
  currentScenarioId,
  pending,
  onOpenChange,
  onSubmit,
}: {
  item: WorkItem | null;
  rows: ScenarioRow[];
  currentScenarioId: string | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (scenarioId: string) => void;
}) {
  const [targetScenarioId, setTargetScenarioId] = useState("");
  useEffect(() => {
    if (item) setTargetScenarioId(currentScenarioId ?? "");
  }, [currentScenarioId, item]);
  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent className="w95-dialog gap-0 overflow-hidden sm:max-w-md" showCloseButton={false}>
        <div className="w95-titlebar">
          <GripVertical className="h-4 w-4" />
          <DialogTitle className="text-[12px] font-bold text-white">
            Move work item
          </DialogTitle>
        </div>
        <form
          className="space-y-3 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (targetScenarioId && targetScenarioId !== currentScenarioId) {
              onSubmit(targetScenarioId);
            }
          }}
        >
          <DialogDescription className="text-[11px] text-black">
            Choose a destination for {item?.title ?? "this work item"}.
          </DialogDescription>
          <div className="grid gap-1">
            <Label htmlFor="move-item-scenario" className="text-[11px] font-bold">
              Scenario
            </Label>
            <select
              id="move-item-scenario"
              className="w95-input h-8 rounded-none px-2 text-[11px]"
              value={targetScenarioId}
              autoFocus
              onChange={(event) => setTargetScenarioId(event.target.value)}
            >
              {rows.map(({ scenario }) => (
                <option key={scenario.scenarioId} value={scenario.scenarioId}>
                  {scenario.name}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <button type="button" className="w95-btn h-7 px-3 text-[11px]" onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className="w95-btn h-7 px-3 text-[11px]"
              disabled={
                pending ||
                !targetScenarioId ||
                targetScenarioId === currentScenarioId
              }
            >
              {pending ? "Moving..." : "Move"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ScenarioRow = {
  scenario: TrackerScenario;
  items: WorkItem[];
};

function scenarioColors(index: number) {
  const hue = Math.round((index * 137.508 + 205) % 360);
  return {
    parent: `hsl(${hue} 22% 84%)`,
    nested: `hsl(${hue} 18% 93%)`,
    accent: `hsl(${hue} 32% 46%)`,
  };
}

function WorkItemStatusSelect({
  config,
  item,
  onChanged,
}: {
  config: AdoConfig;
  item: WorkItem;
  onChanged: () => Promise<unknown>;
}) {
  const workItemType = item.workItemType?.trim() ?? "";
  const statesQuery = useQuery({
    queryKey: [
      "ado-work-item-type-states",
      config.organization,
      config.project,
      workItemType,
    ],
    queryFn: () => fetchWorkItemTypeStates(config, workItemType),
    enabled: Boolean(workItemType),
    retry: false,
    staleTime: 30 * 60_000,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: (state: string) =>
      updateWorkItemFields(config, item.id, { state }),
    onSuccess: async (_echo, state) => {
      await onChanged();
      toast.success(`Work item ${item.id} moved to ${state}.`);
    },
    onError: (error) =>
      toast.error(`Couldn’t change the status of ${item.id}.`, {
        description: errorText(error, "Azure DevOps rejected the update."),
      }),
  });
  const states = statesQuery.data ?? [];
  const options = states.some((state) => state.name === item.state)
    ? states
    : [{ name: item.state, category: "" }, ...states];

  return (
    <select
      value={mutation.isPending ? mutation.variables : item.state}
      className="w-full cursor-pointer border-0 bg-transparent font-bold outline-none focus-visible:outline-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-60"
      aria-label={`Change status for ${item.title}`}
      title={
        statesQuery.isError
          ? "Azure DevOps did not return the available states for this work-item type."
          : `Change ${item.id} status`
      }
      disabled={
        mutation.isPending ||
        statesQuery.isPending ||
        statesQuery.isError ||
        !workItemType
      }
      onChange={(event) => mutation.mutate(event.target.value)}
    >
      {options.map((state) => (
        <option key={state.name} value={state.name}>
          {state.name}
        </option>
      ))}
    </select>
  );
}

function ScenarioTable({
  config,
  tracker,
  rows,
  miscItems,
  photos,
  extensionsById,
  notes,
  etaAvailable,
  requesterName,
  onOpenItem,
  onRefreshWorkItems,
  onAddItems,
  onMoveItem,
  onNoteDraftChange,
  onCreateScenarioFromItem,
  onEditIssue,
  onRename,
  onDelete,
  mutationPending,
}: {
  config: AdoConfig;
  tracker: TrackerItem;
  rows: ScenarioRow[];
  miscItems: WorkItem[];
  photos: Record<string, string>;
  extensionsById: Map<string, WorkItemNoteRecord>;
  notes: WorkItemNotes;
  etaAvailable: boolean;
  requesterName: string;
  onOpenItem: (item: WorkItem) => void;
  onRefreshWorkItems: () => Promise<unknown>;
  onAddItems: (scenario: TrackerScenario) => void;
  onMoveItem: (itemId: string, scenarioId: string) => void;
  onNoteDraftChange: (itemId: string, note: string) => void;
  onCreateScenarioFromItem: (item: WorkItem) => void;
  onEditIssue: (scenario: TrackerScenario) => void;
  onRename: (scenario: TrackerScenario) => void;
  onDelete: (scenario: TrackerScenario) => void;
  mutationPending: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(rows.map((row) => row.scenario.scenarioId)),
  );
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverScenarioId, setDragOverScenarioId] = useState<string | null>(
    null,
  );
  const [moveDialogItem, setMoveDialogItem] = useState<WorkItem | null>(null);
  const didDragRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const scenarioKey = rows.map((row) => row.scenario.scenarioId).join("\u0000");
  useEffect(() => {
    setExpanded(new Set(scenarioKey ? scenarioKey.split("\u0000") : []));
  }, [scenarioKey, tracker.id]);
  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );
  const allExpanded =
    rows.length > 0 &&
    rows.every((row) => expanded.has(row.scenario.scenarioId));

  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <button
          type="button"
          className="w95-btn h-7 px-3 text-[11px]"
          onClick={() =>
            setExpanded(
              allExpanded
                ? new Set()
                : new Set(rows.map((row) => row.scenario.scenarioId)),
            )
          }
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              allExpanded && "rotate-90",
            )}
          />
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div className="w95-in overflow-x-auto bg-white">
        <table className="w-full min-w-[1080px] table-fixed border-collapse text-left text-[11px]">
        <thead>
          <tr className="bg-[#c0c0c0]">
            <th className="w-16 border-b border-r border-[#808080] px-1 py-1 text-center font-bold">
              #
            </th>
            <th className="w-[34%] border-b border-r border-[#808080] px-2 py-1 font-bold">Scenario</th>
            <th className="w-48 border-b border-r border-[#808080] px-2 py-1 font-bold">Dev Owner</th>
            <th className="w-28 border-b border-r border-[#808080] px-2 py-1 font-bold">
              ETA
              <span className="block whitespace-nowrap text-[9px] font-normal leading-tight text-[#606060]">[Full Prod Rollout]</span>
            </th>
            <th className="w-20 border-b border-r border-[#808080] px-2 py-1 font-bold">Status</th>
            <th className="w-[30%] border-b border-[#808080] px-2 py-1 font-bold">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ scenario, items }, scenarioIndex) => {
            const owners = scenarioOwners(items);
            const status = scenarioStatus(items);
            const open = expanded.has(scenario.scenarioId);
            const scenarioNumber = scenarioIndex + 1;
            const colors = scenarioColors(scenarioIndex);
            return (
              <Fragment key={scenario.scenarioId}>
                <tr
                  data-tracker-scenario-id={scenario.scenarioId}
                  className={cn(
                    "border-b border-[#808080] transition-[filter] hover:brightness-95",
                    dragOverScenarioId === scenario.scenarioId &&
                      "outline-2 outline-offset-[-2px] outline-[#000080]",
                  )}
                  style={{ backgroundColor: colors.parent }}
                >
                  <td className="border-r border-[#b0b0b0] px-1 py-1 text-center font-bold text-[#606060]">
                    {scenarioNumber}
                  </td>
                  <td className="border-r border-[#b0b0b0] px-2 py-1">
                    <div className="flex min-w-0 items-center gap-1">
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-black"
                        aria-expanded={open}
                        aria-label={`${open ? "Collapse" : "Expand"} ${scenario.name}`}
                        onClick={() =>
                          setExpanded((current) => {
                            const next = new Set(current);
                            if (next.has(scenario.scenarioId)) next.delete(scenario.scenarioId);
                            else next.add(scenario.scenarioId);
                            return next;
                          })
                        }
                      >
                        <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
                      </button>
                      {scenario.scenarioId === MISC_SCENARIO_ID ? (
                        <span className="min-w-0 flex-1 truncate font-bold">
                          {scenario.name}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left font-bold focus-visible:outline-2 focus-visible:outline-black"
                          title="Double-click to rename scenario"
                          onDoubleClick={() => onRename(scenario)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === "F2") {
                              event.preventDefault();
                              onRename(scenario);
                            }
                          }}
                        >
                          {scenario.name}
                        </button>
                      )}
                      <span className="text-[9px] text-[#606060]">{items.length} items</span>
                      {scenario.scenarioId !== MISC_SCENARIO_ID && (
                        <button
                          type="button"
                          className="inline-flex h-5 w-5 items-center justify-center hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-black disabled:opacity-40"
                          title="Move items from Misc"
                          aria-label={`Move items from Misc to ${scenario.name}`}
                          disabled={mutationPending || miscItems.length === 0}
                          onClick={() => onAddItems(scenario)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-black"
                        title="Link issue"
                        aria-label={`Link an issue to ${scenario.name}`}
                        onClick={() => onEditIssue(scenario)}
                      >
                        <GitFork className="h-3.5 w-3.5" />
                      </button>
                      {scenario.scenarioId !== MISC_SCENARIO_ID && (
                        <button
                          type="button"
                          className="inline-flex h-5 w-5 items-center justify-center hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-black"
                          title="Delete scenario"
                          aria-label={`Delete ${scenario.name}`}
                          onClick={() => onDelete(scenario)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {scenario.issueUrl && (
                      <a
                        href={safeUrl(scenario.issueUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-6 mt-0.5 inline-flex items-center gap-1 text-[9px] font-bold text-[#000080] underline"
                      >
                        <GitFork className="h-3 w-3" />
                        Issue {issueNumber(scenario.issueUrl)}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </td>
                  <td className="border-r border-[#b0b0b0] px-2 py-1">
                    <div className="flex min-w-0 items-start gap-1">
                      <div className="flex shrink-0 -space-x-1">
                        {owners.map((owner) => (
                          <PersonAvatar
                            key={owner.email ?? owner.name}
                            name={owner.name}
                            photoUrl={
                              owner.email ? photos[owner.email] : undefined
                            }
                            className="h-4 w-4"
                          />
                        ))}
                      </div>
                      <span
                        className={cn(
                          "line-clamp-2 min-w-0 leading-tight",
                          owners.every((owner) =>
                            isUnassignedPersonName(owner.name),
                          ) && "text-[#606060]",
                        )}
                        title={owners.map((owner) => owner.name).join(", ")}
                      >
                        {owners.map((owner) => owner.name).join(", ")}
                      </span>
                    </div>
                  </td>
                  <td className="border-r border-[#b0b0b0] px-2 py-1 font-bold">{etaLabel(items, etaAvailable)}</td>
                  <td className={cn("border-r border-[#b0b0b0] px-2 py-1 font-bold", status.className)}>{status.label}</td>
                  <td className="px-2 py-1" />
                </tr>
                {open &&
                  items.map((item, itemIndex) => (
                    <ContextMenu key={`${scenario.scenarioId}-${item.id}`}>
                      <ContextMenuTrigger asChild>
                    <tr
                      data-tracker-scenario-id={scenario.scenarioId}
                      className={cn(
                        "border-b border-[#b0b0b0] transition-[filter] hover:brightness-95",
                        draggedItemId === item.id && "opacity-60",
                      )}
                      style={{ backgroundColor: colors.nested }}
                    >
                      <td className="border-r border-[#b0b0b0] px-1 py-1">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="inline-flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-[#606060] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`Move ${item.title} to another scenario`}
                            title="Drag to another scenario, or click to choose"
                            disabled={mutationPending}
                            onClick={() => {
                              if (!didDragRef.current) setMoveDialogItem(item);
                            }}
                            onPointerDown={(event) => {
                              if (
                                mutationPending ||
                                event.button !== 0 ||
                                !event.isPrimary
                              ) {
                                return;
                              }
                              dragCleanupRef.current?.();
                              const pointerId = event.pointerId;
                              const startX = event.clientX;
                              const startY = event.clientY;
                              const previousUserSelect =
                                document.body.style.userSelect;
                              let dragging = false;

                              const scenarioAtPoint = (
                                clientX: number,
                                clientY: number,
                              ) =>
                                document
                                  .elementFromPoint(clientX, clientY)
                                  ?.closest<HTMLElement>(
                                    "[data-tracker-scenario-id]",
                                  )?.dataset.trackerScenarioId ?? null;
                              const cleanup = () => {
                                window.removeEventListener(
                                  "pointermove",
                                  move,
                                );
                                window.removeEventListener(
                                  "pointerup",
                                  finish,
                                );
                                window.removeEventListener(
                                  "pointercancel",
                                  cancel,
                                );
                                window.removeEventListener("blur", blur);
                                document.body.style.userSelect =
                                  previousUserSelect;
                                document.body.classList.remove(
                                  "w95-pointer-dragging",
                                );
                                dragCleanupRef.current = null;
                              };
                              const move = (moveEvent: PointerEvent) => {
                                if (moveEvent.pointerId !== pointerId) return;
                                if (
                                  !dragging &&
                                  Math.hypot(
                                    moveEvent.clientX - startX,
                                    moveEvent.clientY - startY,
                                  ) < 5
                                ) {
                                  return;
                                }
                                if (!dragging) {
                                  dragging = true;
                                  didDragRef.current = true;
                                  setDraggedItemId(item.id);
                                  document.body.style.userSelect = "none";
                                  document.body.classList.add(
                                    "w95-pointer-dragging",
                                  );
                                }
                                moveEvent.preventDefault();
                                setDragOverScenarioId(
                                  scenarioAtPoint(
                                    moveEvent.clientX,
                                    moveEvent.clientY,
                                  ),
                                );
                              };
                              const finish = (upEvent: PointerEvent) => {
                                if (upEvent.pointerId !== pointerId) return;
                                const targetScenarioId = dragging
                                  ? scenarioAtPoint(
                                      upEvent.clientX,
                                      upEvent.clientY,
                                    )
                                  : null;
                                cleanup();
                                setDraggedItemId(null);
                                setDragOverScenarioId(null);
                                if (
                                  dragging &&
                                  targetScenarioId &&
                                  targetScenarioId !== scenario.scenarioId
                                ) {
                                  onMoveItem(item.id, targetScenarioId);
                                }
                                window.setTimeout(() => {
                                  didDragRef.current = false;
                                }, 0);
                              };
                              const cancelGesture = () => {
                                cleanup();
                                setDraggedItemId(null);
                                setDragOverScenarioId(null);
                                window.setTimeout(() => {
                                  didDragRef.current = false;
                                }, 0);
                              };
                              const cancel = (cancelEvent: PointerEvent) => {
                                if (cancelEvent.pointerId !== pointerId) return;
                                cancelGesture();
                              };
                              const blur = () => cancelGesture();

                              dragCleanupRef.current = cleanup;
                              window.addEventListener("pointermove", move, {
                                passive: false,
                              });
                              window.addEventListener("pointerup", finish);
                              window.addEventListener("pointercancel", cancel);
                              window.addEventListener("blur", blur);
                            }}
                          >
                            <GripVertical className="h-4 w-4" />
                          </button>
                          <span className="font-bold text-[#606060]">
                            {scenarioNumber}.{itemIndex + 1}
                          </span>
                        </div>
                      </td>
                      <td
                        className="border-l-8 border-r border-[#b0b0b0] py-1 pl-12 pr-2"
                        style={{ borderLeftColor: colors.accent }}
                      >
                        <div className="flex min-w-0 items-center">
                          <button type="button" className="min-w-0 flex-1 truncate text-left font-normal hover:underline" onClick={() => onOpenItem(item)}>
                            <span className="mr-1 text-[#606060]">↳</span>
                            {item.title}
                          </button>
                        </div>
                      </td>
                      <td className="border-r border-[#b0b0b0] px-2 py-1">
                        <span className="flex min-w-0 items-center gap-1">
                          <PersonAvatar
                            name={item.assignee?.trim() || "Unassigned"}
                            photoUrl={
                              item.assigneeEmail
                                ? photos[item.assigneeEmail.trim().toLowerCase()]
                                : undefined
                            }
                            className="h-4 w-4"
                          />
                          <span
                            className={cn(
                              "truncate",
                              isUnassignedPersonName(item.assignee ?? "") &&
                                "text-[#606060]",
                            )}
                          >
                            {item.assignee?.trim() || "Unassigned"}
                          </span>
                        </span>
                      </td>
                      <td className="border-r border-[#b0b0b0] px-2 py-1">
                        <div className="space-y-1">
                          <span className="block">
                            {etaLabel([item], etaAvailable)}
                          </span>
                          {etaAvailable && (
                            <EtaRequestButton
                              item={item}
                              requesterName={requesterName}
                            />
                          )}
                        </div>
                      </td>
                      <td className={cn("border-r border-[#b0b0b0] px-2 py-1", scenarioStatus([item]).className)}>
                        <WorkItemStatusSelect
                          config={config}
                          item={item}
                          onChanged={() => onRefreshWorkItems()}
                        />
                      </td>
                      <td
                        className="px-2 py-1"
                        onContextMenu={(event) => event.stopPropagation()}
                      >
                        <TrackerNoteEditor
                          extension={extensionsById.get(workItemNoteKey(item.id))}
                          notes={notes}
                          workItemId={item.id}
                          workItemTitle={item.title}
                          onDraftChange={(note) =>
                            onNoteDraftChange(item.id, note)
                          }
                        />
                      </td>
                    </tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w95-menu !relative !left-auto !top-auto min-w-[240px] rounded-none border-0 p-0 text-[11px] shadow-none data-[state=closed]:animate-none data-[state=open]:animate-none">
                        <ContextMenuItem
                          className="rounded-none px-2 py-1.5 focus:bg-[#000080] focus:text-white"
                          disabled={
                            mutationPending ||
                            rows.some(
                              ({ scenario: candidate }) =>
                                candidate.name.trim().toLowerCase() ===
                                  item.title.trim().toLowerCase(),
                            )
                          }
                          onSelect={() => onCreateScenarioFromItem(item)}
                        >
                          <ListTree className="h-3.5 w-3.5" />
                          Create scenario from work item
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
        </table>
        <MoveItemDialog
        item={moveDialogItem}
        rows={rows}
        currentScenarioId={
          moveDialogItem
            ? rows.find(({ items }) =>
                items.some((item) => item.id === moveDialogItem.id),
              )?.scenario.scenarioId ?? null
            : null
        }
        pending={mutationPending}
        onOpenChange={(open) => {
          if (!open) setMoveDialogItem(null);
        }}
        onSubmit={(scenarioId) => {
          if (!moveDialogItem) return;
          onMoveItem(moveDialogItem.id, scenarioId);
          setMoveDialogItem(null);
        }}
        />
      </div>
    </div>
  );
}

function clipboardPayload(
  tracker: TrackerItem,
  rows: ScenarioRow[],
  etaAvailable: boolean,
  extensionsById: Map<string, WorkItemNoteRecord>,
  noteDrafts: Record<string, string>,
): { html: string; plainText: string } {
  const cell = "border:1px solid #808080;padding:6px 8px;vertical-align:top";
  const htmlRows = rows
    .flatMap(({ scenario, items }, scenarioIndex) => {
      const scenarioNumber = scenarioIndex + 1;
      const status = scenarioStatus(items);
      const issue = scenario.issueUrl && safeUrl(scenario.issueUrl)
        ? `<br><a href="${escapeHtml(scenario.issueUrl)}">Issue ${escapeHtml(issueNumber(scenario.issueUrl))}</a>`
        : "";
      const scenarioRow = `<tr><td style="${cell};text-align:center"><strong>${scenarioNumber}</strong></td><td style="${cell}"><strong>${escapeHtml(scenario.name)}</strong>${issue}</td><td style="${cell}">${escapeHtml(scenarioOwners(items).map((owner) => owner.name).join(", "))}</td><td style="${cell}">${escapeHtml(etaLabel(items, etaAvailable))}</td><td style="${cell};background:${status.color}"><strong>${status.label}</strong></td><td style="${cell}"></td></tr>`;
      const itemRows = items.map((item, itemIndex) => {
        const itemStatus = scenarioStatus([item]);
        return `<tr><td style="${cell};text-align:center">${scenarioNumber}.${itemIndex + 1}</td><td style="${cell};padding-left:24px">${escapeHtml(item.title)}</td><td style="${cell}">${escapeHtml(item.assignee?.trim() || "Unassigned")}</td><td style="${cell}">${escapeHtml(etaLabel([item], etaAvailable))}</td><td style="${cell};background:${itemStatus.color}"><strong>${itemStatus.label}</strong></td><td style="${cell}">${escapeHtml(noteDrafts[item.id] ?? extensionsById.get(item.id)?.note ?? "")}</td></tr>`;
      });
      return [scenarioRow, ...itemRows];
    })
    .join("");
  const html = `<h2>${escapeHtml(tracker.name)}</h2><p>${escapeHtml(tracker.description)}</p><table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px"><thead><tr><th style="${cell}">#</th><th style="${cell}">Scenario / Work Item</th><th style="${cell}">Dev Owner</th><th style="${cell}">ETA [Full Prod Rollout]</th><th style="${cell}">Status</th><th style="${cell}">Notes</th></tr></thead><tbody>${htmlRows}</tbody></table>`;
  const plainRows = rows.flatMap(({ scenario, items }, scenarioIndex) => {
    const scenarioNumber = scenarioIndex + 1;
    return [
      [
        String(scenarioNumber),
        scenario.name,
        scenarioOwners(items).map((owner) => owner.name).join(", "),
        etaLabel(items, etaAvailable),
        scenarioStatus(items).label,
        "",
      ],
      ...items.map((item, itemIndex) => [
        `${scenarioNumber}.${itemIndex + 1}`,
        item.title,
        item.assignee?.trim() || "Unassigned",
        etaLabel([item], etaAvailable),
        scenarioStatus([item]).label,
        noteDrafts[item.id] ?? extensionsById.get(workItemNoteKey(item.id))?.note ?? "",
      ]),
    ];
  });
  const plainText = [
    tracker.name,
    tracker.description,
    "",
    "#\tScenario / Work Item\tDev Owner\tETA [Full Prod Rollout]\tStatus\tNotes",
    ...plainRows.map((row) =>
      row
        .map((value) => value.replace(/[\t\r\n]+/g, " ").trim())
        .join("\t"),
    ),
  ].join("\n");
  return { html, plainText };
}

export function TrackersPanel({
  config,
  requesterName,
  onOpenItem,
}: {
  config: AdoConfig;
  requesterName: string;
  onOpenItem: (item: WorkItem) => void;
}) {
  const queryClient = useQueryClient();
  const trackerStore = useAppCollection(trackersCollection);
  const scenarioStore = useAppCollection(trackerScenariosCollection);
  const noteStore = useAppCollection(workItemNotesCollection);
  useInvalidateOnChange(trackerStore, TRACKERS_QUERY_KEY);
  useInvalidateOnChange(scenarioStore, TRACKER_SCENARIOS_QUERY_KEY);
  useInvalidateOnChange(noteStore, WORK_ITEM_NOTES_QUERY_KEY);
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTrackerId = searchParams.get("tracker")?.trim() || null;
  const [createTrackerOpen, setCreateTrackerOpen] = useState(false);
  const [editTrackerOpen, setEditTrackerOpen] = useState(false);
  const [createScenarioOpen, setCreateScenarioOpen] = useState(false);
  const [renameScenario, setRenameScenario] = useState<TrackerScenario | null>(
    null,
  );
  const [addItemsScenario, setAddItemsScenario] = useState<TrackerScenario | null>(null);
  const [issueScenario, setIssueScenario] = useState<TrackerScenario | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const tagConfig = useTagConfig();

  const trackersQuery = useQuery({
    queryKey: TRACKERS_QUERY_KEY,
    queryFn: () => listTrackers(trackerStore),
    retry: false,
    staleTime: 5 * 60_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: false,
  });
  const trackers = useMemo(() => trackersQuery.data ?? [], [trackersQuery.data]);
  const selected =
    trackers.find((tracker) => tracker.id === requestedTrackerId) ??
    trackers[0] ??
    null;
  const queryTags = selected?.tags ?? [];
  const tagSignature = queryTags.map(normalizeTag).sort().join("|");

  function selectTracker(trackerId: string) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "trackers");
    next.set("tracker", trackerId);
    next.delete("workItem");
    setSearchParams(next, { preventScrollReset: true });
  }

  useEffect(() => {
    if (trackersQuery.isPending || trackersQuery.isError) return;
    const canonicalId = selected?.id ?? null;
    if (canonicalId === requestedTrackerId) return;
    const next = new URLSearchParams(searchParams);
    next.set("tab", "trackers");
    if (canonicalId) next.set("tracker", canonicalId);
    else next.delete("tracker");
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }, [
    requestedTrackerId,
    searchParams,
    selected?.id,
    setSearchParams,
    trackersQuery.isError,
    trackersQuery.isPending,
  ]);

  const workQuery = useQuery<FetchTrackerResult>({
    queryKey: [
      TRACKER_WORK_QUERY_KEY,
      config.organization,
      config.project,
      config.areaRoot,
      selected?.id ?? "",
      tagSignature,
    ],
    queryFn: () => fetchTrackerWorkItems(config, queryTags),
    enabled: Boolean(selected && queryTags.length > 0),
    retry: false,
    staleTime: 2 * 60_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: false,
  });
  const scenarioQuery = useQuery({
    queryKey: [...TRACKER_SCENARIOS_QUERY_KEY, selected?.id ?? ""],
    queryFn: () => getTrackerScenarioSet(scenarioStore, selected?.id ?? ""),
    enabled: Boolean(selected),
    retry: false,
    staleTime: 2 * 60_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: false,
  });
  const items = useMemo(() => workQuery.data?.items ?? [], [workQuery.data]);
  const extensionIdSignature = useMemo(
    () => items.map((item) => item.id).sort().join("|"),
    [items],
  );
  const extensionsQuery = useQuery({
    queryKey: [
      ...WORK_ITEM_NOTES_QUERY_KEY,
      config.organization,
      extensionIdSignature,
    ],
    queryFn: () =>
      loadWorkItemNotes(
        noteStore,
        items.map((item) => item.id),
      ),
    enabled: items.length > 0,
    retry: false,
    staleTime: 2 * 60_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: false,
  });
  const extensionsById = useMemo(
    () =>
      new Map(
        (extensionsQuery.data ?? []).map(
          (note) => [note.id, note] as const,
        ),
      ),
    [extensionsQuery.data],
  );
  const scenarios = useMemo(
    () => trackerScenarios(scenarioQuery.data),
    [scenarioQuery.data],
  );
  const itemById = new Map(items.map((item) => [item.id, item] as const));
  const assignedIds = new Set(
    scenarios
      .filter((scenario) => scenario.scenarioId !== MISC_SCENARIO_ID)
      .flatMap((scenario) => scenario.workItemIds),
  );
  const miscItems = items.filter((item) => !assignedIds.has(item.id));
  const rows: ScenarioRow[] = scenarios.map((scenario) => ({
    scenario,
    items:
      scenario.scenarioId === MISC_SCENARIO_ID
        ? miscItems
        : scenario.workItemIds.flatMap((id) => {
            const item = itemById.get(id);
            return item ? [item] : [];
          }),
  }));
  const photos = usePersonPhotos(
    items
      .map((item) => item.assigneeEmail?.trim().toLowerCase() ?? "")
      .filter(Boolean),
  );
  const etaAvailable = workQuery.data?.hydrateMode !== "list-fallback";

  function updateScenarioCache(saved: TrackerScenarioSet) {
    queryClient.setQueryData(
      [...TRACKER_SCENARIOS_QUERY_KEY, saved.trackerId],
      saved,
    );
    void queryClient.invalidateQueries({
      queryKey: [...TRACKER_SCENARIOS_QUERY_KEY, saved.trackerId],
    });
  }

  const scenarioMutation = useMutation({
    mutationFn: (operation: () => Promise<TrackerScenarioSet>) => operation(),
    onSuccess: updateScenarioCache,
    onError: (error) =>
      toast.error("Couldn’t update the scenarios.", {
        description: errorText(error, "The scenario store did not respond."),
      }),
  });

  const selectedTags = selected
    ? selected.tags.flatMap((tag) => {
        const resolved = tagConfig.tags.find(
          (candidate) => normalizeTag(candidate.tag) === normalizeTag(tag),
        );
        return resolved ? [resolved] : [];
      })
    : [];

  async function copyTable() {
    if (!selected) return;
    try {
      const result = await copyHtmlToClipboard(
        clipboardPayload(
          selected,
          rows,
          etaAvailable,
          extensionsById,
          noteDrafts,
        ),
      );
      toast.success(
        result === "rich"
          ? "Rich scenario table copied."
          : "Scenario table copied as plain text.",
      );
    } catch (error) {
      toast.error("Couldn’t copy the scenario table.", {
        description: errorText(error, "Clipboard access was rejected."),
      });
    }
  }

  async function copyTrackerLink() {
    if (!selected) return;
    try {
      await copyLinkToClipboard({
        url: appLink({ tab: "trackers", tracker: selected.id }),
        label: `Task Manager Trackers: ${selected.name}`,
      });
      toast.success("Tracker link copied.");
    } catch (error) {
      toast.error("Couldn’t copy the tracker link.", {
        description: errorText(error, "Clipboard access was rejected."),
      });
    }
  }

  if (trackersQuery.isPending) return <LoadingState rows={5} className="p-4" />;
  if (trackersQuery.isError) {
    return (
      <ErrorState
        title="Trackers could not load"
        description={errorText(trackersQuery.error, "The tracker store did not respond.")}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="w95-tabstrip min-h-9 shrink-0 border-b-2 border-white px-2 pt-2">
        {trackers.map((tracker) => (
          <button
            key={tracker.id}
            type="button"
            className={cn("w95-tab shrink-0", selected?.id === tracker.id && "w95-tab--active")}
            onClick={() => selectTracker(tracker.id)}
            title={tracker.name}
          >
            <ListTree className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{tracker.name}</span>
          </button>
        ))}
        {(
          <button type="button" className="w95-tab w95-tab--icon" aria-label="Create tracker" title="Create tracker" onClick={() => setCreateTrackerOpen(true)}>
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {selected ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <header className="mb-3 bg-[#dfdfdf] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-bold">{selected.name}</h2>
                <p className="mt-1 max-w-4xl text-[11px] leading-relaxed">{selected.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  <button type="button" className="w95-btn h-8 px-3 text-[11px]" onClick={() => setEditTrackerOpen(true)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit tracker
                  </button>
                )}
                <button type="button" className="w95-btn h-8 px-3 text-[11px]" disabled={workQuery.isPending || workQuery.isError || scenarioQuery.isPending || scenarioQuery.isError || (items.length > 0 && (extensionsQuery.isPending || extensionsQuery.isError))} onClick={() => void copyTable()}>
                  <ClipboardCopy className="h-3.5 w-3.5" />
                  Copy Table as Text
                </button>
                <button type="button" className="w95-btn h-8 px-3 text-[11px]" onClick={() => void copyTrackerLink()}>
                  <Link2 className="h-3.5 w-3.5" />
                  Copy link
                </button>
                <button
                  type="button"
                  className="w95-btn h-8 px-3 text-[11px]"
                  disabled={
                    workQuery.isFetching ||
                    scenarioQuery.isFetching ||
                    extensionsQuery.isFetching
                  }
                  onClick={() => {
                    void trackersQuery.refetch();
                    void workQuery.refetch();
                    void scenarioQuery.refetch();
                    void extensionsQuery.refetch();
                  }}
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5",
                      (workQuery.isFetching ||
                        scenarioQuery.isFetching ||
                        extensionsQuery.isFetching) &&
                        "animate-spin",
                    )}
                  />
                  Refresh
                </button>
                <button type="button" className="w95-btn h-8 px-3 text-[11px] font-bold" onClick={() => setCreateScenarioOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Add scenario
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Tag className="h-3.5 w-3.5" />
              {selectedTags.map((tag) =>
                tag.marker === "none" ? (
                  <span key={tag.key} className="border border-[#808080] bg-[#efefef] px-1.5 py-0.5 text-[9px] font-medium">{tag.label}</span>
                ) : (
                  <TagChip key={tag.key} tag={tag} />
                ),
              )}
            </div>
          </header>

          {queryTags.length === 0 ? (
            <ErrorState title="This tracker has no available tags" description="Edit the tracker and select at least one registered tag." />
          ) : workQuery.isPending || scenarioQuery.isPending || (items.length > 0 && extensionsQuery.isPending) ? (
            <LoadingState rows={6} />
          ) : workQuery.isError ? (
            <ErrorState title="Tracker work items could not load" description={errorText(workQuery.error, "Azure DevOps did not return the tracker work.")} />
          ) : scenarioQuery.isError ? (
            <ErrorState
              title="Scenarios could not load"
              description={errorText(scenarioQuery.error, "The scenario store did not respond.")}
            />
          ) : items.length > 0 && extensionsQuery.isError ? (
            <ErrorState
              title="Work-item notes could not load"
              description={errorText(
                extensionsQuery.error,
                "The work-item notes could not be read.",
              )}
            />
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-3 text-[10px]">
                <span className="flex items-center gap-1"><ListTree className="h-3 w-3" />{rows.length} scenarios</span>
                <span className="flex items-center gap-1"><UserRound className="h-3 w-3" />{items.length} work items</span>
                <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />ETAs indicate full production rollout</span>
              </div>
              <ScenarioTable
                config={config}
                tracker={selected}
                rows={rows}
                miscItems={miscItems}
                photos={photos}
                extensionsById={extensionsById}
                notes={noteStore}
                etaAvailable={etaAvailable}
                requesterName={requesterName}
                onOpenItem={onOpenItem}
                onRefreshWorkItems={() => workQuery.refetch()}
                mutationPending={scenarioMutation.isPending}
                onAddItems={setAddItemsScenario}
                onMoveItem={(itemId, scenarioId) =>
                  scenarioMutation.mutate(() =>
                    moveTrackerWorkItems(scenarioStore, selected.id, [itemId], scenarioId),
                  )
                }
                onNoteDraftChange={(itemId, note) =>
                  setNoteDrafts((current) => ({
                    ...current,
                    [itemId]: note,
                  }))
                }
                onCreateScenarioFromItem={(item) =>
                  scenarioMutation.mutate(
                    () =>
                      createTrackerScenarioFromWorkItem(
                        scenarioStore,
                        selected.id,
                        item.title,
                        item.id,
                      ),
                    {
                      onSuccess: () =>
                        toast.success(`Created scenario “${item.title}”.`),
                    },
                  )
                }
                onEditIssue={setIssueScenario}
                onRename={setRenameScenario}
                onDelete={async (scenario) => {
                  const accepted = await confirm({
                    title: "Delete scenario?",
                    description: `Delete “${scenario.name}”? Its work items will return to Misc.`,
                    confirmLabel: "Delete",
                    destructive: true,
                  });
                  if (accepted) {
                    scenarioMutation.mutate(() =>
                      deleteTrackerScenario(scenarioStore, selected.id, scenario.scenarioId),
                    );
                  }
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={ListTree}
          title="No trackers yet"
          description="Create a tracker to organize its tagged work into scenarios."
          action={
            <button type="button" className="w95-btn" onClick={() => setCreateTrackerOpen(true)}>
              <Plus className="h-3 w-3" /> Create tracker
            </button>
          }
        />
      )}

      <ScenarioDialog
        open={createScenarioOpen}
        onOpenChange={setCreateScenarioOpen}
        pending={scenarioMutation.isPending}
        onSubmit={(name) => {
          if (!selected) return;
          scenarioMutation.mutate(
            () => createTrackerScenario(scenarioStore, selected.id, name),
            { onSuccess: () => setCreateScenarioOpen(false) },
          );
        }}
      />
      <RenameScenarioDialog
        scenario={renameScenario}
        pending={scenarioMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setRenameScenario(null);
        }}
        onSubmit={(name) => {
          if (!selected || !renameScenario) return;
          scenarioMutation.mutate(
            () =>
              renameTrackerScenario(
                scenarioStore,
                selected.id,
                renameScenario.scenarioId,
                name,
              ),
            {
              onSuccess: () => {
                setRenameScenario(null);
                toast.success("Scenario renamed.");
              },
            },
          );
        }}
      />
      <AddItemsDialog
        open={Boolean(addItemsScenario)}
        onOpenChange={(open) => {
          if (!open) setAddItemsScenario(null);
        }}
        scenario={addItemsScenario}
        items={miscItems}
        pending={scenarioMutation.isPending}
        onSubmit={(ids) => {
          if (!selected || !addItemsScenario) return;
          scenarioMutation.mutate(
            () => moveTrackerWorkItems(scenarioStore, selected.id, ids, addItemsScenario.scenarioId),
            { onSuccess: () => setAddItemsScenario(null) },
          );
        }}
      />
      <IssueLinkDialog
        open={Boolean(issueScenario)}
        onOpenChange={(open) => {
          if (!open) setIssueScenario(null);
        }}
        scenario={issueScenario}
        pending={scenarioMutation.isPending}
        onSubmit={(url) => {
          if (!selected || !issueScenario) return;
          scenarioMutation.mutate(
            () => linkTrackerScenarioIssue(scenarioStore, selected.id, issueScenario.scenarioId, url),
            { onSuccess: () => setIssueScenario(null) },
          );
        }}
      />

      {(
        <>
          <TrackerDialog
            open={createTrackerOpen}
            onOpenChange={setCreateTrackerOpen}
            trackers={trackers}
            tags={tagConfig.tags}
            onSaved={selectTracker}
          />
          {selected && (
            <TrackerDialog
              open={editTrackerOpen}
              onOpenChange={setEditTrackerOpen}
              trackers={trackers}
              tags={tagConfig.tags}
              tracker={selected}
              onSaved={selectTracker}
            />
          )}
        </>
      )}
    </div>
  );
}
