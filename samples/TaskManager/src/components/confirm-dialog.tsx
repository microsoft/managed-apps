import { useCallback, useRef, useState, type ReactNode } from "react";
import { Info, TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ConfirmContext,
  type ConfirmFn,
  type ConfirmOptions,
} from "@/hooks/use-confirm";
import { cn } from "@/lib/utils";

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

// Provides the Promise-based confirm() used by `useConfirm` (hooks/use-confirm).
// Rendered once at the app root (App.tsx). Replaces the sandbox-suppressed
// window.confirm with a shadcn AlertDialog.
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const openRef = useRef(false);

  const confirm = useCallback<ConfirmFn>(
    (options) => {
      // Guard against a second confirm() while one is already open — otherwise
      // the first promise's resolver would be orphaned and that await hangs.
      if (openRef.current) return Promise.resolve(false);
      openRef.current = true;
      return new Promise<boolean>((resolve) =>
        setPending({ ...options, resolve }),
      );
    },
    [],
  );

  const settle = (value: boolean) => {
    openRef.current = false;
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        {/* Dressed as a real 95 message box, like every other window in this
            app: `.w95-dialog` frame + title bar + system icon + beveled
            buttons, square and instant (win95.css zeroes the animation on
            `[data-slot="alert-dialog-*"]`, which is also what lets Radix
            unmount it synchronously on close). `.w95-confirm` is the hook for
            the button-metric rules in win95.css — see the note there for why
            `.w95-btn` alone isn't enough on these two.
            Behaviour is untouched: Escape and the × cancel, Radix still focuses
            Cancel on open and traps focus in the window, and every path still
            resolves the caller's promise through settle(). */}
        <AlertDialogContent className="w95-confirm w95-dialog max-w-md gap-0">
          {pending && (
            <>
              {/* Title bar. The caption is the generic window name (95 put the
                  question in the body, not the caption) so a long question can
                  never be truncated away up here. */}
              <div className="w95-titlebar">
                {pending.destructive ? (
                  <TriangleAlert
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-left text-[12px] font-bold text-white">
                  Confirm
                </span>
                <button
                  type="button"
                  className="w95-titlebtn text-[10px] leading-none"
                  onClick={() => settle(false)}
                  aria-label="Cancel"
                >
                  ×
                </button>
              </div>

              {/* Message row — the classic 95 layout: a big system icon at the
                  left, the wording at the right. A destructive prompt gets the
                  hazard triangle, anything else the information icon. */}
              <div className="flex items-start gap-3 px-4 py-4">
                {pending.destructive ? (
                  <TriangleAlert
                    className="h-8 w-8 shrink-0"
                    fill="#ffff00"
                    stroke="#000000"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                ) : (
                  <Info
                    className="h-8 w-8 shrink-0"
                    fill="#000080"
                    stroke="#ffffff"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 space-y-1.5">
                  {/* The question IS the dialog's accessible name, so it stays
                      an AlertDialogTitle even though it reads as body copy. */}
                  <AlertDialogTitle className="text-[12px] font-bold leading-snug text-black">
                    {pending.title}
                  </AlertDialogTitle>
                  {pending.description ? (
                    <AlertDialogDescription className="text-[11px] leading-snug text-[#404040]">
                      {pending.description}
                    </AlertDialogDescription>
                  ) : (
                    // Radix wants a description on an alert dialog; when the
                    // caller didn't give one, keep it for screen readers only.
                    <AlertDialogDescription className="sr-only">
                      Choose {pending.confirmLabel ?? "Confirm"} to continue, or{" "}
                      {pending.cancelLabel ?? "Cancel"} to stop.
                    </AlertDialogDescription>
                  )}
                </div>
              </div>

              {/* Cancel carries the black default ring because Cancel is what
                  Radix focuses and what Enter and Escape do — the safe way out
                  is the default button, exactly as 95 did on a destructive
                  prompt. The action names itself ("Delete", "Promote to top")
                  and, when destructive, repeats the hazard triangle and goes
                  bold, so the two are never mistaken for one another. */}
              <div className="flex flex-wrap items-center justify-center gap-2 px-2 pb-3">
                <AlertDialogCancel
                  onClick={() => settle(false)}
                  className="w95-btn w95-btn--default min-w-[75px] justify-center"
                >
                  {pending.cancelLabel ?? "Cancel"}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => settle(true)}
                  className="w95-btn min-w-[75px] justify-center gap-1.5"
                >
                  {pending.destructive && (
                    <TriangleAlert
                      className="h-3.5 w-3.5 shrink-0"
                      fill="#ffff00"
                      stroke="#000000"
                      aria-hidden="true"
                    />
                  )}
                  <span className={cn(pending.destructive && "font-bold")}>
                    {pending.confirmLabel ?? "Confirm"}
                  </span>
                </AlertDialogAction>
              </div>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
