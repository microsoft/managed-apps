import { appConfig } from "@/config";
import { safeUrl } from "@/lib/safe-url";
import {
  MAX_SCENARIO_NAME_LENGTH,
  MAX_SCENARIO_NOTES_LENGTH,
  MAX_SCENARIO_WORK_ITEMS,
  MAX_SCENARIOS,
  MISC_SCENARIO_ID,
  type TrackerScenario,
  type TrackerScenarioSet as TrackerScenarioSetData,
} from "@/storage/collections";
import { withConflictRetry, type Collection, type Stored } from "@/storage/core";

export {
  MAX_SCENARIO_NAME_LENGTH,
  MAX_SCENARIO_NOTES_LENGTH,
  MAX_SCENARIO_WORK_ITEMS,
  MAX_SCENARIOS,
  MISC_SCENARIO_ID,
  type TrackerScenario,
};

export const TRACKER_SCENARIOS_QUERY_KEY = ["tracker-scenario-sets"] as const;

/** One record per tracker; the record id is the tracker id. */
export type TrackerScenarioSet = Stored<TrackerScenarioSetData>;
export type TrackerScenarioSets = Collection<TrackerScenarioSetData>;

function miscScenario(): TrackerScenario {
  return {
    scenarioId: MISC_SCENARIO_ID,
    name: "Misc",
    notes: "",
    workItemIds: [],
    createdAt: new Date().toISOString(),
  };
}

function normalizeScenario(entry: unknown): TrackerScenario | null {
  if (
    typeof entry !== "object" ||
    entry === null ||
    typeof (entry as TrackerScenario).scenarioId !== "string" ||
    typeof (entry as TrackerScenario).name !== "string" ||
    typeof (entry as TrackerScenario).notes !== "string" ||
    !Array.isArray((entry as TrackerScenario).workItemIds) ||
    typeof (entry as TrackerScenario).createdAt !== "string"
  ) {
    return null;
  }
  const scenarioId = (entry as TrackerScenario).scenarioId.trim();
  const name = (entry as TrackerScenario).name
    .trim()
    .slice(0, MAX_SCENARIO_NAME_LENGTH);
  if (!scenarioId || !name) return null;
  const issueUrl =
    typeof (entry as TrackerScenario).issueUrl === "string"
      ? (entry as TrackerScenario).issueUrl?.trim()
      : undefined;
  return {
    scenarioId,
    name,
    notes: (entry as TrackerScenario).notes
      .trim()
      .slice(0, MAX_SCENARIO_NOTES_LENGTH),
    workItemIds: Array.from(
      new Set(
        (entry as TrackerScenario).workItemIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ).slice(0, MAX_SCENARIO_WORK_ITEMS),
    ...(issueUrl ? { issueUrl } : {}),
    createdAt: (entry as TrackerScenario).createdAt,
  };
}

export function trackerScenarios(
  set: Pick<TrackerScenarioSet, "scenarios"> | null | undefined,
): TrackerScenario[] {
  const usedIds = new Set<string>();
  const usedWorkItems = new Set<string>();
  const normalized = (set?.scenarios ?? []).flatMap((entry) => {
    const scenario = normalizeScenario(entry);
    if (!scenario || usedIds.has(scenario.scenarioId)) return [];
    usedIds.add(scenario.scenarioId);
    scenario.workItemIds = scenario.workItemIds.filter((id) => {
      if (usedWorkItems.has(id)) return false;
      usedWorkItems.add(id);
      return true;
    });
    return [scenario];
  });
  const misc = normalized.find(
    (scenario) => scenario.scenarioId === MISC_SCENARIO_ID,
  );
  const named = normalized
    .filter((scenario) => scenario.scenarioId !== MISC_SCENARIO_ID)
    .slice(0, MAX_SCENARIOS - 1);
  return [
    ...named,
    misc ? { ...misc, name: "Misc", workItemIds: [] } : miscScenario(),
  ];
}

export async function getTrackerScenarioSet(
  sets: TrackerScenarioSets,
  trackerId: string,
): Promise<TrackerScenarioSet | null> {
  const id = trackerId.trim();
  if (!id) return null;
  return (await sets.get(id)) ?? null;
}

/**
 * Validates a link to an issue in the team's issue tracker.
 *
 * With `VITE_ISSUE_TRACKER_BASE_URL` set (e.g. https://github.com/contoso/app/issues)
 * the link must live under that base. Without it any absolute https URL is accepted.
 */
export function validateIssueUrl(
  value: string,
  baseUrl: string = appConfig.links.issueTrackerBaseUrl,
): string {
  const safe = safeUrl(value.trim());
  let parsed: URL;
  try {
    if (!safe) throw new Error("unsafe");
    parsed = new URL(safe);
  } catch {
    throw new Error("Enter a valid https issue URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Enter a valid https issue URL.");
  }
  parsed.hash = "";
  const normalized = parsed.toString();
  if (baseUrl) {
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/, "");
    const underBase =
      parsed.origin === base.origin &&
      (parsed.pathname === basePath || parsed.pathname.startsWith(`${basePath}/`));
    if (!underBase) throw new Error(`Use an issue URL under ${base.origin}${basePath}.`);
  }
  return normalized;
}

type ScenarioMutation = (scenarios: TrackerScenario[]) => TrackerScenario[];

/**
 * Read-modify-write of a tracker's scenarios. Every attempt re-reads the record
 * and writes against its version; a concurrent change (ConflictError) retries.
 */
async function mutateScenarioSet(
  sets: TrackerScenarioSets,
  trackerId: string,
  mutate: ScenarioMutation,
): Promise<TrackerScenarioSet> {
  const id = trackerId.trim();
  if (!id) throw new Error("The tracker id is required.");
  return await withConflictRetry(async () => {
    const current = await sets.get(id);
    if (!current) {
      return await sets.create({ trackerId: id, scenarios: mutate(trackerScenarios(null)) }, { id });
    }
    return await sets.update(
      id,
      { scenarios: mutate(trackerScenarios(current)) },
      { ifVersion: current.version },
    );
  });
}

export async function createTrackerScenario(
  sets: TrackerScenarioSets,
  trackerId: string,
  name: string,
): Promise<TrackerScenarioSet> {
  const normalizedName = name.trim().slice(0, MAX_SCENARIO_NAME_LENGTH);
  if (!normalizedName) throw new Error("Enter a scenario name.");
  if (normalizedName.toLowerCase() === "misc") {
    throw new Error("Misc is reserved for unorganized work.");
  }

  const scenarioId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  return await mutateScenarioSet(sets, trackerId, (scenarios) => {
    if (
      scenarios.some(
        (scenario) =>
          scenario.name.trim().toLowerCase() === normalizedName.toLowerCase(),
      )
    ) {
      throw new Error("A scenario with that name already exists.");
    }
    if (scenarios.length >= MAX_SCENARIOS) {
      throw new Error(`A tracker cannot contain more than ${MAX_SCENARIOS} scenarios.`);
    }
    return [
      ...scenarios,
      {
        scenarioId,
        name: normalizedName,
        notes: "",
        workItemIds: [],
        createdAt,
      },
    ];
  });
}

export async function createTrackerScenarioFromWorkItem(
  sets: TrackerScenarioSets,
  trackerId: string,
  scenarioName: string,
  workItemId: string,
): Promise<TrackerScenarioSet> {
  const normalizedName = scenarioName.trim();
  const normalizedWorkItemId = workItemId.trim();
  if (!normalizedName) throw new Error("The work item needs a title.");
  if (normalizedName.length > MAX_SCENARIO_NAME_LENGTH) {
    throw new Error(
      `A scenario name cannot exceed ${MAX_SCENARIO_NAME_LENGTH} characters.`,
    );
  }
  if (!normalizedWorkItemId) throw new Error("The work item ID is missing.");
  const scenarioId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  return await mutateScenarioSet(sets, trackerId, (scenarios) => {
    if (
      scenarios.some(
        (scenario) =>
          scenario.name.trim().toLowerCase() === normalizedName.toLowerCase(),
      )
    ) {
      throw new Error("A scenario with that name already exists.");
    }
    if (scenarios.length >= MAX_SCENARIOS) {
      throw new Error(`A tracker cannot contain more than ${MAX_SCENARIOS} scenarios.`);
    }
    const nextScenario: TrackerScenario = {
      scenarioId,
      name: normalizedName,
      notes: "",
      workItemIds: [normalizedWorkItemId],
      createdAt,
    };
    const withoutMovedItem = scenarios.map((scenario) => ({
      ...scenario,
      workItemIds: scenario.workItemIds.filter(
        (id) => id !== normalizedWorkItemId,
      ),
    }));
    const miscIndex = withoutMovedItem.findIndex(
      (scenario) => scenario.scenarioId === MISC_SCENARIO_ID,
    );
    if (miscIndex < 0) return [...withoutMovedItem, nextScenario];
    return [
      ...withoutMovedItem.slice(0, miscIndex),
      nextScenario,
      ...withoutMovedItem.slice(miscIndex),
    ];
  });
}

export async function renameTrackerScenario(
  sets: TrackerScenarioSets,
  trackerId: string,
  scenarioId: string,
  name: string,
): Promise<TrackerScenarioSet> {
  if (scenarioId === MISC_SCENARIO_ID) {
    throw new Error("The Misc scenario cannot be renamed.");
  }
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Enter a scenario name.");
  if (normalizedName.length > MAX_SCENARIO_NAME_LENGTH) {
    throw new Error(
      `A scenario name cannot exceed ${MAX_SCENARIO_NAME_LENGTH} characters.`,
    );
  }
  if (normalizedName.toLowerCase() === "misc") {
    throw new Error("Misc is reserved for unorganized work.");
  }
  return await mutateScenarioSet(sets, trackerId, (scenarios) => {
    if (!scenarios.some((scenario) => scenario.scenarioId === scenarioId)) {
      throw new Error("The scenario no longer exists.");
    }
    if (
      scenarios.some(
        (scenario) =>
          scenario.scenarioId !== scenarioId &&
          scenario.name.trim().toLowerCase() === normalizedName.toLowerCase(),
      )
    ) {
      throw new Error("A scenario with that name already exists.");
    }
    return scenarios.map((scenario) =>
      scenario.scenarioId === scenarioId
        ? { ...scenario, name: normalizedName }
        : scenario,
    );
  });
}

export async function moveTrackerWorkItems(
  sets: TrackerScenarioSets,
  trackerId: string,
  workItemIds: string[],
  targetScenarioId: string,
): Promise<TrackerScenarioSet> {
  const ids = new Set(workItemIds.map((id) => id.trim()).filter(Boolean));
  if (ids.size === 0) throw new Error("Select at least one work item.");
  return await mutateScenarioSet(sets, trackerId, (scenarios) => {
    const target = scenarios.find(
      (scenario) => scenario.scenarioId === targetScenarioId,
    );
    if (!target) {
      throw new Error("The destination scenario no longer exists.");
    }
    if (targetScenarioId !== MISC_SCENARIO_ID) {
      const incomingCount = [...ids].filter(
        (id) => !target.workItemIds.includes(id),
      ).length;
      if (target.workItemIds.length + incomingCount > MAX_SCENARIO_WORK_ITEMS) {
        throw new Error(
          `A scenario cannot contain more than ${MAX_SCENARIO_WORK_ITEMS} work items.`,
        );
      }
    }
    return scenarios.map((scenario) => {
      const withoutMoved = scenario.workItemIds.filter((id) => !ids.has(id));
      return scenario.scenarioId === targetScenarioId &&
        targetScenarioId !== MISC_SCENARIO_ID
        ? {
            ...scenario,
            workItemIds: [
              ...withoutMoved,
              ...[...ids].filter((id) => !withoutMoved.includes(id)),
            ],
          }
        : { ...scenario, workItemIds: withoutMoved };
    });
  });
}

export async function updateTrackerScenarioNotes(
  sets: TrackerScenarioSets,
  trackerId: string,
  scenarioId: string,
  notes: string,
): Promise<TrackerScenarioSet> {
  const normalizedNotes = notes.trim().slice(0, MAX_SCENARIO_NOTES_LENGTH);
  return await mutateScenarioSet(sets, trackerId, (scenarios) =>
    scenarios.map((scenario) =>
      scenario.scenarioId === scenarioId
        ? { ...scenario, notes: normalizedNotes }
        : scenario,
    ),
  );
}

export async function linkTrackerScenarioIssue(
  sets: TrackerScenarioSets,
  trackerId: string,
  scenarioId: string,
  issueUrl: string | null,
): Promise<TrackerScenarioSet> {
  const normalizedUrl = issueUrl ? validateIssueUrl(issueUrl) : undefined;
  return await mutateScenarioSet(sets, trackerId, (scenarios) =>
    scenarios.map((scenario) =>
      scenario.scenarioId === scenarioId
        ? {
            ...scenario,
            issueUrl: normalizedUrl,
          }
        : scenario,
    ),
  );
}

export async function deleteTrackerScenario(
  sets: TrackerScenarioSets,
  trackerId: string,
  scenarioId: string,
): Promise<TrackerScenarioSet> {
  if (scenarioId === MISC_SCENARIO_ID) {
    throw new Error("The Misc scenario cannot be deleted.");
  }
  return await mutateScenarioSet(sets, trackerId, (scenarios) =>
    scenarios.filter((scenario) => scenario.scenarioId !== scenarioId),
  );
}
