import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bug,
  CheckCircle2,
  CloudOff,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Send,
  UserRound,
  X,
} from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCurrentUser } from "@/lib/current-user";
import { errorText } from "@/lib/errors";
import { feedbackCollection } from "@/storage/collections";
import { useAppCollection, useInvalidateOnChange } from "@/storage/hooks";
import {
  FEEDBACK_QUERY_KEY,
  MAX_FEEDBACK_CLOSING_NOTES_LENGTH,
  MAX_FEEDBACK_DESCRIPTION_LENGTH,
  MAX_FEEDBACK_TITLE_LENGTH,
  closeFeedback,
  createFeedback,
  listFeedback,
  type FeedbackItem,
  type FeedbackKind,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";

function submittedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FeedbackRow({
  item,
  canClose,
  busy,
  disabled,
  onClose,
}: {
  item: FeedbackItem;
  canClose: boolean;
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
}) {
  const closed = item.status === "closed";
  return (
    <article
      className={cn(
        "w95-out p-[3px]",
        closed && "w95-closed-feedback text-[#707070]",
      )}
    >
      <div className="flex flex-wrap items-start gap-2 px-2 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "px-1.5 py-0.5 text-[10px] font-bold text-white",
                closed ? "bg-[#808080]" : "bg-[#000080]",
              )}
            >
              {closed ? "Closed" : "Open"}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold text-white",
                item.kind === "bug" ? "bg-[#800000]" : "bg-[#008080]",
              )}
            >
              {item.kind === "bug" ? (
                <Bug className="h-2.5 w-2.5" />
              ) : (
                <Lightbulb className="h-2.5 w-2.5" />
              )}
              {item.kind === "bug" ? "Bug" : "Feature"}
            </span>
            <h3 className="min-w-0 break-words text-[12px] font-bold">
              {item.title}
            </h3>
          </div>
          <div className={cn("mt-2 grid gap-2", closed && "sm:grid-cols-2")}>
            <section className="w95-in min-w-0 px-2 py-1.5">
              <h4 className="text-[10px] font-bold">Description</h4>
              <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed">
                {item.description}
              </p>
            </section>
            {closed && (
              <section className="w95-in min-w-0 px-2 py-1.5">
                <h4 className="text-[10px] font-bold">Closing notes</h4>
                <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed">
                  {item.closingNotes || "No closing notes were recorded."}
                </p>
              </section>
            )}
          </div>
          <p
            className={cn(
              "mt-2 flex flex-wrap items-center gap-x-1 text-[10px]",
              closed ? "text-[#808080]" : "text-[#404040]",
            )}
          >
            <UserRound className="h-3 w-3" />
            <span>{item.creatorName || "Someone"}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={item.createdAt}>{submittedAt(item.createdAt)}</time>
            {closed && item.closedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>Closed {submittedAt(item.closedAt)}</span>
              </>
            )}
          </p>
        </div>
        {canClose && (
          <button
            type="button"
            className="w95-btn shrink-0"
            onClick={onClose}
            disabled={disabled}
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            Close
          </button>
        )}
      </div>
    </article>
  );
}

export function FeedbackPanel() {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FeedbackKind>("feature");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [closingItem, setClosingItem] = useState<FeedbackItem | null>(null);
  const [closingNotes, setClosingNotes] = useState("");
  const [closeFormError, setCloseFormError] = useState<string | null>(null);
  const currentUser = useCurrentUser(true);
  const queryClient = useQueryClient();
  const collection = useAppCollection(feedbackCollection);
  useInvalidateOnChange(collection, FEEDBACK_QUERY_KEY);

  const query = useQuery({
    queryKey: FEEDBACK_QUERY_KEY,
    queryFn: () => listFeedback(collection),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: FEEDBACK_QUERY_KEY });

  const submitMutation = useMutation({
    mutationFn: (input: Parameters<typeof createFeedback>[1]) =>
      createFeedback(collection, input),
    onSuccess: () => {
      setName("");
      setKind("feature");
      setDescription("");
      setFormError(null);
      setWriteError(null);
      setFormOpen(false);
      void invalidate();
    },
    onError: (error) => {
      setWriteError(`That request was not submitted: ${errorText(error)}`);
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({
      item,
      notes,
    }: {
      item: FeedbackItem;
      notes: string;
    }) => closeFeedback(collection, item.id, notes),
    onSuccess: () => {
      setWriteError(null);
      setClosingItem(null);
      setClosingNotes("");
      setCloseFormError(null);
      void invalidate();
    },
    onError: (error) => {
      const message = `That request was not closed: ${errorText(error)}`;
      setWriteError(message);
      setCloseFormError(message);
    },
  });

  const busy = submitMutation.isPending || closeMutation.isPending;
  const canSubmit = true;
  const openItems = query.data?.filter((item) => item.status === "open") ?? [];
  const closedItems = query.data?.filter((item) => item.status === "closed") ?? [];

  function validate(): string | null {
    const title = name.trim();
    const details = description.trim();
    if (!title) return "Enter a short title for this request.";
    if (title.length > MAX_FEEDBACK_TITLE_LENGTH) {
      return `Keep the title to ${MAX_FEEDBACK_TITLE_LENGTH} characters or fewer.`;
    }
    if (!details) return "Describe the change or problem.";
    if (details.length > MAX_FEEDBACK_DESCRIPTION_LENGTH) {
      return `Keep the description to ${MAX_FEEDBACK_DESCRIPTION_LENGTH.toLocaleString()} characters or fewer.`;
    }
    return null;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWriteError(null);
    const error = validate();
    setFormError(error);
    if (error) return;
    submitMutation.mutate({
      title: name,
      kind,
      description,
      creatorName: currentUser?.displayName ?? "",
    });
  }

  function close(item: FeedbackItem) {
    setClosingItem(item);
    setClosingNotes("");
    setCloseFormError(null);
  }

  function submitClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!closingItem) return;
    const notes = closingNotes.trim();
    if (!notes) {
      setCloseFormError("Add closing notes before closing this request.");
      return;
    }
    if (notes.length > MAX_FEEDBACK_CLOSING_NOTES_LENGTH) {
      setCloseFormError(
        `Keep closing notes to ${MAX_FEEDBACK_CLOSING_NOTES_LENGTH.toLocaleString()} characters or fewer.`,
      );
      return;
    }
    setWriteError(null);
    setCloseFormError(null);
    closeMutation.mutate({ item: closingItem, notes });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="w95-panel flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 text-[11px]">
        <span className="flex items-center gap-1 font-bold">
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Feedback
        </span>
        <span className="text-[#404040]">
          Suggest a feature or report a bug for this app
        </span>
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            className="w95-btn"
            onClick={() => void query.refetch()}
            disabled={query.isFetching || busy}
          >
            {query.isFetching ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Refresh
          </button>
          <button
            type="button"
            className={cn("w95-btn", formOpen && "w95-btn--on")}
            onClick={() => {
              setFormOpen((open) => !open);
              setFormError(null);
            }}
            disabled={busy}
            aria-expanded={formOpen}
          >
            {formOpen ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {formOpen ? "Cancel" : "New request"}
          </button>
        </span>
      </div>

      {formOpen && (
        <form
          className="w95-panel grid shrink-0 gap-2 px-3 py-2 text-[11px]"
          onSubmit={submit}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="pl-2 font-bold">New request</span>
            <span className="text-[#404040]">
              Submitted as{" "}
              {currentUser ? currentUser.displayName : "you"}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="grid min-w-0 gap-1">
              <span className="pl-2 font-bold">Title</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={MAX_FEEDBACK_TITLE_LENGTH}
                placeholder="A short, specific summary"
                disabled={busy}
              />
            </label>
            <fieldset className="grid content-start gap-1">
              <legend className="font-bold">Type</legend>
              <div className="flex gap-1">
                <button
                  type="button"
                  className={cn("w95-btn", kind === "feature" && "w95-btn--on")}
                  onClick={() => setKind("feature")}
                  aria-pressed={kind === "feature"}
                  disabled={busy}
                >
                  <Lightbulb className="h-3 w-3" /> Feature
                </button>
                <button
                  type="button"
                  className={cn("w95-btn", kind === "bug" && "w95-btn--on")}
                  onClick={() => setKind("bug")}
                  aria-pressed={kind === "bug"}
                  disabled={busy}
                >
                  <Bug className="h-3 w-3" /> Bug
                </button>
              </div>
            </fieldset>
          </div>
          <label className="grid gap-1">
            <span className="pl-2 font-bold">Description</span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={MAX_FEEDBACK_DESCRIPTION_LENGTH}
              rows={3}
              placeholder="What should change, or what happened instead of what you expected?"
              disabled={busy}
            />
          </label>
          {formError && (
            <p className="w95-status font-bold text-[#a80000]" role="alert">
              {formError}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#404040]">
              {description.length.toLocaleString()} /{" "}
              {MAX_FEEDBACK_DESCRIPTION_LENGTH.toLocaleString()} characters
            </span>
            <button
              type="submit"
              className="w95-btn w95-btn--default"
              disabled={!canSubmit || busy}
            >
              {submitMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              {submitMutation.isPending ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </form>
      )}

      {writeError && (
        <div
          className="w95-status shrink-0 font-bold text-[#a80000]"
          role="alert"
        >
          {writeError}
        </div>
      )}

      <div className="w95-in min-h-0 flex-1 overflow-y-auto p-2">
        {query.isPending ? (
          <LoadingState rows={5} />
        ) : query.isError ? (
          <ErrorState
            title="Feedback could not be loaded"
            description={errorText(query.error)}
            action={
              <button
                type="button"
                className="w95-btn"
                onClick={() => void query.refetch()}
              >
                <CloudOff className="h-3 w-3" /> Try again
              </button>
            }
          />
        ) : query.data.length === 0 ? (
          <EmptyState
            icon={MessageSquarePlus}
            title="No active feedback"
            description="Start the list with a feature request or bug report."
            action={
              <button
                type="button"
                className="w95-btn"
                onClick={() => setFormOpen(true)}
              >
                <Plus className="h-3 w-3" /> New request
              </button>
            }
          />
        ) : (
          <div className="grid items-start gap-2 xl:grid-cols-2">
            <section className="w95-panel min-w-0 p-2">
              <h2 className="mb-2 flex items-center gap-1 border-b border-[#808080] pb-1 pl-2 text-[11px] font-bold">
                Active
                <span className="w95-status ml-auto">{openItems.length}</span>
              </h2>
              {openItems.length === 0 ? (
                <p className="px-1 py-2 text-[10px] text-[#404040]">
                  No active feedback.
                </p>
              ) : (
                <div className="space-y-2">
                  {openItems.map((item) => (
                    <FeedbackRow
                      key={item.id}
                      item={item}
                      canClose
                      busy={
                        closeMutation.isPending &&
                        closeMutation.variables?.item.id === item.id
                      }
                      disabled={busy}
                      onClose={() => void close(item)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="w95-panel min-w-0 p-2">
              <h2 className="mb-2 flex items-center gap-1 border-b border-[#808080] pb-1 pl-2 text-[11px] font-bold">
                Closed
                <span className="w95-status ml-auto">{closedItems.length}</span>
              </h2>
              {closedItems.length === 0 ? (
                <p className="px-1 py-2 text-[10px] text-[#404040]">
                  No closed feedback yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {closedItems.map((item) => (
                    <FeedbackRow
                      key={item.id}
                      item={item}
                      canClose={false}
                      busy={false}
                      disabled
                      onClose={() => undefined}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <div className="w95-status shrink-0">
        {query.data
          ? `${openItems.length} active · ${closedItems.length} closed · newest first`
          : "Feedback is saved with this app's data."}
      </div>

      <Dialog
        open={closingItem !== null}
        onOpenChange={(open) => {
          if (!open && !closeMutation.isPending) {
            setClosingItem(null);
            setClosingNotes("");
            setCloseFormError(null);
          }
        }}
      >
        <DialogContent
          className="w95-dialog max-w-xl gap-0"
          showCloseButton={false}
        >
          {closingItem && (
            <form onSubmit={submitClose}>
              <DialogHeader className="space-y-0">
                <div className="w95-titlebar">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <DialogTitle className="min-w-0 flex-1 truncate text-left text-[12px] font-bold text-white">
                    Close feedback
                  </DialogTitle>
                  <button
                    type="button"
                    className="w95-titlebtn text-[10px] leading-none"
                    onClick={() => setClosingItem(null)}
                    disabled={closeMutation.isPending}
                    aria-label="Cancel closing feedback"
                  >
                    ×
                  </button>
                </div>
                <DialogDescription className="px-3 pt-3 text-left text-[11px] text-black">
                  Close “{closingItem.title}” and record why it was closed.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-1 px-3 py-3">
                <label htmlFor="feedback-closing-notes" className="font-bold">
                  Closing notes
                </label>
                <Textarea
                  id="feedback-closing-notes"
                  value={closingNotes}
                  onChange={(event) => {
                    setClosingNotes(event.target.value);
                    setCloseFormError(null);
                  }}
                  maxLength={MAX_FEEDBACK_CLOSING_NOTES_LENGTH}
                  rows={5}
                  placeholder="Explain the outcome or why this request is being closed."
                  disabled={closeMutation.isPending}
                  autoFocus
                />
                <div className="flex items-start justify-between gap-2 text-[10px]">
                  <span className="font-bold text-[#a80000]" role="alert">
                    {closeFormError}
                  </span>
                  <span className="ml-auto text-[#404040]">
                    {closingNotes.length.toLocaleString()} /{" "}
                    {MAX_FEEDBACK_CLOSING_NOTES_LENGTH.toLocaleString()}
                  </span>
                </div>
              </div>
              <DialogFooter className="gap-2 px-3 pb-3">
                <button
                  type="button"
                  className="w95-btn"
                  onClick={() => setClosingItem(null)}
                  disabled={closeMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={cn(
                    "w95-btn",
                    closingNotes.trim() && "w95-btn--default",
                  )}
                  disabled={closeMutation.isPending || !closingNotes.trim()}
                >
                  {closeMutation.isPending && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  {closeMutation.isPending ? "Closing…" : "Close request"}
                </button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
