import { z } from "zod";
import type { CollectionDefinition } from "./core";

/**
 * Every collection this app stores, with its zod schema. The schema is the single
 * source of truth for the record shape: TypeScript types, runtime validation on
 * every read and write, and (via `npm run storage:describe`) the column list a
 * shared backend needs. Provider-owned metadata (`id`, `version`, `createdAt`,
 * `updatedAt`) is added by the storage layer and is not part of these schemas.
 */

export const RETRO_COLUMN_IDS = ["went-well", "went-badly", "improve"] as const;
export type RetroColumnId = (typeof RETRO_COLUMN_IDS)[number];
export const MAX_RETRO_NOTE_LENGTH = 500;

export const retroNoteSchema = z.object({
  text: z.string().trim().min(1).max(MAX_RETRO_NOTE_LENGTH),
  column: z.enum(RETRO_COLUMN_IDS),
});
export type RetroNote = z.infer<typeof retroNoteSchema>;

export const MARKER_STYLE_IDS = [
  "none",
  "chip-navy",
  "chip-teal",
  "chip-olive",
  "chip-maroon",
  "chip-rainbow",
  "icon-flame",
  "icon-repair",
] as const;
export type MarkerStyleId = (typeof MARKER_STYLE_IDS)[number];
export const MAX_TAG_LENGTH = 400;
export const MAX_TAG_LABEL_LENGTH = 60;
export const MAX_TAG_DESCRIPTION_LENGTH = 500;

export const tagConfigSchema = z.object({
  /** The exact Azure DevOps [System.Tags] value. */
  tag: z.string().trim().min(1).max(MAX_TAG_LENGTH),
  label: z.string().trim().min(1).max(MAX_TAG_LABEL_LENGTH),
  description: z.string().max(MAX_TAG_DESCRIPTION_LENGTH).default(""),
  marker: z.enum(MARKER_STYLE_IDS).default("none"),
});
export type TagConfig = z.infer<typeof tagConfigSchema>;

export const MAX_TRACKER_NAME_LENGTH = 100;
export const MAX_TRACKER_DESCRIPTION_LENGTH = 1_000;
export const MAX_TRACKER_TAGS = 50;
export const MAX_TRACKER_ROW_GROUPS = 200;
export const MAX_TRACKER_GROUP_CHILDREN = 49;
export const MAX_TRACKER_GROUP_TITLE_LENGTH = 160;

export const trackerRowGroupSchema = z.object({
  groupId: z.string().min(1),
  title: z.string().max(MAX_TRACKER_GROUP_TITLE_LENGTH),
  masterWorkItemId: z.string().min(1),
  childWorkItemIds: z.array(z.string()).max(MAX_TRACKER_GROUP_CHILDREN),
  createdAt: z.string(),
});
export type TrackerRowGroup = z.infer<typeof trackerRowGroupSchema>;

export const trackerSchema = z.object({
  name: z.string().trim().min(1).max(MAX_TRACKER_NAME_LENGTH),
  description: z.string().max(MAX_TRACKER_DESCRIPTION_LENGTH),
  tags: z.array(z.string()).max(MAX_TRACKER_TAGS),
  rowGroups: z.array(trackerRowGroupSchema).max(MAX_TRACKER_ROW_GROUPS).default([]),
});
export type Tracker = z.infer<typeof trackerSchema>;

export const MISC_SCENARIO_ID = "misc";
export const MAX_SCENARIO_NAME_LENGTH = 256;
export const MAX_SCENARIO_NOTES_LENGTH = 4_000;
export const MAX_SCENARIOS = 200;
export const MAX_SCENARIO_WORK_ITEMS = 500;

export const trackerScenarioSchema = z.object({
  scenarioId: z.string().min(1),
  name: z.string().min(1).max(MAX_SCENARIO_NAME_LENGTH),
  notes: z.string().max(MAX_SCENARIO_NOTES_LENGTH).default(""),
  workItemIds: z.array(z.string()).max(MAX_SCENARIO_WORK_ITEMS).default([]),
  /** Optional link to an issue in the configured issue tracker. */
  issueUrl: z.string().optional(),
  createdAt: z.string(),
});
export type TrackerScenario = z.infer<typeof trackerScenarioSchema>;

/** One record per tracker; the record id is the tracker id. */
export const trackerScenarioSetSchema = z.object({
  trackerId: z.string().min(1),
  scenarios: z.array(trackerScenarioSchema).max(MAX_SCENARIOS),
});
export type TrackerScenarioSet = z.infer<typeof trackerScenarioSetSchema>;

export const MAX_WORK_ITEM_NOTE_LENGTH = 4_000;

/** App-owned annotation on an Azure DevOps work item; the record id is the work item id. */
export const workItemNoteSchema = z.object({
  workItemId: z.string().trim().min(1),
  note: z.string().max(MAX_WORK_ITEM_NOTE_LENGTH),
});
export type WorkItemNote = z.infer<typeof workItemNoteSchema>;

export const FEEDBACK_KINDS = ["feature", "bug"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const MAX_FEEDBACK_TITLE_LENGTH = 160;
export const MAX_FEEDBACK_DESCRIPTION_LENGTH = 4_000;
export const MAX_FEEDBACK_CLOSING_NOTES_LENGTH = 4_000;

export const feedbackSchema = z.object({
  title: z.string().trim().min(1).max(MAX_FEEDBACK_TITLE_LENGTH),
  kind: z.enum(FEEDBACK_KINDS),
  description: z.string().max(MAX_FEEDBACK_DESCRIPTION_LENGTH),
  status: z.enum(["open", "closed"]),
  creatorName: z.string().max(256).default(""),
  closedAt: z.string().optional(),
  closingNotes: z.string().max(MAX_FEEDBACK_CLOSING_NOTES_LENGTH).optional(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

export const retroNotesCollection: CollectionDefinition<RetroNote> = {
  name: "retroNotes",
  schema: retroNoteSchema,
  description: "Sticky notes on the retrospective board.",
};

export const tagConfigCollection: CollectionDefinition<TagConfig> = {
  name: "tagConfig",
  schema: tagConfigSchema,
  description: "Azure DevOps tags the app knows about, with their labels and card markers.",
};

export const trackersCollection: CollectionDefinition<Tracker> = {
  name: "trackers",
  schema: trackerSchema,
  description: "Saved tag-based views over Azure DevOps work, with combined rows.",
};

export const trackerScenariosCollection: CollectionDefinition<TrackerScenarioSet> = {
  name: "trackerScenarios",
  schema: trackerScenarioSetSchema,
  description: "Scenario groupings for a tracker. Record id = tracker id.",
};

export const workItemNotesCollection: CollectionDefinition<WorkItemNote> = {
  name: "workItemNotes",
  schema: workItemNoteSchema,
  description: "Free-text notes attached to Azure DevOps work items. Record id = work item id.",
};

export const feedbackCollection: CollectionDefinition<Feedback> = {
  name: "feedback",
  schema: feedbackSchema,
  description: "Feature requests and bug reports about this app.",
};

export const allCollections = [
  retroNotesCollection,
  tagConfigCollection,
  trackersCollection,
  trackerScenariosCollection,
  workItemNotesCollection,
  feedbackCollection,
] as CollectionDefinition<unknown>[];

/** Key/value namespaces used for preferences and UI state. */
export const KV_NAMESPACES = {
  settings: "settings",
  ui: "ui",
} as const;
