// TAGS tab — the home for the app's tag system.
//
// Two sections, in this order:
//
//   1. TAG CONFIGURATION — every tag the app knows about. Configured tags can
//      be added, edited and removed; they are app-owned data on the storage
//      interface (see lib/tag-config.ts).
//   2. WORK ITEMS BY TAG — the board's already-loaded work items, grouped
//      under each tag, with a count per tag.
//
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CloudOff,
  Database,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Tags,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/hooks/use-confirm";
import { EmptyState } from "@/components/states";
import {
  TagChips,
  TagVisual,
} from "@/components/tag-chips";
import { useTagVisualFrameClasses } from "@/lib/tag-visuals";
import {
  areaMeta,
  compareByStackRank,
  hasExactTag,
  stateMeta,
  type WorkItem,
} from "@/lib/work-items-data";
import { errorText } from "@/lib/errors";
import {
  MARKER_STYLES,
  MAX_LABEL_LENGTH,
  MAX_TAG_DESCRIPTION_LENGTH,
  MAX_TAG_LENGTH,
  TAG_CONFIG_QUERY_KEY,
  createTagConfig,
  deleteTagConfig,
  isMarkerStyleId,
  markerStyle,
  updateTagConfig,
  useTagConfig,
  validateNewTag,
  type MarkerStyleId,
  type ResolvedTag,
  type TagConfigItem,
  type TagConfigs,
} from "@/lib/tag-config";

/** Work items carrying ONE exact tag, in backlog order. Same rule everywhere
 *  else in the app: whole tag, case-insensitive, trimmed. */
function itemsWithTag(items: WorkItem[], tag: string): WorkItem[] {
  return items.filter((it) => hasExactTag(it, tag)).sort(compareByStackRank);
}

export function TagsPanel({
  items,
  onOpenItem,
  onPrefetchItem,
  onCancelPrefetch,
  onCardContextMenu,
}: {
  /** The board's ALREADY-LOADED work items — no second Azure DevOps query. */
  items: WorkItem[];
  onOpenItem: (item: WorkItem) => void;
  onPrefetchItem: (item: WorkItem) => void;
  onCancelPrefetch: () => void;
  onCardContextMenu: (item: WorkItem, x: number, y: number) => void;
}) {
  const { tags, configured, status, error, refetch, collection } = useTagConfig();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="w95-panel flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 text-[11px]">
        <span className="flex items-center gap-1 font-bold">
          <Tags className="h-3.5 w-3.5" /> Tags
        </span>
        <span className="text-[#404040]">
          Every tag the app knows about, and every work item carrying one.
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-2">
          <TagConfigSection
            tags={tags}
            configured={configured}
            status={status}
            error={error}
            onRefresh={refetch}
            collection={collection}
          />
          <ItemsByTagSection
            tags={tags}
            items={items}
            status={status}
            onOpenItem={onOpenItem}
            onPrefetchItem={onPrefetchItem}
            onCancelPrefetch={onCancelPrefetch}
            onCardContextMenu={onCardContextMenu}
          />
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* 1. TAG CONFIGURATION                                                        */
/* ========================================================================== */

function TagConfigSection({
  tags,
  configured,
  status,
  error,
  onRefresh,
  collection,
}: {
  tags: ResolvedTag[];
  configured: TagConfigItem[];
  status: ReturnType<typeof useTagConfig>["status"];
  error: string | null;
  onRefresh: () => void;
  collection: TagConfigs;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  /** A failed write. Never swallowed: the panel says what did not save. */
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Only a reachable store accepts writes. Everything that changes stored
  // config is locked otherwise — and says why, rather than failing on click.
  const canWrite = status === "ready";

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: TAG_CONFIG_QUERY_KEY });

  const configuredCount = tags.length;

  async function addTag(input: {
    tag: string;
    label: string;
    description: string;
    marker: MarkerStyleId;
  }): Promise<string | null> {
    setBusy(true);
    setWriteError(null);
    try {
      await createTagConfig(collection, input);
      invalidate();
      setAdding(false);
      return null;
    } catch (err) {
      // NOT reported as saved, and the form stays open with its values.
      const message = `That tag was not saved: ${errorText(err)}`;
      setWriteError(message);
      return message;
    } finally {
      setBusy(false);
    }
  }

  async function saveTag(
    current: TagConfigItem,
    patch: { label: string; description: string; marker: MarkerStyleId },
  ): Promise<string | null> {
    setBusy(true);
    setWriteError(null);
    try {
      await updateTagConfig(collection, current.id, patch);
      invalidate();
      setEditingId(null);
      return null;
    } catch (err) {
      const message = `That edit was not saved: ${errorText(err)}`;
      setWriteError(message);
      return message;
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(current: TagConfigItem) {
    const ok = await confirm({
      title: `Remove “${current.tag}” from the configuration?`,
      description:
        "It will stop appearing on the right-click menu and stop drawing its " +
        "marker on cards. Work items already carrying the tag in Azure DevOps " +
        "KEEP it — this removes the configuration only and writes nothing to " +
        "Azure DevOps.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setWriteError(null);
    try {
      await deleteTagConfig(collection, current.id);
      invalidate();
    } catch (err) {
      setWriteError(`That tag was not removed: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w95-panel flex flex-col gap-2 p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1 font-bold">
          <Tags className="h-3.5 w-3.5" /> Tag configuration
        </span>
        {status === "loading" && (
          <span className="w95-status flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading configured tags…
          </span>
        )}
        {status === "ready" && (
          <span className="ml-auto flex items-center gap-1.5 w95-status">
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Database className="h-3 w-3" />
            )}
            {busy
              ? "Saving…"
              : "Saved with this app's data — not to Azure DevOps."}
          </span>
        )}
        {status === "error" && (
          <>
            <span className="w95-status flex items-center gap-1">
              <CloudOff className="h-3 w-3" />
              Couldn't read the configured tags
            </span>
            <button type="button" className="ml-auto w95-btn" onClick={onRefresh}>
              <RefreshCw className="h-3 w-3" />
              Try again
            </button>
          </>
        )}
      </div>

      <p className="text-[#404040]">
        The tags this app can apply from a work item's right-click menu. Every tag
        is editable and removable, and any tag can use a chip, flame, or repair
        visual.
      </p>

      {status === "error" && <UnavailableNotice reason={error} />}

      {writeError && (
        <div className="w95-panel flex items-start gap-2 px-2 py-1.5">
          <TriangleAlert className="mt-px h-3 w-3 shrink-0 text-[#8a0f0f]" />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {writeError}
          </span>
          <button
            type="button"
            className="w95-btn shrink-0"
            onClick={() => setWriteError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ---- the table ---------------------------------------------------- */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-[9px] font-bold text-[#404040]">
          <span className="w-[70px] shrink-0">Marker</span>
          <span className="min-w-0 flex-1">Tag details</span>
          <span className="w-[86px] shrink-0">Special render</span>
          <span className="w-[62px] shrink-0">Source</span>
          <span className="w-[80px] shrink-0 text-right">Actions</span>
        </div>

        {tags.map((tag, i) => {
          const stored = tag.id
            ? configured.find((c) => c.id === tag.id)
            : undefined;

          if (editingId && stored && editingId === stored.id) {
            return (
              <TagRowEditor
                key={tag.key}
                tag={tag}
                busy={busy}
                onCancel={() => setEditingId(null)}
                onSave={(patch) => saveTag(stored, patch)}
              />
            );
          }

          return (
            <div
              key={tag.key}
              className={cn(
                "flex items-center gap-1.5 px-1.5 py-1 ring-1 ring-black/10",
                i % 2 === 1 ? "bg-[#e4e1dc]" : "bg-[#cfccc7]",
              )}
            >
              <span className="flex w-[70px] shrink-0 items-center gap-1">
                <TagMarkerPreview tag={tag} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold" title={tag.label}>
                  {tag.label}
                </span>
                <span
                  className="block truncate text-[10px] text-[#404040]"
                  title={tag.description}
                >
                  {tag.description}
                </span>
                <span
                  className="block truncate font-mono text-[9px] text-[#505050]"
                  title={tag.tag}
                >
                  {tag.tag}
                </span>
              </span>
              <span className="w-[86px] shrink-0 text-[10px]">
                {tag.marker === "none"
                  ? "No"
                  : markerStyle(tag.marker).icon
                    ? "Yes — icon"
                    : "Yes — chip"}
              </span>
              <span className="w-[62px] shrink-0 text-[10px] text-[#404040]">
                Configured
              </span>
              <span className="flex w-[80px] shrink-0 items-center justify-end gap-1">
                <>
                  <button
                    type="button"
                    className="w95-btn"
                    disabled={!canWrite || busy || !stored}
                    title={
                      canWrite
                        ? "Edit this tag's label, description, and marker"
                        : "Tags cannot be edited until they load."
                    }
                    onClick={() => stored && setEditingId(stored.id)}
                    aria-label={`Edit ${tag.label}`}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="w95-btn"
                    disabled={!canWrite || busy || !stored}
                    title={
                      canWrite
                        ? "Remove this tag from the configuration"
                        : "Tags cannot be removed until they load."
                    }
                    onClick={() => stored && void removeTag(stored)}
                    aria-label={`Remove ${tag.label}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-[#404040]">
        {configuredCount === 0
          ? status === "ready"
            ? "No tags configured yet."
            : "Configured tags are unavailable until they load."
          : `${configuredCount} configured ${configuredCount === 1 ? "tag" : "tags"}.`}
      </p>

      {/* ---- add ---------------------------------------------------------- */}
      {adding ? (
        <TagAddForm
          existing={tags}
          busy={busy}
          onCancel={() => setAdding(false)}
          onAdd={addTag}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="w95-btn w95-btn--default"
            disabled={!canWrite || busy}
            title={
              canWrite
                ? "Add a tag to the configuration"
                : "Tags can be added once the configured tags have loaded."
            }
            onClick={() => {
              setWriteError(null);
              setAdding(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add a tag…
          </button>
          {!canWrite && (
            <span className="text-[10px] text-[#404040]">
              Adding, editing and removing tags is available once the configured tags load.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The marker column shows the configured visual or an honest dash. */
function TagMarkerPreview({ tag }: { tag: ResolvedTag }) {
  if (tag.marker === "none") {
    return <span className="text-[10px] text-[#808080]">— none</span>;
  }
  return <TagVisual tag={tag} />;
}

function MarkerSelect({
  value,
  onChange,
  disabled,
  id,
}: {
  value: MarkerStyleId;
  onChange: (next: MarkerStyleId) => void;
  disabled?: boolean;
  id: string;
}) {
  // The app's 95-styled Radix select (see win95.css's [data-slot="select-*"]
  // rules), the same control the category picker uses — not a raw <select>,
  // which would render as the browser's modern widget in the middle of a 95 UI.
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(isMarkerStyleId(next) ? next : "none")}
    >
      <SelectTrigger id={id} className="h-[22px] min-w-[9rem] text-[11px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MARKER_STYLES.map((style) => (
          <SelectItem key={style.id} value={style.id}>
            {style.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TagAddForm({
  existing,
  busy,
  onCancel,
  onAdd,
}: {
  existing: ResolvedTag[];
  busy: boolean;
  onCancel: () => void;
  onAdd: (input: {
    tag: string;
    label: string;
    description: string;
    marker: MarkerStyleId;
  }) => Promise<string | null>;
}) {
  const [tag, setTag] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [marker, setMarker] = useState<MarkerStyleId>("none");
  const [problem, setProblem] = useState<string | null>(null);

  const style = markerStyle(marker);

  return (
    <form
      className="w95-panel flex flex-col gap-2 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        // The SAME pure rule the merge relies on refuses duplicate tag names.
        const invalid = validateNewTag(tag, label, description, existing);
        if (invalid) {
          setProblem(invalid);
          return;
        }
        setProblem(null);
        void onAdd({
          tag: tag.trim(),
          label: label.trim(),
          description: description.trim(),
          marker,
        });
      }}
    >
      <span className="flex items-center gap-1 font-bold">
        <Plus className="h-3.5 w-3.5" /> Add a tag
      </span>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[16rem] flex-1 flex-col gap-0.5">
          <label htmlFor="tag-add-tag" className="text-[10px] font-bold">
            Azure DevOps tag (exact)
          </label>
          <input
            id="tag-add-tag"
            className="w95-in h-[22px] px-1 text-[11px]"
            value={tag}
            maxLength={MAX_TAG_LENGTH}
            disabled={busy}
            placeholder="e.g. Needs Design Review"
            onChange={(e) => setTag(e.target.value)}
          />
        </div>
        <div className="flex min-w-[10rem] flex-col gap-0.5">
          <label htmlFor="tag-add-label" className="text-[10px] font-bold">
            Label
          </label>
          <input
            id="tag-add-label"
            className="w95-in h-[22px] px-1 text-[11px]"
            value={label}
            maxLength={MAX_LABEL_LENGTH}
            disabled={busy}
            placeholder="e.g. Design Review"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <label htmlFor="tag-add-marker" className="text-[10px] font-bold">
            Card marker
          </label>
          <MarkerSelect
            id="tag-add-marker"
            value={marker}
            onChange={setMarker}
            disabled={busy}
          />
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        <label htmlFor="tag-add-description" className="text-[10px] font-bold">
          Description
        </label>
        <textarea
          id="tag-add-description"
          className="w95-in min-h-14 resize-y px-1 py-1 text-[11px]"
          value={description}
          maxLength={MAX_TAG_DESCRIPTION_LENGTH}
          disabled={busy}
          placeholder="Explain what this tag means and when it should be used."
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <p className="text-[10px] text-[#404040]">
        {style.description}{" "}
        {marker !== "none" && label.trim() && (
          <>
            Preview:{" "}
            <TagVisual
              tag={{
                key: "preview",
                tag: tag.trim() || label.trim(),
                label: label.trim(),
                description: description.trim(),
                marker,
              }}
            />
          </>
        )}
      </p>
      <p className="text-[10px] text-[#404040]">
        The tag must match Azure DevOps exactly — matching is whole-tag and
        case-insensitive, so “{tag.trim() || "Needs Design Review"}” will not
        match a longer tag that merely contains it. It cannot be changed after it
        is added; remove the tag and add it again instead, so work items already
        carrying the old value are never silently orphaned.
      </p>

      {problem && (
        <p className="flex items-start gap-1.5 font-bold text-[#8a0f0f]">
          <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{problem}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="w95-btn w95-btn--default" disabled={busy}>
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          {busy ? "Saving…" : "Add tag"}
        </button>
        <button type="button" className="w95-btn" onClick={onCancel} disabled={busy}>
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    </form>
  );
}

function TagRowEditor({
  tag,
  busy,
  onCancel,
  onSave,
}: {
  tag: ResolvedTag;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: {
    label: string;
    description: string;
    marker: MarkerStyleId;
  }) => Promise<string | null>;
}) {
  const [label, setLabel] = useState(tag.label);
  const [description, setDescription] = useState(tag.description);
  const [marker, setMarker] = useState<MarkerStyleId>(tag.marker);
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-2 bg-[#dfdfdf] px-1.5 py-1.5 ring-1 ring-black/20"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = label.trim();
        if (!trimmed) {
          setProblem("Enter a short label to show in menus and on cards.");
          return;
        }
        const trimmedDescription = description.trim();
        if (!trimmedDescription) {
          setProblem("Enter a description for this tag.");
          return;
        }
        setProblem(null);
        void onSave({ label: trimmed, description: trimmedDescription, marker });
      }}
    >
      <div className="flex min-w-[10rem] flex-col gap-0.5">
        <label htmlFor={`tag-edit-label-${tag.key}`} className="text-[10px] font-bold">
          Label
        </label>
        <input
          id={`tag-edit-label-${tag.key}`}
          className="w95-in h-[22px] px-1 text-[11px]"
          value={label}
          maxLength={MAX_LABEL_LENGTH}
          disabled={busy}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="flex min-w-[16rem] flex-[2] flex-col gap-0.5">
        <label
          htmlFor={`tag-edit-description-${tag.key}`}
          className="text-[10px] font-bold"
        >
          Description
        </label>
        <textarea
          id={`tag-edit-description-${tag.key}`}
          className="w95-in min-h-[44px] resize-y px-1 py-1 text-[11px]"
          value={description}
          maxLength={MAX_TAG_DESCRIPTION_LENGTH}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={`tag-edit-marker-${tag.key}`} className="text-[10px] font-bold">
          Card marker
        </label>
        <MarkerSelect
          id={`tag-edit-marker-${tag.key}`}
          value={marker}
          onChange={setMarker}
          disabled={busy}
        />
      </div>
      <span
        className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#404040]"
        title={tag.tag}
      >
        {tag.tag}{" "}
        <span className="font-sans">(the tag itself cannot be changed)</span>
      </span>
      <button type="submit" className="w95-btn w95-btn--default" disabled={busy}>
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        Save
      </button>
      <button type="button" className="w95-btn" onClick={onCancel} disabled={busy}>
        <X className="h-3.5 w-3.5" />
        Cancel
      </button>
      {problem && (
        <p className="w-full font-bold text-[#8a0f0f]">{problem}</p>
      )}
    </form>
  );
}

/**
 * Why the configured tags are missing, said plainly — the retro board's
 * convention, and the point of it: this must never read as "no tags are
 * configured", because that is a different and much more alarming claim.
 */
function UnavailableNotice({ reason }: { reason: string | null }) {
  return (
    <div className="w95-panel space-y-1.5 px-2 py-2">
      <p className="flex items-center gap-1.5 font-bold">
        <CloudOff className="h-3.5 w-3.5" />
        The configured tags could not be read.
      </p>
      <p className="font-bold">
        No tag configuration or card visual is assumed while tags are
        unavailable. Work-item detail tags remain visible from Azure DevOps.
      </p>
      {reason && (
        <p className="w95-in px-1 py-0.5 font-mono text-[10px] [overflow-wrap:anywhere]">
          {reason}
        </p>
      )}
    </div>
  );
}

/* ========================================================================== */
/* 2. WORK ITEMS BY TAG                                                        */
/* ========================================================================== */

function ItemsByTagSection({
  tags,
  items,
  status,
  onOpenItem,
  onPrefetchItem,
  onCancelPrefetch,
  onCardContextMenu,
}: {
  tags: ResolvedTag[];
  items: WorkItem[];
  status: ReturnType<typeof useTagConfig>["status"];
  onOpenItem: (item: WorkItem) => void;
  onPrefetchItem: (item: WorkItem) => void;
  onCancelPrefetch: () => void;
  onCardContextMenu: (item: WorkItem, x: number, y: number) => void;
}) {
  const groups = useMemo(
    () => tags.map((tag) => ({ tag, matches: itemsWithTag(items, tag.tag) })),
    [tags, items],
  );

  const totalTagged = useMemo(
    () => items.filter((it) => tags.some((t) => hasExactTag(it, t.tag))).length,
    [items, tags],
  );

  return (
    <div className="w95-panel flex flex-col gap-2 p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1 font-bold">
          <ShieldCheck className="h-3.5 w-3.5" /> Work items by tag
        </span>
        <span className="w95-status">
          {totalTagged} of {items.length} live board{" "}
          {items.length === 1 ? "item" : "items"} carry a known tag
        </span>
      </div>

      <p className="text-[#404040]">
        Grouped from the work items the Board has already loaded — no extra Azure
        DevOps query. That means it covers the same set the Board shows: live
        work items, so Closed and Removed ones are not here. An item carrying two
        tags appears under both. Right-click a row for the usual actions.
        {status !== "ready" && (
          <>
            {" "}
            The configured tags could not be read, so no tag groups are shown.
          </>
        )}
      </p>

      <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-2 2xl:grid-cols-3">
        {groups.map(({ tag, matches }) => (
          <div key={tag.key} className="w95-in min-w-0 p-1">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[#808080] pb-0.5">
              <TagMarkerPreview tag={tag} />
              <span className="font-bold">{tag.label}</span>
              <span className="min-w-0 truncate font-mono text-[10px] text-[#404040]">
                {tag.tag}
              </span>
              <span className="ml-auto w95-status">
                {matches.length} {matches.length === 1 ? "item" : "items"}
              </span>
            </div>

            {matches.length === 0 ? (
              <p className="px-1.5 py-1 text-[10px] text-[#404040]">
                No live board work item carries this tag right now.
              </p>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5">
                {matches.map((item, i) => (
                  <TaggedItemRow
                    key={item.id}
                    item={item}
                    zebra={i % 2 === 1}
                    onOpen={() => onOpenItem(item)}
                    onPrefetch={() => onPrefetchItem(item)}
                    onCancelPrefetch={onCancelPrefetch}
                    onContextMenu={(x, y) => onCardContextMenu(item, x, y)}
                  />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {groups.length === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="No tags to group by"
          description="Add a tag configuration to group matching work items here."
        />
      )}
    </div>
  );
}

/** One work item row. Same anatomy as the Bulk edit tab's preview rows, plus the
 *  click-to-open and right-click the rest of the app's rows have. */
function TaggedItemRow({
  item,
  zebra,
  onOpen,
  onPrefetch,
  onCancelPrefetch,
  onContextMenu,
}: {
  item: WorkItem;
  zebra: boolean;
  onOpen: () => void;
  onPrefetch: () => void;
  onCancelPrefetch: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const area = areaMeta(item.area);
  const state = stateMeta(item.state);
  const tagVisualFrameClass = useTagVisualFrameClasses(item);
  return (
    <li
      className={cn(
        "relative flex cursor-default flex-wrap items-center gap-1.5 px-1.5 py-0.5 ring-1 ring-black/10",
        zebra ? "bg-[#e4e1dc]" : "bg-[#cfccc7]",
        tagVisualFrameClass,
      )}
      onClick={onOpen}
      onPointerEnter={onPrefetch}
      onPointerLeave={onCancelPrefetch}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e.clientX, e.clientY);
      }}
      title="Click to open · right-click for actions"
    >
      <TagChips item={item} />
      <span className="min-w-0 flex-1 truncate" title={item.title}>
        {item.title}
      </span>
      <span className="shrink-0 font-mono text-[9px] text-[#404040]">{item.id}</span>
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
    </li>
  );
}
