import {
  FEEDBACK_KINDS,
  MAX_FEEDBACK_CLOSING_NOTES_LENGTH,
  MAX_FEEDBACK_DESCRIPTION_LENGTH,
  MAX_FEEDBACK_TITLE_LENGTH,
  type Feedback,
  type FeedbackKind,
} from "@/storage/collections";
import { withConflictRetry, type Collection, type Stored } from "@/storage/core";

export {
  FEEDBACK_KINDS,
  MAX_FEEDBACK_CLOSING_NOTES_LENGTH,
  MAX_FEEDBACK_DESCRIPTION_LENGTH,
  MAX_FEEDBACK_TITLE_LENGTH,
  type FeedbackKind,
};

/** Feature requests and bug reports about this app (`feedback` collection). */
export const FEEDBACK_QUERY_KEY = ["feedback"] as const;

export type FeedbackItem = Stored<Feedback>;
export type FeedbackStore = Collection<Feedback>;

export interface NewFeedback {
  title: string;
  kind: FeedbackKind;
  description: string;
  creatorName: string;
}

/** Every item, newest first. */
export async function listFeedback(feedback: FeedbackStore): Promise<FeedbackItem[]> {
  return await feedback.listAll({ orderBy: [{ field: "createdAt", direction: "desc" }] });
}

export async function createFeedback(
  feedback: FeedbackStore,
  input: NewFeedback,
): Promise<FeedbackItem> {
  return await feedback.create({
    title: input.title.trim().slice(0, MAX_FEEDBACK_TITLE_LENGTH),
    kind: input.kind,
    description: input.description.trim().slice(0, MAX_FEEDBACK_DESCRIPTION_LENGTH),
    status: "open",
    creatorName: input.creatorName.trim().slice(0, 256),
  });
}

/** Closes an item with notes; re-reads and retries on a concurrent change. */
export async function closeFeedback(
  feedback: FeedbackStore,
  id: string,
  closingNotes: string,
): Promise<FeedbackItem> {
  return await withConflictRetry(async () => {
    const current = await feedback.get(id);
    if (!current) throw new Error("That item was deleted before it could be closed.");
    return await feedback.update(
      id,
      {
        status: "closed",
        closedAt: new Date().toISOString(),
        closingNotes: closingNotes.trim().slice(0, MAX_FEEDBACK_CLOSING_NOTES_LENGTH),
      },
      { ifVersion: current.version },
    );
  });
}

export async function reopenFeedback(feedback: FeedbackStore, id: string): Promise<FeedbackItem> {
  return await withConflictRetry(async () => {
    const current = await feedback.get(id);
    if (!current) throw new Error("That item no longer exists.");
    return await feedback.update(
      id,
      { status: "open", closedAt: undefined, closingNotes: undefined },
      { ifVersion: current.version },
    );
  });
}

export async function deleteFeedback(feedback: FeedbackStore, id: string): Promise<void> {
  await feedback.delete(id);
}
