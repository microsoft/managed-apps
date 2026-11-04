// Triage tab: (1) work items whose area path isn't one of the configured
// ownership categories, with a per-item reroute that WRITES the new area path
// back to Azure DevOps, and (2) work items created in the last 14 days.
//
// Everything rendered here comes from the live query result — no fabricated
// creators, dates, or areas. A reroute failure surfaces the connector's real
// error message. There is no refresh BUTTON here — the tab works off the single
// Refresh control on the My Work and Board tabs — but a successful write still
// triggers the board's refresh so the item leaves this list with real data.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FilePlus2,
  Inbox,
  Loader2,
  MoveRight,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeUrl } from "@/lib/safe-url";
import { useMenuTargetId } from "@/hooks/use-menu-target";
import { adoWriteIdentity, useCurrentUser } from "@/lib/current-user";
import { usePersonPhotos } from "@/lib/people-photos";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AREAS,
  areaMeta,
  avatarColor,
  formatCreatedTimestamp as formatCreated,
  initials,
  isAncientWorkItem,
  relativeAge,
  sortByStackRank,
  stateMeta,
  type WorkItem,
} from "@/lib/work-items-data";
import { CobwebIndicator } from "@/components/cobweb-indicator";
import { PersonAvatar } from "@/components/person-avatar";
import { TagChips } from "@/components/tag-chips";
import { tagVisualFrameClasses } from "@/lib/tag-visuals";
import { useTagConfig } from "@/lib/tag-config";
import {
  ADO_WORK_ITEM_TYPE,
  categoryAreaPath,
  createWorkItem,
  isKnownAreaCode,
  updateWorkItemArea,
  workItemUrl,
  type AdoConfig,
} from "@/lib/ado";

export const RECENT_WINDOW_DAYS = 14;

/* formatCreated / relativeAge moved to lib/work-items-data.ts when My Work
   gained created dates too — one implementation, so both views agree. The
   local name is kept via the alias in the import above, so every call site
   here is unchanged. */

/**
 * Creator chip: the person's REAL Office 365 profile photo when one resolved
 * for the identity Azure DevOps returned on [System.CreatedBy], otherwise
 * coloured initials. A photo that fails to decode falls back to initials too —
 * no picture is ever fabricated for someone.
 */
function PersonChip({ name, photoUrl }: { name: string; photoUrl?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  const showPhoto = Boolean(photoUrl) && !failed;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[9px] font-semibold text-white",
          showPhoto ? "bg-[#c0c0c0]" : avatarColor(name),
        )}
      >
        {showPhoto ? (
          <img
            src={photoUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          initials(name)
        )}
      </span>
      <span className="font-bold text-black">{name}</span>
    </span>
  );
}

/**
 * One category option: the NAME always, plus the description of what belongs in
 * the category.
 *
 * The description carries `.w95-cat-desc`, which win95.css uses to make the
 * picker behave the way a 95 combo box should:
 *   • inside the closed TRIGGER (Radix clones the selected item's content into
 *     it) the description is `display:none`, so the collapsed control shows the
 *     category name only,
 *   • inside the open dropdown it shows in grey — and flips to white on the
 *     dark-blue highlighted/hover row, so it never goes unreadable there.
 */
function CategoryOptionLabel({
  name,
  dot,
  description,
}: {
  name: string;
  dot: string;
  description?: string;
}) {
  return (
    <span className="flex min-w-0 items-start gap-2">
      <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", dot)} />
      <span className="min-w-0">
        <span className="block font-bold leading-tight">{name}</span>
        {description && (
          <span className="w95-cat-desc block max-w-[17rem] text-[10px] leading-tight">
            {description}
          </span>
        )}
      </span>
    </span>
  );
}

function MetaBadges({
  item,
  tagRight = false,
}: {
  item: WorkItem;
  // Snaps the category tag to the RIGHT edge of the row, matching the board
  // cards (state + id stay left).
  tagRight?: boolean;
}) {
  const state = stateMeta(item.state);
  const area = areaMeta(item.area);
  if (tagRight) {
    return (
      <div className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-1 leading-none">
        <span
          className={cn(
            "inline-flex items-center gap-1 px-1 py-px text-[10px] font-medium ring-1 ring-black/20",
            state.badge,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", state.dot)} />
          {item.state}
        </span>
        <span className="font-mono text-[10px] text-[#404040]">{item.id}</span>
        <span
          className={cn(
            "ml-auto shrink-0 px-1 py-px text-[10px] font-medium ring-1 ring-black/20",
            area.tag,
          )}
        >
          {area.name}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 leading-none">
      <span
        className={cn(
          "inline-flex items-center gap-1 px-1 py-px text-[10px] font-medium ring-1 ring-black/20",
          state.badge,
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", state.dot)} />
        {item.state}
      </span>
      <span className={cn("px-1 py-px text-[10px] font-medium ring-1 ring-black/20", area.tag)}>
        {area.name}
      </span>
      <span className="font-mono text-[10px] text-[#404040]">{item.id}</span>
    </div>
  );
}

/**
 * Create a brand new work item directly in Azure DevOps under one of the
 * configured category area paths. The write is REAL (the connector's create);
 * on failure the connector's own message is shown and nothing is added to the
 * board, and on success the board refetches so the new work item appears with
 * live data rather than an optimistic stub.
 */
function CreateWorkItemForm({
  config,
  creatorIdentity,
  onCreated,
}: {
  config: AdoConfig;
  creatorIdentity: string | null;
  onCreated: () => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(AREAS[0]?.code ?? "");
  /** Optional configured tag to apply to the new item. */
  const [followUpTag, setFollowUpTag] = useState("");
  /** Tick -> the new item is assigned to the person creating it. */
  const [assignToMe, setAssignToMe] = useState(false);
  const { tags: configuredTags } = useTagConfig();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The work item WAS created but its tag was not applied. Kept apart from
   * `error` because the two mean opposite things about whether anything exists
   * in Azure DevOps, and saying "rejected the new work item" about an item that
   * is sitting in the backlog would be a lie.
   */
  const [partial, setPartial] = useState<string | null>(null);

  const targetPath = category ? categoryAreaPath(category, config.areaRoot) : "";
  const selectedArea = AREAS.find((a) => a.code === category);
  const canSubmit =
    title.trim().length > 0 &&
    Boolean(category) &&
    (!assignToMe || Boolean(creatorIdentity)) &&
    !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setPartial(null);
    try {
      const created = await createWorkItem(config, {
        title,
        description,
        categoryCode: category,
        // Only ever a configured tag's exact value, never a re-typed literal.
        tags: followUpTag ? [followUpTag] : undefined,
        // Fail closed in the form when the ADO-compatible identity is unavailable.
        assigneeIdentity: assignToMe ? creatorIdentity ?? undefined : undefined,
      });

      const named = created.id ? `Work item ${created.id}` : "The work item";
      if (created.followUpError) {
        // CREATED BUT NOT CONFIGURED. Reported as exactly that, with the id, so
        // the item can be found and fixed — never as a blanket success, and
        // never silently dropped just because the create itself worked.
        const message =
          `${named} was created in Azure DevOps, but its tag or assignment ` +
          `could not be confirmed — ${created.followUpError} The work item exists ` +
          `and can be checked from its properties.`;
        setPartial(message);
        toast.error(`${named} created; tag or assignment needs review`, {
          description: created.followUpError,
        });
      } else {
        toast.success(created.id ? `${named} created` : "Work item created in Azure DevOps", {
          // Only claims the tag/assignment when Azure DevOps confirmed it.
          description: [
            created.areaPath,
            followUpTag && created.tagged ? `tagged ${followUpTag}` : null,
            assignToMe && created.assignedToCreator ? "assigned to you" : null,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }

      setTitle("");
      setDescription("");
      setFollowUpTag("");
      setAssignToMe(false);
      // Refetch so the new work item shows up with the values ADO actually
      // stored — nothing is faked into the board locally. The tag write above
      // has already completed, so this refresh is what puts the tag's marker on
      // the new row.
      await onCreated();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Azure DevOps rejected the new work item.";
      setError(message);
      toast.error("Couldn't create the work item", { description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 border-b-2 border-[#808080] pb-1.5">
        <span className="flex h-6 w-6 items-center justify-center bg-[#000080] text-white">
          <FilePlus2 className="h-3.5 w-3.5" />
        </span>
        <div className="mr-auto">
          <h2 className="text-[12px] font-bold">New work item</h2>
          <p className="text-[11px] text-[#404040]">
            Creates a real {ADO_WORK_ITEM_TYPE} in Azure DevOps under the chosen
            category's area path
          </p>
        </div>
      </div>

      <div className="w95-in space-y-2.5 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="w-[70px] shrink-0 text-[11px] font-bold"
            htmlFor="new-wi-category"
          >
            Category
          </label>
          <Select
            value={category}
            disabled={saving}
            onValueChange={(code) => setCategory(code)}
          >
            <SelectTrigger className="w-[210px]" size="sm" id="new-wi-category">
              <SelectValue placeholder="Pick a category…" />
            </SelectTrigger>
            <SelectContent>
              {AREAS.map((a) => (
                <SelectItem key={a.code} value={a.code}>
                  <CategoryOptionLabel
                    name={a.name}
                    dot={a.dot}
                    description={a.description}
                  />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {targetPath && (
            <span className="truncate font-mono text-[10px] text-[#404040]">
              → {targetPath}
            </span>
          )}
        </div>

        {/* What the picked category covers — same descriptions used inside the
            dropdown, echoed here for the current selection. */}
        {selectedArea?.description && (
          <p className="pl-[78px] text-[11px] leading-tight text-[#404040]">
            <span className="font-bold text-black">{selectedArea.name}</span> —{" "}
            {selectedArea.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className="w-[70px] shrink-0 text-[11px] font-bold" htmlFor="new-wi-title">
            Title
          </label>
          <input
            id="new-wi-title"
            type="text"
            value={title}
            disabled={saving}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Work item title"
            className="min-w-[16rem] flex-1"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <label
            className="w-[70px] shrink-0 pt-1 text-[11px] font-bold"
            htmlFor="new-wi-description"
          >
            Description
          </label>
          <textarea
            id="new-wi-description"
            value={description}
            disabled={saving}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Optional description"
            className="min-w-[16rem] flex-1 resize-y"
          />
        </div>

        {configuredTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="new-wi-tag" className="w-[70px] shrink-0 text-[11px] font-bold">
              Tag
            </label>
            <select
              id="new-wi-tag"
              className="w95-field h-[22px] min-w-[12rem] text-[11px]"
              value={followUpTag}
              disabled={saving}
              onChange={(e) => setFollowUpTag(e.target.value)}
            >
              <option value="">No tag</option>
              {configuredTags.map((tag) => (
                <option key={tag.key} value={tag.tag}>
                  {tag.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* A real <input type="checkbox"> (visually hidden, so it keeps its
            semantics and keyboard behaviour) with a 95 sunken tick box. */}
        <div className="flex flex-wrap gap-2">
          <span className="w-[70px] shrink-0 pt-px text-[11px] font-bold">
            Owner
          </span>
          <label
            htmlFor="new-wi-assign"
            className="flex min-w-[16rem] flex-1 items-start gap-2 text-[11px] leading-tight"
          >
            <input
              id="new-wi-assign"
              type="checkbox"
              className="peer sr-only"
              checked={assignToMe}
              disabled={saving}
              onChange={(e) => setAssignToMe(e.target.checked)}
            />
            <span
              aria-hidden="true"
              className={cn(
                "w95-field mt-px flex h-[13px] w-[13px] shrink-0 items-center justify-center",
                "text-[10px] font-bold leading-none text-black",
                "peer-focus-visible:outline-1 peer-focus-visible:outline-dotted peer-focus-visible:outline-black",
                saving && "opacity-50",
              )}
            >
              {assignToMe ? "✓" : ""}
            </span>
            <span className="min-w-0">Assign the new work item to me</span>
          </label>
        </div>

        {assignToMe && !creatorIdentity && (
          <p className="pl-[78px] font-mono text-[10px] font-bold text-[#a80000]">
            Your signed-in identity is required to assign the item to you.
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
                <FilePlus2 className="h-3.5 w-3.5" />
                Create work item
              </>
            )}
          </button>
          <span className="text-[11px] text-[#404040]">
            Type: {ADO_WORK_ITEM_TYPE}
          </span>
        </div>

        {error && (
          <p className="w95-field px-2 py-1 text-[11px] font-bold text-[#a80000]">
            Azure DevOps rejected the new work item — {error}
          </p>
        )}

        {/* Created, but not tagged — a different outcome from a rejected
            create, and worded as such: the item is really there. */}
        {partial && (
          <p className="w95-field px-2 py-1 text-[11px] font-bold text-[#a80000] [overflow-wrap:anywhere]">
            {partial}
          </p>
        )}
      </div>
    </section>
  );
}

export function TriagePanel({
  items,
  config,
  onWritten,
  onOpenItem,
  onPrefetchItem,
  onCancelPrefetch,
  onCardContextMenu,
}: {
  items: WorkItem[];
  config: AdoConfig;
  // Board refresh, invoked ONLY after a successful write (not a button).
  onWritten: () => Promise<unknown>;
  // Opens the board's work item detail dialog (same edit + ADO write-back with
  // rollback) for a recently created work item.
  onOpenItem?: (item: WorkItem) => void;
  onPrefetchItem?: (item: WorkItem) => void;
  onCancelPrefetch?: () => void;
  // Right-click on a triage row -> the board's context menu.
  //
  // `source` says WHICH list the row came from, because the two are no longer
  // offered the same menu: "recent" rows also get the configured tag
  // toggles, while
  // "uncategorized" rows stay link-only — their reroute picker below is how
  // those are changed. Neither list offers Change state or Unassign; the caller
  // owns that decision, and this only tells it where the click came from.
  onCardContextMenu?: (
    item: WorkItem,
    x: number,
    y: number,
    source: "uncategorized" | "recent",
  ) => void;
}) {
  // Board id -> in-flight target category, and board id -> last error.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // WHICH row's right-click menu is open, read once here because both lists
  // below build their rows inline in a map (where a hook can't be called).
  // Triage rows get the link-only menu, but they still mark themselves.
  const menuTargetId = useMenuTargetId();

  const creatorIdentity = adoWriteIdentity(useCurrentUser(true));
  const { tags: configuredTags } = useTagConfig();

  // Anything that didn't route to one of the configured categories, in backlog
  // (StackRank) order like every other work-item list on the board. The
  // "recently created" list below intentionally stays newest-created first.
  const uncategorized = useMemo(
    () => sortByStackRank(items.filter((it) => !isKnownAreaCode(it.area))),
    [items],
  );

  // Created in the last N days, most recent first. Items with no created date
  // from ADO are omitted rather than guessed at.
  const recent = useMemo(() => {
    const cutoff = Date.now() - RECENT_WINDOW_DAYS * 86_400_000;
    return items
      .filter((it) => {
        if (!it.createdDate) return false;
        const t = Date.parse(it.createdDate);
        return Number.isFinite(t) && t >= cutoff;
      })
      .sort(
        (a, b) =>
          Date.parse(b.createdDate as string) - Date.parse(a.createdDate as string),
      );
  }, [items]);

  // Background, cached, deduped profile-photo lookups for the people shown in
  // the feed — both the creator and the item's current assignee — using exactly
  // the same resolution path the board's engineer avatars use (real photo,
  // initials fallback, never fabricated). The hook dedupes, so an identity that
  // is both creator and assignee costs a single lookup.
  const feedPhotos = usePersonPhotos(
    useMemo(
      () =>
        recent
          .flatMap((it) => [it.createdByEmail, it.assigneeEmail])
          .filter((e): e is string => Boolean(e)),
      [recent],
    ),
  );

  const missingCreatedDates = useMemo(
    () => items.filter((it) => !it.createdDate).length,
    [items],
  );

  async function reroute(item: WorkItem, targetCode: string) {
    setPending((p) => ({ ...p, [item.id]: targetCode }));
    setErrors((e) => {
      const next = { ...e };
      delete next[item.id];
      return next;
    });
    try {
      const newPath = await updateWorkItemArea(config, item.id, targetCode);
      toast.success(`Work item ${item.id} moved`, { description: newPath });
      // Refetch so the rerouted work item leaves the triage list with real data.
      await onWritten();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Azure DevOps rejected the update.";
      setErrors((e) => ({ ...e, [item.id]: message }));
      toast.error(`Couldn't move work item ${item.id}`, { description: message });
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[item.id];
        return next;
      });
    }
  }

  return (
    // Two columns: the LEFT column holds the "new work item" form and the
    // uncategorized queue (the two triage actions), the RIGHT column holds the
    // read-only "Recently created" feed. Stacks to one column below `xl` so it
    // stays usable on narrow viewports.
    // At `xl` the grid is exactly as tall as its bounded parent (`h-full` +
    // `min-h-0`) and neither column grows the page: the LEFT column is pinned
    // (no scroll of its own — its long uncategorized queue gets a bounded well
    // instead, so nothing becomes unreachable) and ONLY the RIGHT column has a
    // scroll viewport. Below `xl` the columns stack and the parent scrolls the
    // whole panel, so short/narrow viewports stay usable.
    <div className="grid grid-cols-1 items-start gap-6 xl:h-full xl:min-h-0 xl:grid-cols-2 xl:items-stretch">
      <div className="min-w-0 space-y-8 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden">
        {/* 0 — Create a new work item directly in Azure DevOps */}
        <CreateWorkItemForm
          config={config}
          creatorIdentity={creatorIdentity}
          onCreated={onWritten}
        />

        {/* 1 — Uncategorized work items. In the pinned left column this is the
            flexible part: the queue well below takes the leftover height and
            keeps its own bounded scroll, so the column as a whole stays put. */}
        <section className="xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
        <div className="mb-2 flex items-center gap-2 border-b-2 border-[#808080] pb-1.5">
          <span className="flex h-6 w-6 items-center justify-center bg-[#000080] text-white">
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
          <div className="mr-auto">
            <h2 className="text-[12px] font-bold">Uncategorized work items</h2>
            <p className="text-[11px] text-[#404040]">
              Not under one of the configured categories — pick a category to
              update the area path in Azure DevOps
            </p>
          </div>
          <span className="w95-status text-[11px] font-bold">
            {uncategorized.length}{" "}
            {uncategorized.length === 1 ? "work item" : "work items"}
          </span>
        </div>

        {uncategorized.length === 0 ? (
          <div className="w95-in flex flex-col items-center justify-center gap-2 py-10 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-700" />
            <p className="text-[12px] font-bold">Everything is categorized</p>
            <p className="text-[11px] text-[#404040]">
              Every work item in the query sits under one of the configured categories.
            </p>
          </div>
        ) : (
          <div className="w95-in divide-y divide-[#808080]/40 overflow-hidden xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            {uncategorized.map((item, i) => {
              const target = pending[item.id];
              const error = errors[item.id];
              return (
                <div
                  key={item.id}
                  // Right-click offers the link-only menu, exactly like a board
                  // card; the reroute picker below is still how this row's work
                  // item is actually changed. Deliberately NOT given the
                  // tag toggles the "Recently created" list has — that was the
                  // ask, and rerouting is this list's job.
                  onContextMenu={
                    onCardContextMenu
                      ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onCardContextMenu(item, e.clientX, e.clientY, "uncategorized");
                        }
                      : undefined
                  }
                  className={cn(
                    // `relative` is the positioning context for the corner
                    // cobweb below.
                    "relative px-4 py-3",
                    i % 2 === 1 ? "bg-[#e4e1dc]" : "bg-[#c0c0c0]",
                    // This row's right-click menu is open -> 95 selection ring.
                    menuTargetId === item.id && "w95-menutarget",
                  )}
                >
                  {isAncientWorkItem(item) && <CobwebIndicator seed={item.id} />}
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-start gap-1.5 text-[11px] font-bold leading-tight">
                        <TagChips item={item} className="mt-px" />
                        <span className="min-w-0">{item.title}</span>
                      </p>
                      <div className="mt-1">
                        <MetaBadges item={item} />
                      </div>
                      <p className="mt-1 truncate font-mono text-[10px] text-[#404040]">
                        {item.areaPath || "no area path returned"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <MoveRight className="h-4 w-4 text-[#404040]" />
                      <Select
                        value=""
                        disabled={Boolean(target)}
                        onValueChange={(code) => void reroute(item, code)}
                      >
                        <SelectTrigger className="w-[190px]" size="sm">
                          <SelectValue placeholder="Move to category…" />
                        </SelectTrigger>
                        <SelectContent>
                          {AREAS.map((a) => (
                            <SelectItem key={a.code} value={a.code}>
                              <CategoryOptionLabel
                                name={a.name}
                                dot={a.dot}
                                description={a.description}
                              />
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {target && (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#000080]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Writing to Azure DevOps…
                        </span>
                      )}
                    </div>
                  </div>
                  {target && (
                    <p className="mt-1.5 font-mono text-[10px] text-[#404040]">
                      → {categoryAreaPath(target, config.areaRoot)}
                    </p>
                  )}
                  {error && (
                    <p className="w95-field mt-1.5 px-2 py-1 text-[11px] font-bold text-[#a80000]">
                      Azure DevOps rejected the move — {error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </section>
      </div>

      {/* 2 — Recently created work items (right column). This is the ONLY
          scrolling column at `xl`: the heading stays fixed and the feed below
          it owns the scroll viewport. */}
      <section className="min-w-0 xl:flex xl:min-h-0 xl:flex-col">
        <div className="mb-2 flex items-center gap-2 border-b-2 border-[#808080] pb-1.5">
          <span className="flex h-6 w-6 items-center justify-center bg-[#000080] text-white">
            <Clock3 className="h-3.5 w-3.5" />
          </span>
          <div className="mr-auto">
            <h2 className="text-[12px] font-bold">Recently created</h2>
            <p className="text-[11px] text-[#404040]">
              Work items created in the past {RECENT_WINDOW_DAYS} days, newest
              first
            </p>
          </div>
          <span className="w95-status text-[11px] font-bold">
            {recent.length} {recent.length === 1 ? "work item" : "work items"}
          </span>
        </div>

        {/* The one scroll viewport on this page at `xl`: bounded by the column
            (`min-h-0` + `flex-1`), so the feed scrolls while the left column
            and both headings stay exactly where they are. */}
        <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
        {recent.length === 0 ? (
          <div className="w95-in flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Inbox className="h-6 w-6 text-[#404040]" />
            <p className="text-[12px] font-bold">
              No work items created in the past {RECENT_WINDOW_DAYS} days
            </p>
            <p className="text-[11px] text-[#404040]">
              {missingCreatedDates > 0
                ? `${missingCreatedDates} work item(s) came back without a created date from Azure DevOps.`
                : "Nothing new landed in this area tree recently."}
            </p>
          </div>
        ) : (
          // The half-width right column already keeps the created-by/date
          // column close to the title, so no extra max-width cap is needed.
          //
          // Rows now carry the Board card's own raised bevel, so the hairline
          // `divide-y` that used to separate flat rows is gone (two adjacent
          // bevels already read as separate cards) and a 1px gutter + padding
          // gives each one room to sit in, exactly like a board list.
          <div className="w95-in space-y-1 overflow-hidden p-1">
            {recent.map((item, i) => {
              const area = areaMeta(item.area);
              const href = safeUrl(workItemUrl(config, item.id));
              const open = onOpenItem ? () => onOpenItem(item) : undefined;
              const photoUrl = item.createdByEmail
                ? feedPhotos[item.createdByEmail.trim().toLowerCase()]
                : undefined;
              // The item's REAL current owner, straight off [System.AssignedTo]
              // as already resolved on the work item — no extra fetch, and no
              // invented name when ADO returned nobody.
              const assigneeName = item.assignee?.trim();
              const assigneePhotoUrl = item.assigneeEmail
                ? feedPhotos[item.assigneeEmail.trim().toLowerCase()]
                : undefined;
              return (
                <div
                  key={item.id}
                  role={open ? "button" : undefined}
                  tabIndex={open ? 0 : undefined}
                  onClick={open}
                  onPointerEnter={() => onPrefetchItem?.(item)}
                  onPointerLeave={onCancelPrefetch}
                  onKeyDown={(e) => {
                    if (!open) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open();
                    }
                  }}
                  // These rows are real board work items, so their menu also
                  // carries the configured tag toggles (see `source`).
                  onContextMenu={
                    onCardContextMenu
                      ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onCardContextMenu(item, e.clientX, e.clientY, "recent");
                        }
                      : undefined
                  }
                  title={
                    open
                      ? onCardContextMenu
                        ? "Click to open the work item properties · right-click to copy the link or toggle a tag"
                        : "Click to open the work item properties"
                      : onCardContextMenu
                        ? "Right-click to copy the link or toggle a tag"
                        : undefined
                  }
                  className={cn(
                    // Same component family as a Board StoryCard: the `w95-item`
                    // base, the category-coloured 4px left accent, the zebra
                    // band and the identical raised 95 bevel (outer black /
                    // white highlight, inner grey / light-grey) — only the
                    // padding stays roomier, since these rows carry a second
                    // created-by column.
                    // `relative` is the positioning context for the corner
                    // cobweb below.
                    "w95-item relative flex flex-wrap items-start gap-3 border-l-4 px-3 py-2 text-left",
                    tagVisualFrameClasses(item, configuredTags),
                    i % 2 === 1 ? "bg-[#e4e1dc]" : "bg-[#c0c0c0]",
                    "shadow-[inset_-1px_-1px_0_0_#0a0a0a,inset_1px_1px_0_0_#ffffff,inset_-2px_-2px_0_0_#808080,inset_2px_2px_0_0_#dfdfdf]",
                    area.border,
                    open && "cursor-default focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-black",
                    // This row's right-click menu is open -> 95 selection ring.
                    menuTargetId === item.id && "w95-menutarget",
                  )}
                >
                  {/* Rendered for consistency with every other card view,
                      though this list is "recently created" and so will
                      almost never contain an item old enough to earn one.
                      This is the ONE list whose top-right corner is occupied:
                      the created-on stamp is a right-aligned column starting
                      at the top of the row, its right edge on the row's 12px
                      padding. The 14px web's BOX overlaps that column by 3px
                      and only stays off the text because the web's bottom-left
                      is unplotted — see the warning in cobweb-indicator.tsx
                      before re-plotting it, or adding a variant. EVERY variant
                      has to hold that clearance, not just the first one. */}
                  {isAncientWorkItem(item) && <CobwebIndicator seed={item.id} />}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-start gap-1.5 text-[11px] font-bold leading-tight">
                      <TagChips item={item} className="mt-px" />
                      <span className="min-w-0">{item.title}</span>
                    </p>
                    {/* Same meta row as a board card: state + id left, the
                        category tag snapped to the right edge. */}
                    <div className="mt-1">
                      <MetaBadges item={item} tagRight />
                    </div>
                  </div>
                  <div className="shrink-0 space-y-1 text-right text-[11px] text-[#404040]">
                    <div className="flex items-center justify-end gap-1.5">
                      <Clock3 className="h-3.5 w-3.5" />
                      <span className="font-bold text-black">
                        {relativeAge(item.createdDate as string)}
                      </span>
                      <span className="text-[#404040]">
                        · {formatCreated(item.createdDate as string)}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                      <UserPlus className="h-3.5 w-3.5" />
                      <span className="text-[#404040]">Created by</span>
                      {item.createdBy ? (
                        <PersonChip name={item.createdBy} photoUrl={photoUrl} />
                      ) : (
                        <span className="italic text-[#404040]">
                          creator not returned by Azure DevOps
                        </span>
                      )}
                    </div>
                    {/* Current owner, same type scale and rhythm as the
                        created-by line. Unassigned items say so plainly. */}
                    <div className="flex items-center justify-end gap-1.5">
                      <UserCheck className="h-3.5 w-3.5" />
                      <span className="text-[#404040]">Currently assigned to:</span>
                      {assigneeName ? (
                        <PersonChip
                          name={assigneeName}
                          photoUrl={assigneePhotoUrl}
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-bold text-[#606060]">
                          <PersonAvatar name="Unassigned" />
                          Unassigned
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Opens the real work item in Azure DevOps. The row itself is
                      click-to-open, so this anchor swallows the click. */}
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      draggable={false}
                      onClick={(e) => e.stopPropagation()}
                      title={`Open ${item.id} in Azure DevOps`}
                      aria-label={`Open work item ${item.id} in Azure DevOps`}
                      className="w95-btn w95-iconbtn mt-px text-black"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </section>

    </div>
  );
}

export default TriagePanel;
