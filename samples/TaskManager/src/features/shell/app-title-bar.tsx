import { HardDrive, Settings2 } from "lucide-react";
import { Win95WindowIcon } from "@/components/win95-window-icon";
import { randomFakeError, type FakeError } from "@/features/shell/fake-errors";
import { SignedInAs } from "@/features/shell/signed-in-as";
import type { CurrentUser } from "@/lib/current-user";
import { useStorageProvider } from "@/storage/core/hooks";

/** The app's 95 title bar: icon, name, local-mode notice, identity and window buttons. */
export function AppTitleBar({
  user,
  onOpenSettings,
  onFakeError,
}: {
  user: CurrentUser | null;
  onOpenSettings: () => void;
  onFakeError: (error: FakeError) => void;
}) {
  const provider = useStorageProvider();
  return (
    <header className="w95-window z-30 shrink-0">
      <div className="w95-titlebar">
        <Win95WindowIcon className="h-3.5 w-3.5" />
        <h1 className="mr-auto truncate text-[12px] font-bold">Task Manager</h1>
        {!provider.capabilities.shared && (
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 px-1 text-[10px] font-normal text-white"
            title="Retro notes, trackers, tags, notes and feedback are stored in this browser only. Open Settings › Data to export them or learn how to share them."
            onClick={onOpenSettings}
          >
            <HardDrive className="h-3 w-3" /> Local mode: data stays in this browser
          </button>
        )}
        <SignedInAs user={user} />
        <button
          type="button"
          className="w95-titlebtn text-[10px] leading-none"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          <Settings2 className="h-2.5 w-2.5" />
        </button>
        {/* Purely decorative: the classic window buttons pop a period 95 error box. */}
        {[
          { glyph: "_", label: "Minimize" },
          { glyph: "□", label: "Maximize" },
          { glyph: "×", label: "Close" },
        ].map((btn) => (
          <button
            key={btn.label}
            type="button"
            className="w95-titlebtn text-[10px] leading-none"
            onClick={() => onFakeError(randomFakeError())}
            aria-label={btn.label}
            title={btn.label}
          >
            {btn.glyph}
          </button>
        ))}
      </div>
    </header>
  );
}
