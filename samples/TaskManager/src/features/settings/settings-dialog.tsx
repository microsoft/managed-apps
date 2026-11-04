import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Cloud, Database, Download, HardDrive, Settings2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/hooks/use-confirm";
import { defaultWiql, type AdoConfig } from "@/lib/ado";
import { errorText } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { appConfig } from "@/config";
import { downloadSnapshot, readSnapshotFile } from "@/storage/core";
import { useStorageProvider } from "@/storage/core/hooks";

export function SettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-bold text-black">{label}</label>
      {children}
    </div>
  );
}

type Section = "connection" | "data";

/**
 * Settings: the Azure DevOps connection used by this browser, and the app's own
 * data (storage mode, export and import).
 */
export function SettingsDialog({
  open,
  initial,
  isOverridden,
  onClose,
  onApply,
  onReset,
}: {
  open: boolean;
  initial: AdoConfig;
  isOverridden: boolean;
  onClose: () => void;
  onApply: (config: AdoConfig) => void;
  onReset: () => void;
}) {
  const [section, setSection] = useState<Section>("connection");
  const [draft, setDraft] = useState<AdoConfig>(initial);

  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  const effectiveWiql = draft.wiql.trim() || defaultWiql(draft.areaRoot || draft.project);
  const ready = draft.organization.trim() !== "" && draft.project.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w95-dialog max-w-lg gap-0">
        <DialogHeader className="space-y-0">
          <div className="w95-titlebar">
            <Settings2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <DialogTitle className="min-w-0 flex-1 truncate text-left text-[12px] font-bold text-white">
              Settings
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
            Azure DevOps connection and app data settings.
          </DialogDescription>
        </DialogHeader>

        <div className="w95-tabstrip px-2 pt-2" role="tablist">
          {(
            [
              ["connection", "Connection", <Database key="c" className="h-3.5 w-3.5" />],
              ["data", "Data", <HardDrive key="d" className="h-3.5 w-3.5" />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              className={cn("w95-tab", section === id && "w95-tab--active")}
              onClick={() => setSection(id)}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {section === "connection" ? (
          <>
            <div className="space-y-3 px-2 py-2.5">
              <p className="text-[11px] text-black">
                Live work items come from this Azure DevOps project, and edits made
                in the app are written back to it. Defaults come from{" "}
                <code className="font-mono">VITE_ADO_*</code> in{" "}
                <code className="font-mono">.env.local</code>; changes here apply to
                this browser only.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="Organization">
                  <Input
                    placeholder="e.g. contoso"
                    value={draft.organization}
                    onChange={(e) => setDraft({ ...draft, organization: e.target.value })}
                  />
                </SettingsField>
                <SettingsField label="Project">
                  <Input
                    placeholder="e.g. Fabrikam Web"
                    value={draft.project}
                    onChange={(e) => setDraft({ ...draft, project: e.target.value })}
                  />
                </SettingsField>
              </div>

              <SettingsField label="Area path root">
                <Input
                  placeholder="Defaults to the project root"
                  value={draft.areaRoot}
                  onChange={(e) => setDraft({ ...draft, areaRoot: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-[#404040]">
                  Fetches every work item under this area path (recursive).
                </p>
              </SettingsField>

              <SettingsField label="Custom WIQL (optional)">
                <Textarea
                  rows={3}
                  placeholder="Leave blank to query all work items under the area path above."
                  value={draft.wiql}
                  onChange={(e) => setDraft({ ...draft, wiql: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-[#404040]">
                  Overrides the area-path scope. Must{" "}
                  <code className="font-mono">SELECT [System.Id]</code>.
                </p>
              </SettingsField>

              <SettingsField label="Effective query">
                <pre className="w95-field max-h-24 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-relaxed">
                  {effectiveWiql}
                </pre>
              </SettingsField>
            </div>

            <DialogFooter className="gap-2 px-2 pb-2">
              {isOverridden && (
                <button type="button" className="w95-btn mr-auto" onClick={onReset}>
                  Use defaults
                </button>
              )}
              <button type="button" className="w95-btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="w95-btn w95-btn--default"
                disabled={!ready}
                onClick={() => onApply(draft)}
              >
                <Cloud className="h-3.5 w-3.5" /> Save &amp; load live
              </button>
            </DialogFooter>
          </>
        ) : (
          <DataSection />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Storage mode plus Export/Import of every collection and preference. */
function DataSection() {
  const provider = useStorageProvider();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function exportData() {
    setBusy(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadSnapshot(provider, `${appConfig.storage.prefix}-data-${date}.json`);
      toast.success("Data exported.");
    } catch (error) {
      toast.error("Couldn't export the data.", { description: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function importData(file: File) {
    setBusy(true);
    try {
      const snapshot = await readSnapshotFile(file);
      const ok = await confirm({
        title: "Replace this app's data?",
        description:
          "Every collection in the file replaces the matching data here. Records that don't match the app's schema are skipped. Export first if you want a backup.",
        confirmLabel: "Import",
        cancelLabel: "Cancel",
        destructive: true,
      });
      if (!ok) return;
      await provider.importAll(snapshot, { mode: "replace" });
      await queryClient.invalidateQueries();
      toast.success("Data imported.");
    } catch (error) {
      toast.error("Couldn't import the data.", { description: errorText(error) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3 px-2 py-2.5 text-[11px]">
      <div className="w95-panel space-y-1 px-2 py-2">
        <p className="font-bold">
          Storage: <span className="font-mono">{provider.id}</span>
        </p>
        <p className="text-[#404040]">
          {provider.capabilities.shared
            ? "Retro notes, trackers, tags, work-item notes and feedback are stored in a shared backend; its permissions decide who can read and change them."
            : "Local mode: retro notes, trackers, tags, work-item notes and feedback stay in this browser. Other people don't see them. Use the add-data-source skill to move them to a shared backend."}
        </p>
        <p className="text-[#404040]">Work items always live in Azure DevOps and are never stored by the app.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="w95-btn" disabled={busy} onClick={() => void exportData()}>
          <Download className="h-3.5 w-3.5" /> Export data…
        </button>
        <button type="button" className="w95-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> Import data…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importData(file);
          }}
        />
      </div>
    </div>
  );
}
