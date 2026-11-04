/**
 * RETROSPECTIVE tab — a three-column retro board.
 *
 * "What went well?" (green), "What didn't go well?" (red) and "What can we
 * improve?" (teal blue), each a Windows 95 window with its colour carried by
 * the title bar and by the left edge of every card in it.
 *
 * Notes are app-owned data on the storage interface (see lib/retro-notes.ts).
 * With the default local provider they stay in this browser; with a shared
 * provider the whole team sees the same board. Nothing here touches Azure DevOps.
 */

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CloudOff,
  Database,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  StickyNote,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/hooks/use-confirm";
import { errorText } from "@/lib/errors";
import {
  addNote,
  deleteNote,
  deleteNotes,
  listNotes,
  MAX_RETRO_NOTE_LENGTH,
  renameNote,
  RETRO_NOTES_QUERY_KEY,
  type RetroColumnId,
  type RetroDeleteFailure,
  type RetroNoteRecord,
} from "@/lib/retro-notes";
import { retroNotesCollection } from "@/storage/collections";
import { useAppCollection, useInvalidateOnChange } from "@/storage/hooks";

interface ColumnDef {
  id: RetroColumnId;
  title: string;
  /** Title-bar gradient — the two stops the 95 title bar reads from. */
  titleA: string;
  titleB: string;
  /** Left-edge accent on each card in this column. */
  accent: string;
  hint: string;
  icon: ReactNode;
}

const COLUMNS: ColumnDef[] = [
  {
    id: "went-well",
    title: "What went well?",
    titleA: "#0b6b2e",
    titleB: "#3fa45c",
    accent: "border-l-[#0b6b2e]",
    hint: "Keep doing these",
    icon: <ThumbsUp className="h-3 w-3" />,
  },
  {
    id: "went-badly",
    title: "What didn't go well?",
    titleA: "#8a0f0f",
    titleB: "#d24a3d",
    accent: "border-l-[#8a0f0f]",
    hint: "Stop doing these",
    icon: <ThumbsDown className="h-3 w-3" />,
  },
  {
    id: "improve",
    title: "What can we improve?",
    titleA: "#00636e",
    titleB: "#1fa5bd",
    accent: "border-l-[#00636e]",
    hint: "Try these next sprint",
    icon: <Wrench className="h-3 w-3" />,
  },
];

/** What the board is currently able to do. */
type Status = "loading" | "ready" | "unavailable";

interface NoteRow {
  key: string;
  text: string;
  created: string;
}

/** What a "clear the retrospective" run ACTUALLY did. */
interface ClearOutcome {
  kind: "ok" | "warn" | "error";
  message: string;
  failures: RetroDeleteFailure[];
}

function shortTime(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RetroBoard() {
  const collection = useAppCollection(retroNotesCollection);
  useInvalidateOnChange(collection, RETRO_NOTES_QUERY_KEY);
  const queryClient = useQueryClient();
  const notesQuery = useQuery({
    queryKey: RETRO_NOTES_QUERY_KEY,
    queryFn: () => listNotes(collection),
    retry: false,
  });
  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data]);
  const status: Status = notesQuery.isError
    ? "unavailable"
    : notesQuery.isPending
      ? "loading"
      : "ready";

  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<ClearOutcome | null>(null);

  const reload = useCallback(
    () => queryClient.invalidateQueries({ queryKey: RETRO_NOTES_QUERY_KEY }),
    [queryClient],
  );

  const byColumn = useMemo(() => {
    const out: Record<string, RetroNoteRecord[]> = Object.fromEntries(
      COLUMNS.map((c) => [c.id, [] as RetroNoteRecord[]]),
    );
    for (const note of notes) out[note.column]?.push(note);
    return out;
  }, [notes]);

  const runWrite = useCallback(
    async (what: string, write: () => Promise<unknown>) => {
      setBusy(true);
      setWriteError(null);
      try {
        await write();
      } catch (err) {
        setWriteError(`${what}: ${errorText(err, "the change could not be saved.")}`);
      } finally {
        setBusy(false);
        void reload();
      }
    },
    [reload],
  );

  const handleAdd = useCallback(
    (column: RetroColumnId, text: string) =>
      runWrite("That note was not saved", () => addNote(collection, column, text)),
    [collection, runWrite],
  );

  const handleRename = useCallback(
    (id: string, text: string) =>
      runWrite("That edit was not saved", () => renameNote(collection, id, text)),
    [collection, runWrite],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const current = notes.find((n) => n.id === id);
      if (!current) return;
      const ok = await confirm({
        title: "Delete this note?",
        description: `“${current.text}” will be removed from this retrospective. This can't be undone.`,
        confirmLabel: "Delete",
        cancelLabel: "Keep",
        destructive: true,
      });
      if (!ok) return;
      await runWrite("That note was not deleted", () => deleteNote(collection, id));
    },
    [collection, confirm, notes, runWrite],
  );

  /**
   * Delete EVERY note on the board. The count is re-read first, the user
   * confirms, every note is attempted even if some fail, and the board is
   * re-read afterwards so what is on screen is what the store really holds.
   */
  const clearAllNotes = useCallback(async () => {
    if (status !== "ready") return;
    setClearResult(null);
    setClearing(true);
    try {
      let current: RetroNoteRecord[];
      try {
        current = await listNotes(collection);
      } catch (err) {
        setClearResult({
          kind: "error",
          message: `Nothing was deleted. The board could not be read first: ${errorText(err)}`,
          failures: [],
        });
        return;
      }
      if (current.length === 0) {
        setClearResult({ kind: "warn", message: "The board is already empty — nothing was deleted.", failures: [] });
        return;
      }
      const noun = current.length === 1 ? "note" : "notes";
      const ok = await confirm({
        title: `Delete all ${current.length} retrospective ${noun}?`,
        description:
          `This permanently deletes ${current.length} ${noun} in all three columns. ` +
          "It cannot be undone. Use Settings › Export data first if you want a copy.",
        confirmLabel: `Delete all ${current.length}`,
        cancelLabel: "Cancel",
        destructive: true,
      });
      if (!ok) {
        setClearResult({ kind: "warn", message: "Cancelled — nothing was deleted.", failures: [] });
        return;
      }
      const { deleted, failures, requested } = await deleteNotes(collection, current);
      setClearResult(
        failures.length === 0
          ? { kind: "ok", message: `Deleted ${deleted} of ${requested} ${noun}.`, failures: [] }
          : {
              kind: "error",
              message: `Deleted ${deleted} of ${requested} ${noun}. ${failures.length} could not be deleted — running this again retries only what is left.`,
              failures,
            },
      );
    } finally {
      setClearing(false);
      void reload();
    }
  }, [collection, confirm, reload, status]);

  const total = notes.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="w95-panel flex shrink-0 flex-wrap items-center gap-2 px-2 py-2">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center bg-[#000080] text-white">
          <StickyNote className="h-3 w-3" />
        </span>
        <span className="text-[12px] font-bold">Sprint retrospective</span>

        {status === "loading" && (
          <span className="w95-status flex items-center gap-1 text-[11px]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading notes…
          </span>
        )}

        {status === "ready" && (
          <>
            <span className="w95-status text-[11px]">
              {total === 0
                ? "No notes yet — add one to a column to get started."
                : `${total} ${total === 1 ? "note" : "notes"} on this board`}
            </span>
            <span className="ml-auto flex items-center gap-1.5 w95-status text-[11px]">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
              {busy ? "Saving…" : "Saved with this app's data — not to Azure DevOps."}
            </span>
          </>
        )}

        {status === "unavailable" && (
          <>
            <span className="w95-status flex items-center gap-1 text-[11px]">
              <CloudOff className="h-3 w-3" />
              Notes couldn't be loaded
            </span>
            <button type="button" className="ml-auto w95-btn" onClick={() => void reload()}>
              <RefreshCw className="h-3 w-3" />
              Try again
            </button>
          </>
        )}
      </div>

      {writeError && (
        <div className="w95-panel flex shrink-0 items-start gap-2 px-2 py-1.5 text-[11px]">
          <TriangleAlert className="mt-px h-3 w-3 shrink-0 text-[#8a0f0f]" />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{writeError}</span>
          <button type="button" className="w95-btn shrink-0" onClick={() => setWriteError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {status === "unavailable" && (
        <div className="w95-panel shrink-0 px-2 py-2 text-[11px]">
          <p className="font-bold">The retrospective notes could not be read.</p>
          <p className="w95-in mt-1 px-1 py-0.5 font-mono text-[10px] [overflow-wrap:anywhere]">
            {errorText(notesQuery.error, "Storage is unavailable.")}
          </p>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const rows: NoteRow[] =
            status === "ready"
              ? (byColumn[col.id] ?? []).map((n) => ({ key: n.id, text: n.text, created: n.createdAt }))
              : [];
          return (
            <RetroColumn
              key={col.id}
              column={col}
              rows={rows}
              status={status}
              busy={busy || clearing}
              onAdd={(text) => void handleAdd(col.id, text)}
              onRename={(key, text) => void handleRename(key, text)}
              onDelete={(key) => void handleDelete(key)}
            />
          );
        })}
      </div>

      <ClearRetroControl
        status={status}
        total={total}
        clearing={clearing}
        result={clearResult}
        onClear={() => void clearAllNotes()}
      />
    </div>
  );
}

/** The "clear the whole retrospective" control, shown under the board. */
function ClearRetroControl({
  status,
  total,
  clearing,
  result,
  onClear,
}: {
  status: Status;
  total: number;
  clearing: boolean;
  result: ClearOutcome | null;
  onClear: () => void;
}) {
  const titleStyle = {
    "--w95-title-a": "#8a0f0f",
    "--w95-title-b": "#d24a3d",
  } as CSSProperties;

  if (status !== "ready") return null;

  return (
    <section className="w95-window shrink-0">
      <div className="w95-titlebar" style={titleStyle}>
        <ShieldAlert className="h-3.5 w-3.5" />
        <span className="min-w-0 flex-1 truncate">Clear the retrospective</span>
      </div>
      <div className="flex flex-col gap-1.5 p-2 text-[11px]">
        <div className="w95-hazard" aria-hidden="true" />
        <p>
          Deletes <span className="font-bold">every note on this board</span> — all three columns.{" "}
          <span className="font-bold">This is permanent.</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="w95-btn w95-btn--default"
            disabled={clearing || total === 0}
            onClick={onClear}
          >
            {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {clearing
              ? "Deleting…"
              : total === 0
                ? "No notes to clear"
                : `Clear all ${total} ${total === 1 ? "note" : "notes"}…`}
          </button>
          <span className="flex items-center gap-1 text-[10px] text-[#404040]">
            <TriangleAlert className="h-3.5 w-3.5 text-[#808000]" />
            The count is re-read and confirmed before anything is deleted.
          </span>
        </div>

        {result && (
          <>
            <div
              className={cn(
                "w95-status px-2 py-1 text-[11px] [overflow-wrap:anywhere]",
                result.kind === "error" && "font-bold text-[#800000]",
              )}
            >
              {result.message}
            </div>
            {result.failures.length > 0 && (
              <ul className="w95-in max-h-24 space-y-0.5 overflow-y-auto p-1 font-mono text-[10px]">
                {result.failures.slice(0, 8).map((failure, i) => (
                  <li key={`${failure.text}-${i}`} className="[overflow-wrap:anywhere]">
                    “{failure.text}” — {failure.error}
                  </li>
                ))}
                {result.failures.length > 8 && (
                  <li className="font-bold">+{result.failures.length - 8} more, each left in place.</li>
                )}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
function RetroColumn({
  column,
  rows,
  status,
  busy,
  onAdd,
  onRename,
  onDelete,
}: {
  column: ColumnDef;
  rows: NoteRow[];
  status: Status;
  busy: boolean;
  onAdd: (text: string) => void;
  onRename: (key: string, text: string) => void;
  onDelete: (key: string) => void;
}) {
  // Only a reachable store accepts writes. When it is not reachable the column
  // still RENDERS but every control that
  // would imply saving is gone — nothing here may look like it persisted.
  const readOnly = status !== "ready";
  // The composer is an inline field rather than a modal: it opens, takes focus
  // and commits on Enter with no animation, which is how the rest of the app
  // behaves.
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (composing) composerRef.current?.focus();
  }, [composing]);

  const commit = (keepOpen: boolean) => {
    const text = draft.trim();
    if (text) onAdd(text);
    setDraft("");
    if (!keepOpen) setComposing(false);
  };

  // The 95 title bar reads its gradient from these two custom properties, so a
  // per-column colour needs no extra stylesheet rule.
  const titleStyle = {
    "--w95-title-a": column.titleA,
    "--w95-title-b": column.titleB,
  } as CSSProperties;

  return (
    <section className="w95-window flex min-h-[12rem] flex-col overflow-hidden">
      <div className="w95-titlebar" style={titleStyle}>
        {column.icon}
        <span className="min-w-0 flex-1 truncate">{column.title}</span>
        <span className="ml-auto shrink-0 whitespace-nowrap px-1 text-[10px] font-normal">
          {rows.length} {rows.length === 1 ? "note" : "notes"}
        </span>
      </div>

      <div className="mt-[3px] flex shrink-0 items-center gap-2 px-1">
        {readOnly ? (
          // No "Add note" at all when nothing can be saved — a disabled-looking
          // button still invites a click and implies the feature is merely
          // switched off, rather than the store being absent.
          <span className="truncate text-[10px] font-bold text-[#8a0f0f]">
            {status === "loading" ? "Loading…" : "Unavailable"}
          </span>
        ) : (
          <button
            type="button"
            className="w95-btn"
            disabled={busy}
            onClick={() => {
              setComposing(true);
              composerRef.current?.focus();
            }}
          >
            <Plus className="h-3 w-3" />
            Add note
          </button>
        )}
        <span className="truncate text-[10px] text-[#404040]">{column.hint}</span>
      </div>

      <div className="w95-in mt-[3px] min-h-0 flex-1 space-y-1 overflow-y-auto p-1">
        {composing && !readOnly && (
          <div className="flex items-center gap-1 p-0.5">
            <Input
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a note, press Enter…"
              aria-label={`New note for ${column.title}`}
              maxLength={MAX_RETRO_NOTE_LENGTH}
              className="w95-search-input h-[22px] text-[11px]"
              onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit(true); // stays open, so several notes go in quickly
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft("");
                  setComposing(false);
                }
              }}
            />
            <button
              type="button"
              className="w95-btn w95-iconbtn"
              aria-label="Add this note"
              title="Add this note"
              onClick={() => commit(true)}
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="w95-btn w95-iconbtn"
              aria-label="Close the note box"
              title="Close the note box"
              onClick={() => {
                setDraft("");
                setComposing(false);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {rows.length === 0 && !composing ? (
          <div className="flex min-h-[84px] flex-col items-center justify-center gap-1 px-2 text-center text-[#404040]">
            {status === "loading" ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-[11px]">Loading…</span>
              </>
            ) : readOnly ? (
              <>
                <CloudOff className="h-5 w-5" />
                <span className="text-[11px]">Notes unavailable</span>
              </>
            ) : (
              <>
                <StickyNote className="h-5 w-5" />
                <span className="text-[11px]">Nothing noted yet</span>
                <button
                  type="button"
                  className="w95-btn"
                  disabled={busy}
                  onClick={() => setComposing(true)}
                >
                  <Plus className="h-3 w-3" />
                  Add the first note
                </button>
              </>
            )}
          </div>
        ) : (
          rows.map((row, i) => (
            <RetroNote
              key={row.key}
              row={row}
              accent={column.accent}
              zebra={i % 2 === 1}
              readOnly={readOnly}
              busy={busy}
              onRename={(text) => onRename(row.key, text)}
              onDelete={() => onDelete(row.key)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function RetroNote({
  row,
  accent,
  zebra,
  readOnly,
  busy,
  onRename,
  onDelete,
}: {
  row: NoteRow;
  accent: string;
  zebra: boolean;
  readOnly: boolean;
  busy: boolean;
  onRename: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = () => {
    onRename(draft);
    setEditing(false);
  };

  const when = shortTime(row.created);

  return (
    <div
      className={cn(
        // Same card chrome as a work item on the board, so the two boards read
        // as one app: raised 95 bevel, zebra striping, coloured left edge.
        "w95-item flex items-start gap-1 border-l-4 px-1.5 py-1",
        zebra ? "bg-[#e4e1dc]" : "bg-[#c0c0c0]",
        "shadow-[inset_-1px_-1px_0_0_#0a0a0a,inset_1px_1px_0_0_#ffffff,inset_-2px_-2px_0_0_#808080,inset_2px_2px_0_0_#dfdfdf]",
        accent,
      )}
    >
      <div className="min-w-0 flex-1">
        {editing && !readOnly ? (
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Edit note"
            maxLength={MAX_RETRO_NOTE_LENGTH}
            className="w95-search-input h-[22px] text-[11px]"
            onBlur={save}
            onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(row.text);
                setEditing(false);
              }
            }}
          />
        ) : readOnly ? (
          // Plain text, not a button: there is nothing to click through to,
          // and an edit affordance here would imply the change could be saved.
          <p className="block w-full break-words text-left text-[11px] font-bold leading-tight [overflow-wrap:anywhere]">
            {row.text}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(row.text);
              setEditing(true);
            }}
            title="Click to edit this note"
            className="block w-full break-words text-left text-[11px] font-bold leading-tight [overflow-wrap:anywhere]"
          >
            {row.text}
          </button>
        )}
        {when && !editing && (
          <p className="mt-0.5 text-[9px] leading-none text-[#404040]">{when}</p>
        )}
      </div>
      {!editing && !readOnly && (
        <>
          <button
            type="button"
            className="w95-btn w95-iconbtn mt-px"
            aria-label={`Edit note: ${row.text}`}
            title="Edit this note"
            disabled={busy}
            onClick={() => {
              setDraft(row.text);
              setEditing(true);
            }}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="w95-btn w95-iconbtn mt-px"
            aria-label={`Delete note: ${row.text}`}
            title="Delete this note"
            disabled={busy}
            onClick={onDelete}
          >
            <X className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  );
}
