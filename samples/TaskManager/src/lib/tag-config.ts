/**
 * TAG CONFIGURATION — the extensible list of work item tags the app knows about.
 *
 * Configured tags are app-owned data on the storage interface (`tagConfig`
 * collection). Every tag is an ordinary removable configuration; no tag name has
 * hardcoded marker behavior.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorText } from "@/lib/errors";
import {
  MARKER_STYLE_IDS,
  MAX_TAG_DESCRIPTION_LENGTH,
  MAX_TAG_LABEL_LENGTH,
  MAX_TAG_LENGTH,
  tagConfigCollection,
  type MarkerStyleId,
  type TagConfig,
} from "@/storage/collections";
import { withConflictRetry, type Collection, type Stored } from "@/storage/core";
import { useAppCollection, useInvalidateOnChange } from "@/storage/hooks";

export { MARKER_STYLE_IDS, MAX_TAG_DESCRIPTION_LENGTH, MAX_TAG_LENGTH, type MarkerStyleId };
export const MAX_LABEL_LENGTH = MAX_TAG_LABEL_LENGTH;

/** Shared query key, so every view reads ONE cached copy of the list. */
export const TAG_CONFIG_QUERY_KEY = ["tag-config"] as const;

/**
 * How many CONFIGURED tags the right-click menu will list inline before it
 * collapses them all into a single cascading "More tags ▸" flyout.
 */
export const INLINE_CONFIGURED_TAG_LIMIT = 3;
export interface MarkerStyle {
  id: MarkerStyleId;
  /** What the picker calls it. */
  name: string;
  /** What it actually does, said plainly. */
  description: string;
  /** Tailwind classes for the chip's face, or "" for the no-marker option. */
  chip: string;
  /** Bespoke icon visual, or null for chip/no-marker styles. */
  icon: "flame" | "repair" | null;
}

/** Compact chip styles shared by the Tags tab preview and every work-item card. */
export const MARKER_STYLES: MarkerStyle[] = [
  {
    id: "none",
    name: "No marker",
    description: "The tag can be applied and removed, but draws nothing on cards.",
    chip: "",
    icon: null,
  },
  {
    id: "chip-navy",
    name: "Navy chip",
    description: "A small navy chip with this tag's label, at the head of the card title.",
    chip: "bg-[#000080] text-white",
    icon: null,
  },
  {
    id: "chip-teal",
    name: "Teal chip",
    description: "A small teal chip with this tag's label, at the head of the card title.",
    chip: "bg-[#008080] text-white",
    icon: null,
  },
  {
    id: "chip-olive",
    name: "Olive chip",
    description: "A small olive chip with this tag's label, at the head of the card title.",
    chip: "bg-[#808000] text-white",
    icon: null,
  },
  {
    id: "chip-maroon",
    name: "Maroon chip",
    description: "A small maroon chip with this tag's label, at the head of the card title.",
    chip: "bg-[#800000] text-white",
    icon: null,
  },
  {
    id: "chip-rainbow",
    name: "Rainbow chip",
    description:
      "A small diagonal rainbow-gradient chip with this tag's label, at the head of the card title.",
    chip:
      "bg-[linear-gradient(135deg,#e53935_0%,#fb8c00_20%,#fdd835_40%,#43a047_60%,#1e88e5_80%,#8e24aa_100%)] text-white [text-shadow:1px_1px_0_#000]",
    icon: null,
  },
  {
    id: "icon-flame",
    name: "Flame",
    description: "An animated pixel flame with an alternating alert outline.",
    chip: "",
    icon: "flame",
  },
  {
    id: "icon-repair",
    name: "Repair wrench",
    description:
      "A pixel wrench with a caution-tape border.",
    chip: "",
    icon: "repair",
  },
];

export function isMarkerStyleId(value: unknown): value is MarkerStyleId {
  return (
    typeof value === "string" &&
    (MARKER_STYLE_IDS as readonly string[]).includes(value)
  );
}

export function markerStyle(id: MarkerStyleId): MarkerStyle {
  return MARKER_STYLES.find((s) => s.id === id) ?? MARKER_STYLES[0];
}

/** A configured tag as stored. */
export type TagConfigItem = Stored<TagConfig>;
export type TagConfigs = Collection<TagConfig>;
/**
 * A configured tag as the app uses it after validating stored values.
 */
export interface ResolvedTag {
  /** Stable key for React lists and menu entry ids. */
  key: string;
  /** The EXACT [System.Tags] value written to Azure DevOps. */
  tag: string;
  /** What the menu and the chip call it ("Mark as <label>"). */
  label: string;
  /** Plain-language meaning shown from detail-page tag chips. */
  description: string;
  /** Which configured chip or icon this tag draws. */
  marker: MarkerStyleId;
  /** The stored record id, omitted only for unsaved previews. */
  id?: string;
}

/**
 * The app's ONE tag-matching rule, in normalized form: whole tag,
 * case-insensitive, whitespace-trimmed. Identical to hasExactTag's comparison
 * (work-items-data.ts) so "is this item tagged X?" and "is X already
 * configured?" can never disagree about what counts as the same tag.
 */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * The configured tag list, deduped on normalized tag so duplicate stored rows can
 * never produce menu entries that fight over one [System.Tags] value.
 *
 * Rows that are structurally unusable — no tag, or a non-string one — are
 * skipped rather than rendered as a blank entry.
 */
export function mergeTagConfig(
  configured: readonly TagConfigItem[] | null | undefined,
): ResolvedTag[] {
  const out: ResolvedTag[] = [];
  const seen = new Set<string>();

  for (const row of configured ?? []) {
    const tag = typeof row?.tag === "string" ? row.tag.trim() : "";
    const key = normalizeTag(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const label =
      typeof row.label === "string" && row.label.trim() ? row.label.trim() : tag;
    const description =
      typeof row.description === "string" && row.description.trim()
        ? row.description.trim()
        : "No description has been configured for this tag yet.";

    out.push({
      key: `cfg-${row.id}`,
      tag,
      label,
      description,
      marker: isMarkerStyleId(row.marker) ? row.marker : "none",
      id: row.id,
    });
  }

  return out;
}

/**
 * Why a proposed tag can't be added, or null when it can.
 *
 * Pure and exported so the duplicate rule can be exercised directly rather
 * than only through the form.
 */
export function validateNewTag(
  tag: string,
  label: string,
  description: string,
  existing: readonly ResolvedTag[],
): string | null {
  const trimmedTag = tag.trim();
  const trimmedLabel = label.trim();
  const trimmedDescription = description.trim();

  if (!trimmedTag) return "Enter the exact Azure DevOps tag to track.";
  if (trimmedTag.includes(";")) {
    return "A tag cannot contain a semicolon — Azure DevOps uses “;” to separate tags in [System.Tags].";
  }
  if (trimmedTag.length > MAX_TAG_LENGTH) {
    return `That tag is ${trimmedTag.length} characters; Azure DevOps allows ${MAX_TAG_LENGTH}.`;
  }
  if (!trimmedLabel) return "Enter a short label to show in menus and on cards.";
  if (trimmedLabel.length > MAX_LABEL_LENGTH) {
    return `That label is ${trimmedLabel.length} characters; keep it to ${MAX_LABEL_LENGTH} or fewer so it fits a menu row.`;
  }
  if (!trimmedDescription) return "Enter a description for this tag.";
  if (trimmedDescription.length > MAX_TAG_DESCRIPTION_LENGTH) {
    return `That description is ${trimmedDescription.length} characters; keep it to ${MAX_TAG_DESCRIPTION_LENGTH} or fewer.`;
  }

  const clash = existing.find(
    (t) => normalizeTag(t.tag) === normalizeTag(trimmedTag),
  );
  if (clash) {
    return `“${clash.tag}” is already configured.`;
  }

  return null;
}

/** Every configured tag, oldest first. */
export async function listTagConfig(tags: TagConfigs): Promise<TagConfigItem[]> {
  return await tags.listAll({ orderBy: [{ field: "createdAt", direction: "asc" }] });
}

/** Add a configured tag. */
export async function createTagConfig(
  tags: TagConfigs,
  input: { tag: string; label: string; description: string; marker: MarkerStyleId },
): Promise<TagConfigItem> {
  return await tags.create({
    tag: input.tag.trim().slice(0, MAX_TAG_LENGTH),
    label: input.label.trim().slice(0, MAX_TAG_LABEL_LENGTH),
    description: input.description.trim().slice(0, MAX_TAG_DESCRIPTION_LENGTH),
    marker: input.marker,
  });
}

/**
 * Edit a configured tag's label, description and/or marker. Re-reads and
 * retries on a concurrent change. The exact ADO tag is deliberately not
 * editable: changing it would orphan every work item already carrying it.
 */
export async function updateTagConfig(
  tags: TagConfigs,
  id: string,
  patch: { label?: string; description?: string; marker?: MarkerStyleId },
): Promise<TagConfigItem> {
  const changes: Partial<TagConfig> = {};
  if (patch.label !== undefined) changes.label = patch.label.trim().slice(0, MAX_TAG_LABEL_LENGTH);
  if (patch.description !== undefined) {
    changes.description = patch.description.trim().slice(0, MAX_TAG_DESCRIPTION_LENGTH);
  }
  if (patch.marker !== undefined) changes.marker = patch.marker;
  return await withConflictRetry(async () => {
    const current = await tags.get(id);
    if (!current) throw new Error("This tag was removed before the change could be saved.");
    return await tags.update(id, changes, { ifVersion: current.version });
  });
}

/** Remove a configured tag. Work items already carrying it in Azure DevOps keep it. */
export async function deleteTagConfig(tags: TagConfigs, id: string): Promise<void> {
  await tags.delete(id);
}

export type TagConfigStatus = "loading" | "ready" | "error";

export interface TagConfigState {
  /** The validated configured list. Empty unless ready. */
  tags: ResolvedTag[];
  /** The stored rows, for the config table's edit/delete. */
  configured: TagConfigItem[];
  status: TagConfigStatus;
  error: string | null;
  refetch: () => void;
  collection: TagConfigs;
}

/**
 * The app's single source of tag configuration. One shared query key, so the
 * Board's cards, the right-click menu and the Tags tab all read the same list.
 */
export function useTagConfig(): TagConfigState {
  const collection = useAppCollection(tagConfigCollection);
  useInvalidateOnChange(collection, TAG_CONFIG_QUERY_KEY);
  const query = useQuery({
    queryKey: TAG_CONFIG_QUERY_KEY,
    queryFn: () => listTagConfig(collection),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const configured = useMemo(() => query.data ?? [], [query.data]);
  const tags = useMemo(() => mergeTagConfig(query.data), [query.data]);

  return {
    tags,
    configured,
    status: query.isError ? "error" : query.isPending ? "loading" : "ready",
    error: query.isError ? errorText(query.error, "Tags could not be loaded.") : null,
    refetch: () => void query.refetch(),
    collection,
  };
}