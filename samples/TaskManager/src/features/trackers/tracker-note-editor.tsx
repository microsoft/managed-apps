import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  MAX_WORK_ITEM_NOTE_LENGTH,
  saveWorkItemNote,
  WORK_ITEM_NOTES_QUERY_KEY,
  type WorkItemNoteRecord,
  type WorkItemNotes,
} from "@/lib/work-item-notes";

/** Autosaving free-text note for one work item (stored in `workItemNotes`). */
type NoteSaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

export function TrackerNoteEditor({
  extension,
  notes,
  workItemId,
  workItemTitle,
  onDraftChange,
}: {
  extension?: WorkItemNoteRecord;
  workItemId: string;
  workItemTitle: string;
  onDraftChange?: (note: string) => void;
  notes: WorkItemNotes;
}) {
  const queryClient = useQueryClient();
  const savedNote = extension?.note ?? "";
  const [draft, setDraft] = useState(savedNote);
  const [saveState, setSaveState] = useState<NoteSaveState>("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(savedNote);
  const savedRef = useRef(savedNote);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const queuedRef = useRef<string | null>(null);
  const mutation = useMutation({
    mutationFn: (note: string) =>
      saveWorkItemNote(notes, workItemId, note),
  });

  useEffect(() => {
    const wasClean = draftRef.current.trim() === savedRef.current;
    savedRef.current = savedNote;
    if (wasClean) {
      draftRef.current = savedNote;
      setDraft(savedNote);
    }
  }, [savedNote, workItemId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const flushNote = useCallback(
    async (nextDraft: string) => {
      queuedRef.current = nextDraft;
      if (savingRef.current) return;
      savingRef.current = true;

      try {
        while (queuedRef.current !== null) {
          const pending = queuedRef.current;
          queuedRef.current = null;
          if (pending.trim() === savedRef.current) continue;
          setSaveState("saving");

          let updated: WorkItemNoteRecord;
          try {
            updated = await mutation.mutateAsync(pending);
          } catch (error) {
            setSaveState("error");
            toast.error("Couldn’t save the tracker note.", {
              description: errorText(
                error,
                "The note could not be saved.",
              ),
            });
            return;
          }

          const persisted = updated.note;
          savedRef.current = persisted;
          if (draftRef.current.trim() === persisted) {
            draftRef.current = persisted;
            setDraft(persisted);
          }
          queryClient.setQueriesData<WorkItemNoteRecord[]>(
            { queryKey: WORK_ITEM_NOTES_QUERY_KEY },
            (current) =>
              current
                ? [
                    ...current.filter((item) => item.id !== updated.id),
                    updated,
                  ]
                : current,
          );
          if (draftRef.current.trim() !== persisted) {
            queuedRef.current = draftRef.current;
          }
        }
        setSaveState("saved");
        void queryClient.invalidateQueries({
          queryKey: WORK_ITEM_NOTES_QUERY_KEY,
        });
      } finally {
        savingRef.current = false;
      }
    },
    [mutation, queryClient],
  );

  function scheduleSave(value: string) {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushNote(value);
    }, 2_000);
  }

  function saveImmediately() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void flushNote(draftRef.current);
  }

  return (
    <div className="min-w-64">
      <Textarea
        ref={textareaRef}
        value={draft}
        maxLength={MAX_WORK_ITEM_NOTE_LENGTH}
        rows={1}
        className="w95-in min-h-5 resize-none overflow-hidden rounded-none bg-white px-1.5 py-0.5 text-[10px] leading-tight"
        aria-label={`Notes for ${workItemTitle}`}
        onChange={(event) => {
          const value = event.target.value;
          draftRef.current = value;
          setDraft(value);
          onDraftChange?.(value);
          setSaveState("unsaved");
          scheduleSave(value);
        }}
        onBlur={saveImmediately}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            saveImmediately();
          }
        }}
      />
      <span
        className={cn(
          "mt-0.5 block min-h-2 text-[8px] leading-none",
          saveState === "error"
            ? "font-bold text-[#a00000]"
            : "text-[#606060]",
        )}
        aria-live="polite"
      >
        {saveState === "unsaved"
          ? "Autosaves after 2 seconds"
          : saveState === "saving"
            ? "Saving..."
            : saveState === "saved"
              ? "Saved"
              : saveState === "error"
                ? "Save failed — keep typing or click away to retry"
                : ""}
      </span>
    </div>
  );
}

