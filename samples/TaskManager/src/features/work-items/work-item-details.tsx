import { AddTaskDialog, type AssigneeOption, } from "@/components/add-task-dialog";
import { PersonAvatar as EngineerAvatar } from "@/components/person-avatar";
import { SafeRichText } from "@/components/safe-rich-text";
import { ErrorState } from "@/components/states";
import { DetailTagChips } from "@/components/tag-chips";
import { EtaRequestButton } from "@/features/trackers/eta-request-button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger, } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StateOptionLabel } from "@/features/work-items/state-option-label";
import { useConfirm } from "@/hooks/use-confirm";
import { useIsMenuTarget } from "@/hooks/use-menu-target";
import { useWorkItemDetailPrefetch } from "@/hooks/use-work-item-detail-prefetch";
import {
  ADO_WORK_ITEM_TYPE,
  categoryAreaPath,
  fetchDescendantWorkItems,
  fetchProjectMembers,
  fetchWorkItemTypeStates,
  isKnownAreaCode,
  workItemUrl,
  type AdoConfig,
  type ChildWorkItem,
} from "@/lib/ado";
import { adoWriteIdentity, type CurrentUser } from "@/lib/current-user";
import {
  normalizeIdentityEmail,
  normalizeIdentityName,
  type EngineerSection,
} from "@/lib/engineer-identity";
import { usePersonPhotos } from "@/lib/people-photos";
import { safeUrl } from "@/lib/safe-url";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  AREAS,
  ENGINEERS,
  STORY_STATES,
  areaMeta,
  compareChildrenNewestFirst,
  createdLabels,
  stateMeta,
  type StoryState,
  type WorkItem,
} from "@/lib/work-items-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  ClipboardCheck,
  ExternalLink,
  Link2,
  ListPlus,
  ListTree,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

function parseDateOnly(value: string | null | undefined): Date | undefined {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDateOnly(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function displayDateOnly(value: string | null | undefined): string {
  const date = parseDateOnly(value);
  return date
    ? date.toLocaleDateString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "No date selected";
}

export function WorkItemDetailsLayer({
  items,
  ...props
}: {
  items: WorkItem[];
  config: AdoConfig;
  hasConnection: boolean;
  currentUser: CurrentUser | null;
  engineerSections: EngineerSection[];
  onNestedContextMenu: (child: ChildWorkItem, x: number, y: number) => void;
  onDeleteItem: (item: WorkItem, typeLabel: string | null) => Promise<boolean>;
  onRefreshItem: (item: WorkItem) => Promise<WorkItem>;
  onCopyLink: (item: WorkItem) => Promise<void>;
  onSaveItem: (
    item: WorkItem,
    patch: Partial<WorkItem>,
  ) => Promise<string | null>;
}) {
  const { selectedId, fallback, preparedItem } = useAppStore(
    useShallow((state) => ({
      selectedId: state.selectedWorkItemId,
      fallback: state.selectedWorkItemFallback,
      preparedItem: state.preparedWorkItem,
    })),
  );
  const selectedItem =
    items.find((item) => item.id === selectedId) ??
    (fallback?.id === selectedId ? fallback : null);
  const preloadedItem = selectedItem ?? preparedItem;
  if (!preloadedItem) return null;
  return (
    <ReadyWorkItemDetailsLayer
      items={items}
      preloadedItem={preloadedItem}
      {...props}
    />
  );
}

function ReadyWorkItemDetailsLayer({
  items,
  preloadedItem,
  config,
  hasConnection,
  currentUser,
  engineerSections,
  onNestedContextMenu,
  onDeleteItem,
  onRefreshItem,
  onCopyLink,
  onSaveItem,
}: {
  items: WorkItem[];
  preloadedItem: WorkItem;
  config: AdoConfig;
  hasConnection: boolean;
  currentUser: CurrentUser | null;
  engineerSections: EngineerSection[];
  onNestedContextMenu: (child: ChildWorkItem, x: number, y: number) => void;
  onDeleteItem: (item: WorkItem, typeLabel: string | null) => Promise<boolean>;
  onRefreshItem: (item: WorkItem) => Promise<WorkItem>;
  onCopyLink: (item: WorkItem) => Promise<void>;
  onSaveItem: (
    item: WorkItem,
    patch: Partial<WorkItem>,
  ) => Promise<string | null>;
}) {
  const {
    selectedId,
    fallback,
    nestedDetailStack,
    openNestedWorkItem,
    closeNestedWorkItem,
    closeWorkItem,
  } = useAppStore(
    useShallow((state) => ({
      selectedId: state.selectedWorkItemId,
      fallback: state.selectedWorkItemFallback,
      nestedDetailStack: state.nestedDetailStack,
      openNestedWorkItem: state.openNestedWorkItem,
      closeNestedWorkItem: state.closeNestedWorkItem,
      closeWorkItem: state.closeWorkItem,
    })),
  );
  const selectedItem =
    items.find((item) => item.id === selectedId) ??
    (fallback?.id === selectedId ? fallback : null);
  const displayItem = selectedItem ?? preloadedItem;
  const detailsOpen = selectedItem !== null || nestedDetailStack.length > 0;
  const projectMembersQuery = useQuery({
    queryKey: [
      "ado-project-members",
      config.organization,
      config.project,
    ],
    queryFn: () => fetchProjectMembers(config),
    enabled: hasConnection && detailsOpen,
    retry: false,
    staleTime: 30 * 60_000,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const assignees = useMemo<AssigneeOption[]>(() => {
    const byEmail = new Map<string, AssigneeOption>();
    const rosterNames = new Set(ENGINEERS.map(normalizeIdentityName));
    const selfEmail = normalizeIdentityEmail(adoWriteIdentity(currentUser));
    if (currentUser && selfEmail) {
      byEmail.set(selfEmail, {
        email: selfEmail,
        name: currentUser.displayName,
        isSelf: true,
      });
    }
    for (const member of projectMembersQuery.data ?? []) {
      if (!rosterNames.has(normalizeIdentityName(member.name))) continue;
      const email = normalizeIdentityEmail(member.email);
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, { email, name: member.name });
    }
    for (const section of engineerSections) {
      const email = normalizeIdentityEmail(section.email);
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, { email, name: section.name });
    }
    return [...byEmail.values()].sort(
      (a, b) =>
        Number(Boolean(b.isSelf)) - Number(Boolean(a.isSelf)) ||
        a.name.localeCompare(b.name),
    );
  }, [currentUser, engineerSections, projectMembersQuery.data]);
  const assigneesError = projectMembersQuery.isError
    ? projectMembersQuery.error instanceof Error
      ? projectMembersQuery.error.message
      : "Couldn't load the full Azure DevOps team roster."
    : null;

  return (
    <>
      <StoryDetailDialog
        key={displayItem.id}
        item={displayItem}
        open={selectedItem !== null}
        forceMount
        config={config}
        assignees={assignees}
        assigneesLoading={projectMembersQuery.isLoading}
        assigneesError={assigneesError}
        areaRoot={config.areaRoot}
        activeLayer={nestedDetailStack.length === 0}
        requesterName={currentUser?.displayName ?? "A teammate"}
        onOpenNested={openNestedWorkItem}
        onNestedContextMenu={onNestedContextMenu}
        onDelete={async () => {
          if (!selectedItem) return;
          const deleted = await onDeleteItem(
            selectedItem,
            selectedItem.workItemType ?? null,
          );
          if (deleted) closeWorkItem();
        }}
        onRefresh={async () => {
          if (!selectedItem) throw new Error("No work item is open.");
          return onRefreshItem(selectedItem);
        }}
        onCopyLink={() => onCopyLink(displayItem)}
        onClose={closeWorkItem}
        onSave={async (patch) => {
          if (!selectedItem) return "No work item is open.";
          const error = await onSaveItem(selectedItem, patch);
          if (!error) closeWorkItem();
          return error;
        }}
      />

      {nestedDetailStack.map((nestedItem, index) => {
        const activeLayer = index === nestedDetailStack.length - 1;
        return (
          <StoryDetailDialog
            key={`${nestedItem.id}-${index}`}
            item={nestedItem}
            config={config}
            assignees={assignees}
            assigneesLoading={projectMembersQuery.isLoading}
            assigneesError={assigneesError}
            areaRoot={config.areaRoot}
            nestedDepth={index + 1}
            activeLayer={activeLayer}
            requesterName={currentUser?.displayName ?? "A teammate"}
            onOpenNested={openNestedWorkItem}
            onNestedContextMenu={onNestedContextMenu}
            onDelete={async () => {
              if (!activeLayer) return;
              const deleted = await onDeleteItem(
                nestedItem,
                nestedItem.workItemType,
              );
              if (deleted) closeNestedWorkItem();
            }}
            onRefresh={() => onRefreshItem(nestedItem)}
            onCopyLink={() => onCopyLink(nestedItem)}
            onClose={() => {
              if (activeLayer) closeNestedWorkItem();
            }}
            onSave={async (patch) => {
              if (!activeLayer) return "Another work item is open above this one.";
              const error = await onSaveItem(nestedItem, patch);
              if (!error) closeNestedWorkItem();
              return error;
            }}
          />
        );
      })}
    </>
  );
}

function hideDialogSiblings(dialog: HTMLElement) {
  const changed: Array<{ element: Element; previous: string | null }> = [];
  let current: Element | null = dialog;
  while (current?.parentElement) {
    for (const sibling of current.parentElement.children) {
      if (sibling === current || sibling.tagName === "SCRIPT") continue;
      changed.push({
        element: sibling,
        previous: sibling.getAttribute("aria-hidden"),
      });
      sibling.setAttribute("aria-hidden", "true");
    }
    current = current.parentElement;
  }
  return () => {
    for (const { element, previous } of changed) {
      if (previous === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", previous);
    }
  };
}

function DetailDialogSurface({
  persistent,
  open,
  activeLayer,
  selectOpenRef,
  onClose,
  nestedDepth,
  children,
}: {
  persistent: boolean;
  open: boolean;
  activeLayer: boolean;
  selectOpenRef: RefObject<boolean>;
  onClose: () => void;
  nestedDepth: number;
  children: ReactNode;
}) {
  const surfaceRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (!persistent || !open || !surfaceRef.current) return;
    const surface = surfaceRef.current;
    const restoreAria = hideDialogSiblings(surface);
    const previousOverflow = document.body.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    surface.focus({ preventScroll: true });
    return () => {
      restoreAria();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, persistent]);

  if (!persistent) {
    const width = Math.max(57, 75 - nestedDepth * 6);
    const height = Math.max(57, 75 - nestedDepth * 6);
    return (
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && activeLayer && !selectOpenRef.current) onClose();
        }}
      >
        <DialogContent
          className="w95-dialog grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden"
          showCloseButton={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.stopPropagation();
            if (!activeLayer || selectOpenRef.current) event.preventDefault();
          }}
          overlayStyle={{ zIndex: 69 + nestedDepth * 10 }}
          style={{
            width: `min(96vw, max(${width}vw, 640px))`,
            maxWidth: `min(96vw, max(${width}vw, 640px))`,
            height: `min(92dvh, max(${height}dvh, 560px))`,
            zIndex: 70 + nestedDepth * 10,
          }}
        >
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open}>
      <div
        hidden={!open}
        className="fixed inset-0 bg-black/50"
        style={{ zIndex: 69 }}
        aria-hidden="true"
      />
      <section
        ref={surfaceRef}
        hidden={!open}
        role="dialog"
        aria-modal="true"
        aria-label="Work item details"
        tabIndex={-1}
        className="w95-dialog fixed left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden outline-none"
        style={{
          width: "min(96vw, max(75vw, 640px))",
          maxWidth: "min(96vw, max(75vw, 640px))",
          height: "min(92dvh, max(75dvh, 560px))",
          zIndex: 70,
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (activeLayer && !selectOpenRef.current) onClose();
            return;
          }
          if (event.key !== "Tab" || !activeLayer) return;
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((element) => !element.hasAttribute("hidden"));
          if (focusable.length === 0) {
            event.preventDefault();
            event.currentTarget.focus();
            return;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last ||
              document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </section>
    </Dialog>
  );
}

/**
 * Work item detail window.
 *
 * Every editable field here IS writable through the connector's UpdateWorkItem
 * operation — title and description are first-class body fields, State goes
 * through `userEnteredFields["System.State"]`. Save sends them to Azure DevOps
 * and only closes when ADO accepted; a rejection keeps the window open with the
 * connector's own message, and the board rolls back.
 *
 * The CATEGORY is editable too: picking one writes that category's area path to
 * [System.AreaPath] — the exact write the Triage reroute performs — with the
 * same optimistic update, rollback and real connector error text. An item whose
 * area is outside the configured categories keeps its real value as the selected
 * option rather than being silently coerced into one of them.
 *
 * Assigned To uses identities returned by Azure DevOps and saves the selected
 * address back to [System.AssignedTo].
 */
function StoryDetailDialog({
  item,
  open,
  forceMount = false,
  config,
  assignees,
  assigneesLoading,
  assigneesError,
  areaRoot,
  nestedDepth = 0,
  activeLayer = true,
  requesterName,
  onOpenNested,
  onNestedContextMenu,
  onDelete,
  onRefresh,
  onCopyLink,
  onClose,
  onSave,
}: {
  item: WorkItem | null;
  open?: boolean;
  forceMount?: boolean;
  config: AdoConfig;
  assignees: AssigneeOption[];
  assigneesLoading: boolean;
  assigneesError: string | null;
  /** Configured ADO area root — the category write derives its path from it. */
  areaRoot: string;
  /** Each nested item adds a progressively smaller foreground window. */
  nestedDepth?: number;
  /** Only the foreground window may react to close/save dismissal events. */
  activeLayer?: boolean;
  requesterName: string;
  onOpenNested: (child: ChildWorkItem) => void;
  onNestedContextMenu: (child: ChildWorkItem, x: number, y: number) => void;
  /** Confirms and moves this work item to the Azure DevOps recycle bin. */
  onDelete: () => Promise<void>;
  /** Fetches the latest fields for this item directly from Azure DevOps. */
  onRefresh: () => Promise<WorkItem>;
  /** Copies the same named Azure DevOps link offered by the card context menu. */
  onCopyLink: () => Promise<void>;
  onClose: () => void;
  // Resolves to null on success, or the real error message on failure.
  onSave: (patch: Partial<WorkItem>) => Promise<string | null>;
}) {
  const dialogOpen = open ?? Boolean(item);
  const [draft, setDraft] = useState<WorkItem | null>(
    item ? { ...item, description: item.descriptionHtml ?? item.description } : null,
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const targetDateId = useId();
  const selectOpenRef = useRef(false);
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const detailPrefetch = useWorkItemDetailPrefetch(config);
  const childrenQuery = useQuery({
    queryKey: [
      "ado-child-work-items",
      "tree",
      config.organization,
      config.project,
      item?.id ?? "",
    ],
    queryFn: () => fetchDescendantWorkItems(config, item ? [item.id] : []),
    enabled: Boolean(item),
    retry: false,
    staleTime: 5 * 60_000,
    // Keep fetched trees for this browser session. Reopening a work item can
    // render the cached hierarchy immediately while stale data refreshes behind it.
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const childItems = useMemo(
    () =>
      [...(item ? childrenQuery.data?.byParent[item.id] ?? [] : [])].sort(
        compareChildrenNewestFirst,
      ),
    [childrenQuery.data, item],
  );
  const childTreeRows = useMemo(() => {
    if (!item || !childrenQuery.data) return [];
    const rows: Array<{
      child: ChildWorkItem;
      depth: number;
      ancestorLast: boolean[];
      isLast: boolean;
    }> = [];
    const rendered = new Set<string>();

    function append(parentId: string, depth: number, ancestorLast: boolean[]) {
      const children = [
        ...(childrenQuery.data?.byParent[parentId] ?? []),
      ].sort(compareChildrenNewestFirst);
      children.forEach((child, index) => {
        if (rendered.has(child.id)) return;
        rendered.add(child.id);
        const isLast = index === children.length - 1;
        rows.push({ child, depth, ancestorLast, isLast });
        append(child.id, depth + 1, [...ancestorLast, isLast]);
      });
    }

    append(item.id, 0, []);
    return rows;
  }, [childrenQuery.data, item]);
  const childPhotos = usePersonPhotos(
    useMemo(
      () =>
        childTreeRows
          .map(({ child }) => normalizeIdentityEmail(child.assigneeEmail))
          .filter((email): email is string => Boolean(email)),
      [childTreeRows],
    ),
  );
  const workItemType = item?.workItemType?.trim() || ADO_WORK_ITEM_TYPE;
  const typeStatesQuery = useQuery({
    queryKey: [
      "ado-work-item-type-states",
      config.organization,
      config.project,
      workItemType,
    ],
    queryFn: () => fetchWorkItemTypeStates(config, workItemType),
    enabled: Boolean(item),
    retry: false,
    staleTime: 30 * 60_000,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useLayoutEffect(() => {
    setDraft(
      item ? { ...item, description: item.descriptionHtml ?? item.description } : null,
    );
    setError(null);
    setAddTaskOpen(false);
    setDescriptionEditing(false);
    selectOpenRef.current = false;
  }, [dialogOpen, item]);

  useLayoutEffect(() => {
    setSaving(false);
    setDeleting(false);
    setRefreshing(false);
  }, [dialogOpen, item?.id]);

  const adoUrl = item ? safeUrl(workItemUrl(config, item.id)) : null;
  const savedTitle =
    draft && item ? draft.title.trim() || item.title : draft?.title ?? "";
  const hasChanges = Boolean(
    draft &&
      item &&
      (savedTitle !== item.title ||
        draft.description !== (item.descriptionHtml ?? item.description) ||
        draft.state !== item.state ||
        draft.area !== item.area ||
        draft.areaPath !== item.areaPath ||
        draft.assignee !== item.assignee ||
        draft.assigneeEmail !== item.assigneeEmail ||
        (draft.targetDate ?? null) !== (item.targetDate ?? null)),
  );
  const busy = saving || deleting || refreshing;

  // The state selector offers exactly: New, Committed, Active, Closed, Removed
  // (STORY_STATES). If the item's REAL state from ADO isn't one of those, it is
  // prepended so it stays visible and selected — the value is never silently
  // coerced to a listed state or lost on save.
  const stateOptions = useMemo(() => {
    const list: string[] =
      typeStatesQuery.data?.map((state) => state.name) ?? [...STORY_STATES];
    if (draft?.state && !list.includes(draft.state)) list.unshift(draft.state);
    return list;
  }, [draft?.state, typeStatesQuery.data]);
  const assignmentOptions = useMemo(() => {
    const options = [...assignees];
    const currentEmail = normalizeIdentityEmail(draft?.assigneeEmail);
    if (
      draft?.assignee &&
      currentEmail &&
      !options.some((option) => option.email === currentEmail)
    ) {
      options.push({ email: currentEmail, name: draft.assignee });
    }
    return options;
  }, [assignees, draft?.assignee, draft?.assigneeEmail]);
  const detailPhotos = usePersonPhotos(
    useMemo(
      () =>
        [
          ...assignmentOptions.map((option) => option.email),
          item?.createdByEmail,
        ].filter((email): email is string => Boolean(email)),
      [assignmentOptions, item?.createdByEmail],
    ),
  );
  const created = item ? createdLabels(item) : null;

  // The configured categories, plus the item's REAL category when it sits
  // outside them (an "Other"/unmapped area), so the true value stays visible
  // and selected instead of being coerced onto a known category.
  const areaOptions = useMemo(() => {
    const list = AREAS.map((a) => ({ code: a.code, name: a.name, dot: a.dot }));
    if (draft && !list.some((a) => a.code === draft.area)) {
      const meta = areaMeta(draft.area);
      list.unshift({ code: draft.area, name: meta.name, dot: meta.dot });
    }
    return list;
  }, [draft]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const message = await onSave({
      title: savedTitle,
      description: draft.description,
      state: draft.state,
      area: draft.area,
      areaPath: draft.areaPath,
      assignee: draft.assignee,
      assigneeEmail: draft.assigneeEmail,
      targetDate: draft.targetDate,
    });
    setSaving(false);
    if (message) setError(`Azure DevOps rejected the change — ${message}`);
  }, [draft, onSave, savedTitle]);

  useEffect(() => {
    if (!dialogOpen || !activeLayer) return;

    function saveOnKeyboardShortcut(event: globalThis.KeyboardEvent) {
      if (!event.ctrlKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!event.repeat && hasChanges && !busy) void save();
    }

    window.addEventListener("keydown", saveOnKeyboardShortcut);
    return () => window.removeEventListener("keydown", saveOnKeyboardShortcut);
  }, [activeLayer, busy, dialogOpen, hasChanges, save]);

  async function refresh() {
    if (!item) return;
    if (
      hasChanges &&
      !(await confirm({
        title: `Discard unsaved changes to ${item.id}?`,
        description:
          "Refreshing will replace this draft with the latest values from Azure DevOps.",
        confirmLabel: "Discard and refresh",
        cancelLabel: "Keep editing",
        destructive: true,
      }))
    ) {
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      await Promise.all([onRefresh(), childrenQuery.refetch()]);
      toast.success(`Work item ${item.id} refreshed from Azure DevOps`);
    } catch (refreshError) {
      const message =
        refreshError instanceof Error
          ? refreshError.message
          : "Azure DevOps did not return the latest work item.";
      setError(`Couldn't refresh from Azure DevOps — ${message}`);
    } finally {
      setRefreshing(false);
    }
  }

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
    <>
    <DetailDialogSurface
      persistent={forceMount}
      open={dialogOpen}
      activeLayer={activeLayer && !saving}
      selectOpenRef={selectOpenRef}
      onClose={onClose}
      nestedDepth={nestedDepth}
    >
      {/* `overflow-hidden` + the `min-w-0` chain below is the fix for long
          unbroken titles/descriptions/area paths, which used to stretch this
          window (grid and flex children default to `min-width:auto`, so a
          single very long token forced the whole dialog wider than its
          `max-w-lg`). Every text surface in here now wraps instead. */}
        {draft && (
          <>
            <DialogHeader className="min-w-0 space-y-0">
              <div className="w95-titlebar">
                <ClipboardCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <DialogTitle className="min-w-0 flex-1 truncate text-left text-[12px] font-bold text-white">
                  {workItemType} {draft.id.replace(/^#/, "")}
                </DialogTitle>
                <button
                  type="button"
                  className="w95-titlebtn text-[10px] leading-none"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (activeLayer) onClose();
                  }}
                  disabled={saving || !activeLayer}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <DialogDescription className="sr-only">
                Edit this work item and write the changes to Azure DevOps.
              </DialogDescription>
            </DialogHeader>

            <div
              className="grid min-h-0 min-w-0 gap-2 overflow-hidden px-2 py-2.5"
              style={{
                gridTemplateColumns: "minmax(0, 3fr) minmax(22rem, 2fr)",
              }}
            >
              <div className="min-w-0 space-y-3 overflow-y-auto pr-1">
              {/* A single very long token must wrap/scroll INSIDE these fields,
                  never widen them: `w-full min-w-0` keeps them bounded by the
                  dialog, and the textarea wraps anywhere it has to. */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label className="text-[11px] font-bold text-black">
                    Title
                  </Label>
                  {adoUrl && (
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        className="w95-btn w95-btn--save h-auto py-0.5 text-[10px]"
                        onClick={() => void onCopyLink()}
                        disabled={!activeLayer}
                      >
                        <Link2 className="h-3 w-3" />
                        Copy link
                      </button>
                      <a
                        href={adoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w95-btn h-auto py-0.5 text-[10px] text-black"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open in DevOps
                      </a>
                    </div>
                  )}
                </div>
                <Input
                  className="h-11 w-full min-w-0 text-lg font-bold md:text-lg"
                  value={draft.title}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>

              <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
                <div className="min-w-0 space-y-1">
                  <Label className="block text-[11px] font-bold text-black">
                    Assigned to
                  </Label>
                  <Select
                    value={
                      normalizeIdentityEmail(draft.assigneeEmail) ??
                      (draft.assignee ? "__current_without_email__" : "__unassigned__")
                    }
                    disabled={busy || !activeLayer}
                    onOpenChange={trackSelectOpen}
                    onValueChange={(email) => {
                      if (email === "__unassigned__") {
                        setDraft({
                          ...draft,
                          assignee: null,
                          assigneeEmail: null,
                        });
                        return;
                      }
                      const option = assignmentOptions.find(
                        (candidate) => candidate.email === email,
                      );
                      if (!option) return;
                      setDraft({
                        ...draft,
                        assignee: option.name,
                        assigneeEmail: option.email,
                      });
                    }}
                  >
                    <SelectTrigger
                      className="w95-select-interactive min-w-0 max-w-full"
                      style={{
                        width: `${Math.min(
                          30,
                          Math.max(
                            14,
                            ...assignmentOptions.map((option) => option.name.length + 7),
                          ),
                        )}ch`,
                      }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[1000]">
                      {draft.assignee && !draft.assigneeEmail && (
                        <SelectItem value="__current_without_email__" disabled>
                          {draft.assignee} (address unavailable)
                        </SelectItem>
                      )}
                      <SelectItem value="__unassigned__">
                        <span className="flex items-center gap-1.5 text-[#606060]">
                          <EngineerAvatar
                            name="Unassigned"
                            className="h-4 w-4"
                          />
                          Unassigned
                        </span>
                      </SelectItem>
                      {assignmentOptions.map((option) => (
                        <SelectItem key={option.email} value={option.email}>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <EngineerAvatar
                              name={option.name}
                              photoUrl={
                                detailPhotos[
                                  normalizeIdentityEmail(option.email) ?? ""
                                ]
                              }
                            />
                            <span className="truncate">
                              {option.name}
                              {option.isSelf ? " (you)" : ""}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {assigneesLoading && (
                    <p className="text-[10px] text-[#404040]">
                      Loading the full team roster from Azure DevOps…
                    </p>
                  )}
                  {assigneesError && (
                    <p className="text-[10px] font-bold text-[#a80000]">
                      Full team roster unavailable — {assigneesError}
                    </p>
                  )}
                </div>

                <div className="min-w-0 space-y-1">
                  <Label className="block text-[11px] font-bold text-black">
                    State
                  </Label>
                  <Select
                    value={draft.state}
                    disabled={busy || !activeLayer}
                    onOpenChange={trackSelectOpen}
                    onValueChange={(v) => setDraft({ ...draft, state: v as StoryState })}
                  >
                    <SelectTrigger
                      className="w95-select-interactive"
                      style={{
                        width: `${Math.max(
                          16,
                          ...stateOptions.map((state) => state.length + 8),
                        )}ch`,
                      }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[1000]">
                      {stateOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          <StateOptionLabel state={s} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0 space-y-1">
                  <Label className="block text-[11px] font-bold text-black">
                    Category
                  </Label>
                  <Select
                    value={draft.area}
                    disabled={busy || !activeLayer}
                    onOpenChange={trackSelectOpen}
                    onValueChange={(code) =>
                      setDraft({
                        ...draft,
                        area: code,
                        areaPath: isKnownAreaCode(code)
                          ? categoryAreaPath(code, areaRoot)
                          : draft.areaPath,
                      })
                    }
                  >
                    <SelectTrigger
                      className="w95-select-interactive"
                      style={{
                        width: `${Math.max(
                          22,
                          ...areaOptions.map((option) => option.name.length + 11),
                        )}ch`,
                      }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[1000]">
                      {areaOptions.map((areaOption) => (
                        <SelectItem key={areaOption.code} value={areaOption.code}>
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className={cn(
                                "h-2.5 w-2.5 shrink-0 rounded-full",
                                areaOption.dot,
                              )}
                            />
                            <span className="truncate">{areaOption.name}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0 space-y-1">
                  <Label
                    htmlFor={targetDateId}
                    className="block text-[11px] font-bold text-black"
                  >
                    ETA for complete prod rollout
                  </Label>
                  <div className="flex items-center gap-2">
                    <Popover onOpenChange={trackSelectOpen}>
                      <PopoverTrigger asChild>
                        <button
                          id={targetDateId}
                          type="button"
                          className="w95-date-trigger flex h-9 min-w-[17rem] items-center gap-2 pl-2 text-left text-[11px]"
                          disabled={busy || !activeLayer}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {displayDateOnly(draft.targetDate)}
                          </span>
                          <span className="w95-btn pointer-events-none h-7 shrink-0 px-2 text-[10px]">
                            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                            Pick date
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="z-[1000] w-auto border-[#808080] bg-[#c0c0c0] p-1 shadow-none"
                      >
                        <Calendar
                          mode="single"
                          selected={parseDateOnly(draft.targetDate)}
                          defaultMonth={parseDateOnly(draft.targetDate)}
                          startMonth={new Date(new Date().getFullYear() - 5, 0)}
                          endMonth={new Date(new Date().getFullYear() + 10, 11)}
                          onSelect={(date) =>
                            setDraft({
                              ...draft,
                              targetDate: date ? formatDateOnly(date) : null,
                            })
                          }
                          captionLayout="dropdown"
                          className="bg-[#c0c0c0] text-black"
                        />
                        <div className="flex justify-end border-t border-[#808080] p-1">
                          <button
                            type="button"
                            className="w95-btn h-auto py-0.5 text-[10px]"
                            disabled={!draft.targetDate}
                            onClick={() => setDraft({ ...draft, targetDate: null })}
                          >
                            Clear date
                          </button>
                        </div>
                      </PopoverContent>
                    </Popover>
                    {activeLayer && item && (
                      <div className="min-w-[12rem]">
                        <EtaRequestButton
                          item={{ ...item, targetDate: draft.targetDate }}
                          requesterName={requesterName}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-1 pb-px"
                  aria-label="Tags are read-only in this details window"
                >
                  {draft.tags && draft.tags.length > 0 ? (
                    <DetailTagChips tags={draft.tags} />
                  ) : (
                    <span className="text-[10px] italic text-[#606060]">No tags</span>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label className="text-[11px] font-bold text-black">
                    Description
                  </Label>
                  <button
                    type="button"
                    className="w95-btn ml-auto h-auto py-0.5 text-[10px]"
                    onClick={() => setDescriptionEditing((editing) => !editing)}
                    disabled={busy}
                  >
                    {descriptionEditing ? "Preview rich text" : "Edit description"}
                  </button>
                </div>
                {descriptionEditing ? (
                  <Textarea
                    rows={10}
                    className="min-h-52 w-full min-w-0 resize-y break-words font-mono text-[11px] [overflow-wrap:anywhere]"
                    value={draft.description}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({ ...draft, description: event.target.value })
                    }
                  />
                ) : (
                  <div className="w95-in min-h-52 max-h-[42dvh] overflow-y-auto p-2 text-[11px] leading-snug">
                    {draft.description ? (
                      <SafeRichText
                        value={draft.description}
                        isHtml={/<[a-z][\s\S]*>/i.test(draft.description)}
                      />
                    ) : (
                      <p className="text-[#606060]">
                        This work item has no description in Azure DevOps.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {error && (
                <p className="w95-field flex min-w-0 items-start gap-1.5 break-words px-2 py-1.5 text-[11px] font-bold text-[#a80000] [overflow-wrap:anywhere]">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  {error}
                </p>
              )}
              </div>

              <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <div className="flex shrink-0 items-center justify-end gap-1.5">
                <button
                  type="button"
                  className={cn(
                    "w95-btn w95-btn--save min-w-[96px] shrink-0",
                    hasChanges && "w95-btn--primary",
                  )}
                  onClick={() => void save()}
                  disabled={busy || !activeLayer || !hasChanges}
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="w95-btn shrink-0"
                  onClick={() => void refresh()}
                  disabled={busy || !activeLayer}
                  title="Pull the latest work item and nested items from Azure DevOps"
                >
                  <RefreshCw
                    className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
                  />
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  type="button"
                  className="w95-btn shrink-0 text-[#a80000]"
                  title="Move this work item to the Azure DevOps recycle bin"
                  disabled={busy || !activeLayer}
                  onClick={() => {
                    setDeleting(true);
                    void onDelete().finally(() => setDeleting(false));
                  }}
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
              <section className="w95-panel shrink-0 p-2 text-[10px]">
                <h3 className="mb-1.5 border-b border-[#808080] pb-1 text-[11px] font-bold">
                  History
                </h3>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                  <span className="font-bold text-[#404040]">Created On</span>
                  {created && item?.createdDate ? (
                    <span className="min-w-0">
                      <time dateTime={item.createdDate}>{created.absolute}</time>
                      <span className="text-[#606060]"> · {created.relative}</span>
                    </span>
                  ) : (
                    <span className="italic text-[#606060]">
                      Not returned by Azure DevOps
                    </span>
                  )}
                  <span className="font-bold text-[#404040]">Created By</span>
                  {item?.createdBy ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <EngineerAvatar
                        name={item.createdBy}
                        photoUrl={
                          detailPhotos[
                            normalizeIdentityEmail(item.createdByEmail) ?? ""
                          ]
                        }
                      />
                      <span className="truncate">{item.createdBy}</span>
                    </span>
                  ) : (
                    <span className="italic text-[#606060]">
                      Not returned by Azure DevOps
                    </span>
                  )}
                </div>
              </section>

              <section className="w95-panel flex min-h-0 min-w-0 flex-1 flex-col p-1.5">
                <div className="flex shrink-0 items-center gap-1.5">
                  <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
                  <h3 className="min-w-0 flex-1 text-[11px] font-bold">
                    Nested work items
                  </h3>
                  <button
                    type="button"
                    className="w95-btn h-auto py-0.5 text-[10px]"
                    onClick={() => setAddTaskOpen(true)}
                    disabled={busy}
                    title="Create a new nested work item"
                  >
                    <ListPlus className="h-3 w-3" />
                    New nested item
                  </button>
                </div>

                <div className="w95-in mt-1.5 min-h-0 flex-1 overflow-y-auto p-1">
                  {childrenQuery.isPending ? (
                    <p className="flex items-center gap-1.5 px-1 py-2 text-[10px] text-[#404040]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading nested work items from Azure DevOps…
                    </p>
                  ) : childrenQuery.isError ? (
                    <ErrorState
                      title="Couldn't load nested work items"
                      description={
                        childrenQuery.error instanceof Error
                          ? childrenQuery.error.message
                          : String(childrenQuery.error)
                      }
                      action={
                        <button
                          type="button"
                          className="w95-btn"
                          onClick={() => void childrenQuery.refetch()}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Retry
                        </button>
                      }
                    />
                  ) : childItems.length === 0 ? (
                    <p className="px-1 py-2 text-[10px] text-[#606060]">
                      This work item has no nested work items in Azure DevOps.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {childTreeRows.map(
                        ({ child, depth, ancestorLast, isLast }, index) => (
                        <DetailChildRow
                          key={child.id}
                          child={child}
                          depth={depth}
                          ancestorLast={ancestorLast}
                          isLast={isLast}
                          zebra={index % 2 === 1}
                          photoUrl={
                            childPhotos[
                              normalizeIdentityEmail(child.assigneeEmail) ?? ""
                            ]
                          }
                          onOpen={() => onOpenNested(child)}
                          onPrefetch={() => detailPrefetch.prefetchNested(child)}
                          onCancelPrefetch={detailPrefetch.cancelPrefetch}
                          onContextMenu={(x, y) =>
                            onNestedContextMenu(child, x, y)
                          }
                        />
                        ),
                      )}
                    </ul>
                  )}
                  {(childrenQuery.data?.missingIds.length ?? 0) > 0 && (
                    <p className="mt-1 px-1 text-[9px] text-[#a80000]">
                      Azure DevOps did not return{" "}
                      {childrenQuery.data?.missingIds.length} linked work{" "}
                      {(childrenQuery.data?.missingIds.length ?? 0) === 1
                        ? "item"
                        : "items"}.
                    </p>
                  )}
                </div>
              </section>
              </div>
            </div>

          </>
        )}
    </DetailDialogSurface>
    {item && addTaskOpen && (
      <AddTaskDialog
        open
        parent={item}
        config={config}
        assignees={assignees}
        layerIndex={nestedDepth}
        onClose={() => setAddTaskOpen(false)}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ["ado-child-counts"] });
          void queryClient.invalidateQueries({
            queryKey: ["ado-child-work-items"],
          });
          void childrenQuery.refetch();
        }}
      />
    )}
    </>
  );
}

function DetailChildRow({
  child,
  depth,
  ancestorLast,
  isLast,
  zebra,
  photoUrl,
  onOpen,
  onPrefetch,
  onCancelPrefetch,
  onContextMenu,
}: {
  child: ChildWorkItem;
  depth: number;
  ancestorLast: boolean[];
  isLast: boolean;
  zebra: boolean;
  photoUrl?: string;
  onOpen: () => void;
  onPrefetch: () => void;
  onCancelPrefetch: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const state = stateMeta(child.state);
  const menuTarget = useIsMenuTarget(child.id);
  const typeChip = (() => {
    switch (child.workItemType?.trim().toLowerCase()) {
      case "task":
        return "bg-[#fff2a8] text-[#5c4600]";
      case "user story":
        return "bg-[#bfe3ff] text-[#003b66]";
      case "epic":
        return "bg-[#ffc58f] text-[#6b2c00]";
      case "feature":
        return "bg-[#d9c2ff] text-[#431273]";
      case "bug":
        return "bg-[#ffc4c4] text-[#7a1212]";
      default:
        return "bg-[#dfdfdf] text-[#000080]";
    }
  })();
  return (
    <li className="relative flex min-w-0">
      {depth > 0 && (
        <span
          className="relative shrink-0"
          style={{ width: `${depth * 16}px` }}
          aria-hidden="true"
        >
          {ancestorLast.slice(0, -1).map((last, index) =>
            last ? null : (
              <span
                key={index}
                className="absolute inset-y-0 border-l border-dotted border-[#606060]"
                style={{ left: `${index * 16 + 7}px` }}
              />
            ),
          )}
          <span
            className="absolute top-0 border-l border-dotted border-[#606060]"
            style={{
              left: `${(depth - 1) * 16 + 7}px`,
              height: isLast ? "50%" : "100%",
            }}
          />
          <span
            className="absolute top-1/2 w-2 border-t border-dotted border-[#606060]"
            style={{ left: `${(depth - 1) * 16 + 7}px` }}
          />
        </span>
      )}
      <div
        onClick={onOpen}
        onPointerEnter={onPrefetch}
        onPointerLeave={onCancelPrefetch}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(event.clientX, event.clientY);
        }}
        title="Click to open · right-click for actions"
        className={cn(
          "w95-interactive relative min-w-0 flex-1 cursor-pointer px-2 py-1.5 ring-1 ring-black/10",
          zebra ? "bg-[#e4e1dc]" : "bg-[#cfccc7]",
          menuTarget && "w95-menutarget",
        )}
      >
        <div className="flex min-w-0 items-start gap-1.5">
        <span
          className={cn(
            "shrink-0 px-1 py-px text-[9px] font-medium ring-1 ring-black/20",
            typeChip,
          )}
        >
          {child.workItemType ?? "Work item"}
        </span>
        <p className="min-w-0 flex-1 break-words text-[11px] font-bold leading-tight">
          {child.title}
        </p>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="font-mono text-[9px] text-[#404040]">{child.id}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 px-1 py-px text-[9px] font-medium ring-1 ring-black/20",
            state.badge,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", state.dot)} />
          {child.state || "Unknown state"}
        </span>
        <span className="ml-auto flex min-w-0 items-center gap-1 text-[9px]">
          <EngineerAvatar
            name={child.assignee ?? "Unassigned"}
            photoUrl={photoUrl}
          />
          <span
            className={cn(
              "max-w-36 truncate",
              !child.assignee && "text-[#606060]",
            )}
          >
            {child.assignee ?? "Unassigned"}
          </span>
        </span>
        </div>
      </div>
    </li>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-bold text-black">{label}</Label>
      {children}
    </div>
  );
}
