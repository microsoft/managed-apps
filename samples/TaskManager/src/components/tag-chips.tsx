import { cn } from "@/lib/utils";
import { HotIndicator } from "@/components/hot-indicator";
import { RepairIndicator } from "@/components/repair-indicator";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { hasExactTag, type WorkItem } from "@/lib/work-items-data";
import {
  markerStyle,
  normalizeTag,
  useTagConfig,
  type ResolvedTag,
} from "@/lib/tag-config";
import type { ReactNode } from "react";

function TagInfoHover({
  label,
  rawTag,
  description,
  children,
}: {
  label: string;
  rawTag: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="w95-panel z-[1200] w-64 rounded-none border-0 bg-[#c0c0c0] p-2 text-[11px] text-black shadow-none"
      >
        <p className="font-bold">
          {label} <span className="font-mono font-normal">({rawTag})</span>
        </p>
        <p className="mt-1 leading-snug text-[#303030]">{description}</p>
      </HoverCardContent>
    </HoverCard>
  );
}

/** One chip. Exported so the Tags tab can preview a style without an item. */
export function TagChip({
  tag,
  className,
}: {
  tag: ResolvedTag;
  className?: string;
}) {
  const style = markerStyle(tag.marker);
  if (!style.chip) return null;
  // The chip shows the short LABEL; the tooltip names the exact ADO tag, the
  // same split the right-click menu uses (wording for people, tag for truth).
  const title = `Tagged ${tag.tag}`;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center px-1 py-px text-[9px] font-medium leading-none ring-1 ring-black/20",
        style.chip,
        className,
      )}
      role="img"
      aria-label={title}
      title={title}
    >
      {tag.label}
    </span>
  );
}

/** One configured card visual: chip, flame, wrench, or nothing. */
export function TagVisual({
  tag,
  className,
}: {
  tag: ResolvedTag;
  className?: string;
}) {
  const style = markerStyle(tag.marker);
  if (style.icon === "flame") {
    return <HotIndicator className={className} label={`Tagged ${tag.tag}`} />;
  }
  if (style.icon === "repair") {
    return <RepairIndicator className={className} label={`Tagged ${tag.tag}`} />;
  }
  return <TagChip tag={tag} className={className} />;
}

/**
 * Every configured visual this work item carries, in configured order.
 *
 * Renders NOTHING at all when the store is unreachable or nothing is
 * configured. Matching is `hasExactTag`: whole tag, case-insensitive, trimmed.
 */
export function TagChips({
  item,
  className,
}: {
  item: Pick<WorkItem, "tags">;
  className?: string;
}) {
  const { tags } = useTagConfig();
  const visuals = tags.filter(
    (tag) => tag.marker !== "none" && hasExactTag(item, tag.tag),
  );
  if (visuals.length === 0) return null;
  return (
    <>
      {visuals.map((tag) => (
        <TagInfoHover
          key={tag.key}
          label={tag.label}
          rawTag={tag.tag}
          description={tag.description}
        >
          <span
            className="inline-flex cursor-help focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-black"
            tabIndex={0}
          >
            <TagVisual tag={tag} className={className} />
          </span>
        </TagInfoHover>
      ))}
    </>
  );
}

/** Every raw ADO tag as a chip in work-item details, including unconfigured tags. */
export function DetailTagChips({ tags }: { tags: readonly string[] }) {
  const { tags: configuredTags } = useTagConfig();
  const configuredByName = new Map(
    configuredTags.map((tag) => [normalizeTag(tag.tag), tag]),
  );

  return tags.map((rawTag) => {
    const tag = configuredByName.get(normalizeTag(rawTag));
    const marker = tag ? markerStyle(tag.marker) : null;
    const chipClass = marker?.chip || "bg-[#e2e2e2] text-[#303030]";
    const label = tag?.label ?? rawTag;
    const description =
      tag?.description ?? "This Azure DevOps tag is not configured in Task Manager.";

    return (
      <TagInfoHover
        key={rawTag}
        label={label}
        rawTag={rawTag}
        description={description}
      >
        <span
          className={cn(
            "inline-flex max-w-full cursor-help items-center break-all px-1.5 py-px text-[10px] font-medium ring-1 ring-black/30 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-black",
            chipClass,
          )}
          tabIndex={0}
        >
          {label}
        </span>
      </TagInfoHover>
    );
  });
}
