import { z } from "zod";

/**
 * Typed app configuration, read once from `import.meta.env` (`VITE_*` variables
 * in `.env.local`). Every value has an empty or neutral default; when the
 * Azure DevOps organization or project is missing the app shows a first-run
 * "configure me" screen instead of guessing. See `.env.example`.
 */

const list = (value: string | undefined, fallback: string[] = []): string[] => {
  const items = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : fallback;
};

const text = (value: string | undefined, fallback = ""): string => {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
};

const httpsUrl = z
  .string()
  .refine((value) => {
    if (!value) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an absolute https:// URL");

export const DEFAULT_ETA_MESSAGE_TEMPLATE =
  "Hi {assignee}, {requester} asked for an ETA on {link} ({id}: {title}). " +
  "Could you set a target date on the work item?";

const configSchema = z.object({
  ado: z.object({
    organization: z.string(),
    project: z.string(),
    areaPath: z.string(),
    areas: z.array(z.string()),
    boardWorkItemTypes: z.array(z.string()).min(1),
    storyWorkItemType: z.string().min(1),
    bugWorkItemType: z.string().min(1),
    taskWorkItemType: z.string().min(1),
    excludedStates: z.array(z.string()),
    completedStates: z.array(z.string()).min(1),
  }),
  team: z.object({
    members: z.array(z.string()),
  }),
  links: z.object({
    appUrl: httpsUrl,
    issueTrackerBaseUrl: httpsUrl,
  }),
  teams: z.object({
    etaMessageTemplate: z.string().min(1),
  }),
  storage: z.object({
    provider: z.string().min(1),
    prefix: z.string().regex(/^[a-z0-9][a-z0-9-]*$/i, "use letters, digits and dashes only"),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

export type EnvSource = Record<string, string | boolean | undefined>;

export interface ConfigResult {
  config: AppConfig;
  /** Human-readable problems with the supplied values (invalid ones fall back to defaults). */
  issues: string[];
}

function env(source: EnvSource, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

/** Builds the config from an env-like object. Exported for tests. */
export function parseConfig(source: EnvSource): ConfigResult {
  const candidate: AppConfig = {
    ado: {
      organization: text(env(source, "VITE_ADO_ORG")),
      project: text(env(source, "VITE_ADO_PROJECT")),
      areaPath: text(env(source, "VITE_ADO_AREA_PATH")).replace(/\//g, "\\").replace(/\\+$/, ""),
      areas: list(env(source, "VITE_ADO_AREAS")),
      boardWorkItemTypes: list(env(source, "VITE_ADO_BOARD_WORK_ITEM_TYPES"), ["User Story", "Feature", "Epic"]),
      storyWorkItemType: text(env(source, "VITE_ADO_STORY_TYPE"), "User Story"),
      bugWorkItemType: text(env(source, "VITE_ADO_BUG_TYPE"), "Bug"),
      taskWorkItemType: text(env(source, "VITE_ADO_TASK_TYPE"), "Task"),
      excludedStates: list(env(source, "VITE_ADO_EXCLUDED_STATES"), ["Closed", "Removed"]),
      completedStates: list(env(source, "VITE_ADO_COMPLETED_STATES"), ["Closed"]),
    },
    team: {
      members: list(env(source, "VITE_TEAM_MEMBERS")),
    },
    links: {
      appUrl: text(env(source, "VITE_APP_URL")),
      issueTrackerBaseUrl: text(env(source, "VITE_ISSUE_TRACKER_BASE_URL")).replace(/\/+$/, ""),
    },
    teams: {
      etaMessageTemplate: text(env(source, "VITE_ETA_MESSAGE_TEMPLATE"), DEFAULT_ETA_MESSAGE_TEMPLATE),
    },
    storage: {
      provider: text(env(source, "VITE_STORAGE_PROVIDER"), "local"),
      prefix: text(env(source, "VITE_APP_STORAGE_PREFIX"), "taskmanager"),
    },
  };

  const result = configSchema.safeParse(candidate);
  if (result.success) return { config: result.data, issues: [] };

  const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const config = structuredClone(candidate);
  for (const issue of result.error.issues) {
    const [section, field] = issue.path as [keyof AppConfig, string];
    if (section === "links") (config.links as Record<string, string>)[field] = "";
    if (section === "storage" && field === "prefix") config.storage.prefix = "taskmanager";
  }
  return { config, issues };
}

/** True once the Azure DevOps organization and project are set. */
export function isAdoConfigured(config: Pick<AppConfig, "ado">): boolean {
  return config.ado.organization !== "" && config.ado.project !== "";
}

const parsed = parseConfig(import.meta.env as EnvSource);

/** The app's configuration. Import this instead of reading `import.meta.env`. */
export const appConfig: AppConfig = parsed.config;
export const configIssues: string[] = parsed.issues;
