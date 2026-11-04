import { normalizeTag } from "@/lib/tag-config";
import { type WorkItem } from "@/lib/work-items-data";

/**
 * The lowercased text the Board's filter searches — title, description and raw
 * Azure DevOps tags —
 * cached PER WORK ITEM OBJECT.
 *
 * The description searched here is the item's `description`, which is already
 * PLAIN TEXT: the connector's `System.Description` arrives as HTML and is run
 * through toText() at hydration (lib/ado.ts), which drops every tag, decodes
 * the handful of entities ADO emits and collapses whitespace. So the filter
 * matches what the user can actually read — never markup, never an attribute.
 * That matters beyond tidiness: a search for "http" or "span" would otherwise
 * hit the href and the tag names inside almost every formatted description.
 *
 * Why a WeakMap rather than lowercasing on the fly: this runs on EVERY
 * keystroke, across every work item on the board, and descriptions are long —
 * far longer than titles. Lowercasing them per keystroke would allocate a fresh
 * copy of every description on the board on every character typed. Caching by
 * the item object means each description is lowercased at most ONCE, and typing
 * costs nothing but the `includes` scan.
 *
 * Keying on the OBJECT (not the id) is what keeps that cache honest: an
 * optimistic write or a refetch replaces the changed item with a NEW object, so
 * it simply misses the cache and is re-derived, while every untouched item
 * keeps its entry. Nothing has to be invalidated by hand, and a stale
 * description can never be searched. Entries are collected with the items.
 */
const SEARCH_TEXT = new WeakMap<WorkItem, string>();

function searchText(item: WorkItem): string {
  const cached = SEARCH_TEXT.get(item);
  if (cached !== undefined) return cached;
  // Joined with a NEWLINE, which the needle can never contain (it comes from a
  // single-line <input>), so a multi-word search can't match across the seam
  // between adjacent fields.
  const text = [
    item.title,
    item.description ?? "",
    ...(item.tags ?? []),
  ]
    .join("\n")
    .toLowerCase();
  SEARCH_TEXT.set(item, text);
  return text;
}

/**
 * Case-insensitive substring match over the item's title, description, raw tags
 * and the configured display labels of tags applied to that item.
 * `needle` is expected already trimmed and lowercased (the caller does it once
 * per keystroke rather than once per item).
 */
export function matchesFilter(
  item: WorkItem,
  needle: string,
  configuredTagLabels: ReadonlyMap<string, string>,
): boolean {
  if (searchText(item).includes(needle)) return true;
  return (item.tags ?? []).some((tag) =>
    configuredTagLabels.get(normalizeTag(tag))?.includes(needle),
  );
}
