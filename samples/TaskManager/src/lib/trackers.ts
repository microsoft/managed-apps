import { normalizeTag, type ResolvedTag } from "@/lib/tag-config";
import {
  MAX_TRACKER_DESCRIPTION_LENGTH,
  MAX_TRACKER_GROUP_CHILDREN,
  MAX_TRACKER_GROUP_TITLE_LENGTH,
  MAX_TRACKER_NAME_LENGTH,
  MAX_TRACKER_ROW_GROUPS,
  MAX_TRACKER_TAGS,
  type Tracker,
  type TrackerRowGroup,
} from "@/storage/collections";
import { withConflictRetry, type Collection, type Stored } from "@/storage/core";

export {
  MAX_TRACKER_DESCRIPTION_LENGTH,
  MAX_TRACKER_GROUP_CHILDREN,
  MAX_TRACKER_GROUP_TITLE_LENGTH,
  MAX_TRACKER_NAME_LENGTH,
  MAX_TRACKER_ROW_GROUPS,
  MAX_TRACKER_TAGS,
  type TrackerRowGroup,
};

export const TRACKERS_QUERY_KEY = ["trackers"] as const;

export type TrackerItem = Stored<Tracker>;
export type Trackers = Collection<Tracker>;

export interface NewTracker {
  name: string;
  description: string;
  tags: string[];
}

export async function listTrackers(trackers: Trackers): Promise<TrackerItem[]> {
  return await trackers.listAll({ orderBy: [{ field: "createdAt", direction: "asc" }] });
}

export function validateTracker(
  input: NewTracker,
  existing: readonly TrackerItem[],
  registeredTags: readonly ResolvedTag[],
  currentTrackerId?: string,
): string | null {
  const name = input.name.trim();
  const description = input.description.trim();
  const selected = new Set(input.tags.map(normalizeTag).filter(Boolean));
  const registered = new Set(registeredTags.map((tag) => normalizeTag(tag.tag)));

  if (!name) return "Enter a tracker name.";
  if (name.length > MAX_TRACKER_NAME_LENGTH) {
    return `Keep the tracker name to ${MAX_TRACKER_NAME_LENGTH} characters or fewer.`;
  }
  if (
    existing.some(
      (tracker) =>
        tracker.id !== currentTrackerId &&
        tracker.name.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    return `A tracker named “${name}” already exists.`;
  }
  if (!description) return "Describe the work stream this tracker represents.";
  if (description.length > MAX_TRACKER_DESCRIPTION_LENGTH) {
    return `Keep the description to ${MAX_TRACKER_DESCRIPTION_LENGTH.toLocaleString()} characters or fewer.`;
  }
  if (selected.size === 0) return "Select at least one registered tag.";
  if (selected.size > MAX_TRACKER_TAGS) {
    return `Select no more than ${MAX_TRACKER_TAGS} tags.`;
  }
  const unknown = [...selected].filter((tag) => !registered.has(tag));
  if (unknown.length > 0) {
    return "One or more selected tags are no longer registered. Refresh and choose again.";
  }
  return null;
}

function trackerFields(input: NewTracker) {
  const tags = Array.from(
    new Map(
      input.tags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => [normalizeTag(tag), tag]),
    ).values(),
  ).slice(0, MAX_TRACKER_TAGS);

  return {
    name: input.name.trim().slice(0, MAX_TRACKER_NAME_LENGTH),
    description: input.description
      .trim()
      .slice(0, MAX_TRACKER_DESCRIPTION_LENGTH),
    tags,
  };
}

export async function createTracker(trackers: Trackers, input: NewTracker): Promise<TrackerItem> {
  return await trackers.create({ ...trackerFields(input), rowGroups: [] });
}

export async function updateTrackerDetails(
  trackers: Trackers,
  trackerId: string,
  input: NewTracker,
): Promise<TrackerItem> {
  return await updateTrackerWithMerge(trackers, trackerId, () => trackerFields(input));
}

export function trackerRowGroups(
  tracker: Pick<TrackerItem, "rowGroups">,
): TrackerRowGroup[] {
  const value = tracker.rowGroups;
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  const groupIds = new Set<string>();
  const groups: TrackerRowGroup[] = [];

  for (const entry of value) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as TrackerRowGroup).groupId !== "string" ||
      typeof (entry as TrackerRowGroup).masterWorkItemId !== "string" ||
      !Array.isArray((entry as TrackerRowGroup).childWorkItemIds) ||
      typeof (entry as TrackerRowGroup).createdAt !== "string"
    ) {
      continue;
    }
    const groupId = (entry as TrackerRowGroup).groupId.trim();
    const masterWorkItemId = (
      entry as TrackerRowGroup
    ).masterWorkItemId.trim();
    if (
      !groupId ||
      !masterWorkItemId ||
      groupIds.has(groupId) ||
      usedIds.has(masterWorkItemId)
    ) {
      continue;
    }
    const childWorkItemIds = Array.from(
      new Set(
        (entry as TrackerRowGroup).childWorkItemIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(
            (id) =>
              id &&
              id !== masterWorkItemId &&
              !usedIds.has(id),
          ),
      ),
    ).slice(0, MAX_TRACKER_GROUP_CHILDREN);
    if (childWorkItemIds.length === 0) continue;

    const normalizedTitle =
      typeof (entry as TrackerRowGroup).title === "string"
        ? (entry as TrackerRowGroup).title
            .trim()
            .slice(0, MAX_TRACKER_GROUP_TITLE_LENGTH)
        : "";
    groups.push({
      groupId,
      title: normalizedTitle || "Combined work items",
      masterWorkItemId,
      childWorkItemIds,
      createdAt: (entry as TrackerRowGroup).createdAt.trim(),
    });
    groupIds.add(groupId);
    usedIds.add(masterWorkItemId);
    childWorkItemIds.forEach((id) => usedIds.add(id));
    if (groups.length >= MAX_TRACKER_ROW_GROUPS) break;
  }

  return groups;
}

export function groupedTrackerWorkItemIds(
  tracker: Pick<TrackerItem, "rowGroups">,
): Set<string> {
  return new Set(
    trackerRowGroups(tracker).flatMap((group) => [
      group.masterWorkItemId,
      ...group.childWorkItemIds,
    ]),
  );
}

export async function addTrackerRowChild(
  trackers: Trackers,
  trackerId: string,
  masterWorkItemId: string,
  childWorkItemId: string,
  groupTitle?: string,
): Promise<TrackerItem> {
  const masterId = masterWorkItemId.trim();
  const childId = childWorkItemId.trim();
  const title = groupTitle?.trim().slice(0, MAX_TRACKER_GROUP_TITLE_LENGTH) ?? "";
  if (!trackerId.trim() || !masterId || !childId || masterId === childId) {
    throw new Error("Choose two different tracker work items to combine.");
  }
  const newGroupId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  return await updateTrackerWithMerge(trackers, trackerId, (current) => {
    const groups = trackerRowGroups(current);
    const masterGroup = groups.find(
      (group) => group.masterWorkItemId === masterId,
    );
    const masterIsChild = groups.some((group) =>
      group.childWorkItemIds.includes(masterId),
    );
    const childGroup = groups.find(
      (group) =>
        group.masterWorkItemId === childId ||
        group.childWorkItemIds.includes(childId),
    );
    if (masterIsChild) {
      throw new Error("A nested work item cannot become a master row.");
    }
    if (masterGroup?.childWorkItemIds.includes(childId)) {
      return { rowGroups: groups };
    }
    if (childGroup) {
      throw new Error("That work item was already combined into another row.");
    }
    if (masterGroup) {
      if (masterGroup.childWorkItemIds.length >= MAX_TRACKER_GROUP_CHILDREN) {
        throw new Error(
          `A tracker row cannot contain more than ${MAX_TRACKER_GROUP_CHILDREN + 1} work items.`,
        );
      }
      return {
        rowGroups: groups.map((group) =>
          group.groupId === masterGroup.groupId
            ? {
                ...group,
                childWorkItemIds: [...group.childWorkItemIds, childId],
              }
            : group,
        ),
      };
    }
    if (groups.length >= MAX_TRACKER_ROW_GROUPS) {
      throw new Error(
        `A tracker cannot contain more than ${MAX_TRACKER_ROW_GROUPS} combined rows.`,
      );
    }
    if (!title) {
      throw new Error("Enter a title for the combined row.");
    }
    return {
      rowGroups: [
        ...groups,
        {
          groupId: newGroupId,
          title,
          masterWorkItemId: masterId,
          childWorkItemIds: [childId],
          createdAt,
        },
      ],
    };
  });
}

export async function removeTrackerRowChild(
  trackers: Trackers,
  trackerId: string,
  groupId: string,
  workItemId: string,
): Promise<TrackerItem> {
  const normalizedGroupId = groupId.trim();
  const normalizedWorkItemId = workItemId.trim();
  if (!trackerId.trim() || !normalizedGroupId || !normalizedWorkItemId) {
    throw new Error("The tracker, combined row, and nested item are required.");
  }

  return await updateTrackerWithMerge(trackers, trackerId, (current) => ({
    rowGroups: trackerRowGroups(current).flatMap((group) => {
      if (group.groupId !== normalizedGroupId) return [group];
      const remainingIds = [
        group.masterWorkItemId,
        ...group.childWorkItemIds,
      ].filter((id) => id !== normalizedWorkItemId);
      return remainingIds.length >= 2
        ? [
            {
              ...group,
              masterWorkItemId: remainingIds[0],
              childWorkItemIds: remainingIds.slice(1),
            },
          ]
        : [];
    }),
  }));
}

export async function updateTrackerRowGroupTitle(
  trackers: Trackers,
  trackerId: string,
  groupId: string,
  title: string,
): Promise<TrackerItem> {
  const normalizedGroupId = groupId.trim();
  const normalizedTitle = title
    .trim()
    .slice(0, MAX_TRACKER_GROUP_TITLE_LENGTH);
  if (!trackerId.trim() || !normalizedGroupId || !normalizedTitle) {
    throw new Error("Enter a title for the combined row.");
  }

  return await updateTrackerWithMerge(trackers, trackerId, (current) => {
    const groups = trackerRowGroups(current);
    if (!groups.some((group) => group.groupId === normalizedGroupId)) {
      throw new Error("This combined row no longer exists.");
    }
    return {
      rowGroups: groups.map((group) =>
        group.groupId === normalizedGroupId
          ? { ...group, title: normalizedTitle }
          : group,
      ),
    };
  });
}

/**
 * Read-merge-write with optimistic concurrency: every attempt re-reads the
 * latest tracker, applies `merge` to it and writes against that exact version.
 * A concurrent change (ConflictError) repeats the cycle instead of overwriting.
 */
async function updateTrackerWithMerge(
  trackers: Trackers,
  trackerId: string,
  merge: (current: TrackerItem) => Partial<Tracker>,
): Promise<TrackerItem> {
  return await withConflictRetry(async () => {
    const current = await trackers.get(trackerId);
    if (!current) {
      throw new Error("This tracker was deleted before the change could be saved.");
    }
    return await trackers.update(trackerId, merge(current), { ifVersion: current.version });
  });
}

export async function deleteTracker(trackers: Trackers, trackerId: string): Promise<void> {
  await trackers.delete(trackerId);
}
