import { cn } from "@/lib/utils";
import { useTagConfig, type ResolvedTag } from "@/lib/tag-config";
import { hasExactTag, type WorkItem } from "@/lib/work-items-data";

/** Full-card frame classes for the configured marker visuals an item carries. */
export function tagVisualFrameClasses(
  item: Pick<WorkItem, "tags">,
  configuredTags: readonly ResolvedTag[],
) {
  const markers = configuredTags
    .filter((tag) => hasExactTag(item, tag.tag))
    .map((tag) => tag.marker);
  return cn(
    markers.includes("icon-flame") && "w95-hot",
    markers.includes("icon-repair") && "w95-repair",
  );
}

export function useTagVisualFrameClasses(item: Pick<WorkItem, "tags">) {
  const { tags } = useTagConfig();
  return tagVisualFrameClasses(item, tags);
}
