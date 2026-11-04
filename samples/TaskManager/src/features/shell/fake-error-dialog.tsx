import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OctagonX, X } from "lucide-react";
import type { FakeError } from "@/features/shell/fake-errors";


/**
 * A deliberately fake, dismissible Windows 95 error box — the payoff for the
 * three window buttons in the title bar. It is pure chrome: it reads no work
 * item, writes nothing to Azure DevOps, and changes no application state beyond
 * its own open/closed flag. OK (or Esc / the × ) dismisses it.
 */
export function FakeErrorDialog({
  error,
  onClose,
}: {
  error: FakeError | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!error} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w95-dialog max-w-sm gap-0">
        {error && (
          <>
            <DialogHeader className="space-y-0">
              <div className="w95-titlebar">
                <OctagonX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <DialogTitle className="min-w-0 flex-1 truncate text-left text-[12px] font-bold text-white">
                  {error.title}
                </DialogTitle>
                <button
                  type="button"
                  className="w95-titlebtn text-[10px] leading-none"
                  onClick={onClose}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <DialogDescription className="sr-only">
                A harmless retro error message. Nothing has actually gone wrong
                and no work item was changed.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-start gap-3 px-4 py-4">
              {/* The classic red stop icon. */}
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#a80000] text-white ring-1 ring-black/50"
                aria-hidden="true"
              >
                <X className="h-5 w-5" strokeWidth={3} />
              </span>
              <div className="min-w-0 space-y-1.5">
                <p className="text-[12px] leading-snug">{error.message}</p>
                {error.detail && (
                  <p className="text-[11px] leading-snug text-[#404040]">
                    {error.detail}
                  </p>
                )}
                <p className="text-[10px] italic text-[#404040]">
                  (Just for fun — nothing is wrong and no work item was touched.)
                </p>
              </div>
            </div>

            <DialogFooter className="justify-center gap-2 px-2 pb-3 sm:justify-center">
              <button
                type="button"
                className="w95-btn w95-btn--default min-w-[75px] justify-center"
                onClick={onClose}
                autoFocus
              >
                OK
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
