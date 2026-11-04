import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ListTree } from "lucide-react";
import { toast } from "sonner";
import { TagChip } from "@/components/tag-chips";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/errors";
import { normalizeTag, type ResolvedTag } from "@/lib/tag-config";
import {
  createTracker,
  MAX_TRACKER_DESCRIPTION_LENGTH,
  MAX_TRACKER_NAME_LENGTH,
  TRACKERS_QUERY_KEY,
  updateTrackerDetails,
  validateTracker,
  type TrackerItem,
} from "@/lib/trackers";
import { trackersCollection } from "@/storage/collections";
import { useAppCollection } from "@/storage/hooks";

export function TrackerTagBadge({ tag }: { tag: ResolvedTag }) {
  return tag.marker === "none" ? (
    <span className="border border-[#808080] bg-[#efefef] px-1.5 py-0.5 text-[9px] font-medium">
      {tag.label}
    </span>
  ) : (
    <TagChip tag={tag} />
  );
}

/** Create or edit a tracker: a name, a description and the tags it follows. */
export function TrackerDialog({
  open,
  onOpenChange,
  trackers,
  tags,
  tracker,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackers: readonly TrackerItem[];
  tags: readonly ResolvedTag[];
  tracker?: TrackerItem;
  onSaved: (trackerId: string) => void;
}) {
  const queryClient = useQueryClient();
  const collection = useAppCollection(trackersCollection);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const editing = Boolean(tracker);

  useEffect(() => {
    if (!open) return;
    const registered = new Map(
      tags.map((tag) => [normalizeTag(tag.tag), tag.tag]),
    );
    setName(tracker?.name ?? "");
    setDescription(tracker?.description ?? "");
    setSelectedTags(
      (tracker?.tags ?? []).flatMap((tag) => {
        const registeredTag = registered.get(normalizeTag(tag));
        return registeredTag ? [registeredTag] : [];
      }),
    );
    setValidationError(null);
  }, [open, tags, tracker]);

  const mutation = useMutation({
    mutationFn: (input: {
      name: string;
      description: string;
      tags: string[];
    }) =>
      tracker
        ? updateTrackerDetails(collection, tracker.id, input)
        : createTracker(collection, input),
    onSuccess: (saved) => {
      queryClient.setQueryData<TrackerItem[]>(TRACKERS_QUERY_KEY, (current) =>
        tracker
          ? (current ?? []).map((item) =>
              item.id === saved.id ? saved : item,
            )
          : [...(current ?? []), saved],
      );
      onSaved(saved.id);
      void queryClient.invalidateQueries({ queryKey: TRACKERS_QUERY_KEY });
      toast.success(editing ? "Tracker updated." : "Tracker created.");
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(
        errorText(
          error,
          editing
            ? "The tracker could not be updated."
            : "The tracker could not be created.",
        ),
      ),
  });

  function toggleTag(tag: string, checked: boolean) {
    setSelectedTags((current) =>
      checked
        ? current.includes(tag)
          ? current
          : [...current, tag]
        : current.filter((candidate) => candidate !== tag),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = { name, description, tags: selectedTags };
    const message = validateTracker(next, trackers, tags, tracker?.id);
    if (message) {
      setValidationError(message);
      return;
    }
    setValidationError(null);
    mutation.mutate(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w95-dialog max-h-[min(90vh,760px)] gap-0 overflow-hidden sm:max-w-2xl"
        showCloseButton={false}
      >
        <div className="w95-titlebar">
          <ListTree className="h-4 w-4" />
          <DialogTitle className="text-[12px] font-bold text-white">
            {editing ? "Edit tracker" : "Create tracker"}
          </DialogTitle>
          <button
            type="button"
            className="w95-btn ml-auto h-5 min-w-5 px-1 text-[11px]"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            ×
          </button>
        </div>
        <form className="min-h-0 overflow-y-auto p-3" onSubmit={submit}>
          <DialogHeader className="mb-3 gap-1 text-left">
            <DialogDescription className="text-[11px] text-black">
              Track all work carrying any selected registered tag, including
              resolved and closed items.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label htmlFor="tracker-name" className="text-[11px] font-bold">
                Name
              </Label>
              <Input
                id="tracker-name"
                className="w95-input h-8 rounded-none text-[11px]"
                value={name}
                maxLength={MAX_TRACKER_NAME_LENGTH}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-1">
              <Label
                htmlFor="tracker-description"
                className="text-[11px] font-bold"
              >
                Description
              </Label>
              <Textarea
                id="tracker-description"
                className="w95-input min-h-20 rounded-none text-[11px]"
                value={description}
                maxLength={MAX_TRACKER_DESCRIPTION_LENGTH}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <fieldset className="w95-group min-w-0 p-2">
              <legend className="px-1 text-[11px] font-bold">
                Work item tags
              </legend>
              {tags.length === 0 ? (
                <p className="text-[11px]">
                  No tags are registered yet. Add tags on the Tags tab
                  before {editing ? "editing" : "creating"} a tracker.
                </p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {tags.map((tag) => {
                    const id = `tracker-tag-${tag.key}`;
                    const checked = selectedTags.includes(tag.tag);
                    return (
                      <label
                        key={tag.key}
                        htmlFor={id}
                        className="flex min-w-0 cursor-pointer items-start gap-2 border border-transparent p-1 hover:border-[#808080] hover:bg-[#dfdfdf]"
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={(value) =>
                            toggleTag(tag.tag, value === true)
                          }
                          className="mt-0.5 rounded-none border-black bg-white data-[state=checked]:bg-[#000080]"
                        />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5 font-bold">
                            {tag.label}
                            <TrackerTagBadge tag={tag} />
                          </span>
                          <span className="block break-words text-[10px] text-[#404040]">
                            {tag.tag}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
          </div>

          {(validationError || mutation.isError) && (
            <p className="mt-3 text-[11px] font-bold text-[#a00000]" role="alert">
              {validationError ??
                errorText(
                  mutation.error,
                  editing
                    ? "The tracker could not be updated."
                    : "The tracker could not be created.",
                )}
            </p>
          )}

          <DialogFooter className="mt-4 flex-row justify-end">
            <button
              type="button"
              className="w95-btn h-8 px-4 text-[11px]"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w95-btn h-8 px-4 text-[11px] font-bold"
              disabled={mutation.isPending || tags.length === 0}
            >
              {mutation.isPending
                ? editing
                  ? "Saving…"
                  : "Creating…"
                : editing
                  ? "Save changes"
                  : "Create tracker"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

