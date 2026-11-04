import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, FilePlus2, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ADO_WORK_ITEM_TYPE,
  categoryAreaPath,
  createWorkItem,
  MY_BUG_WORK_ITEM_TYPE,
  workItemUrl,
  type AdoConfig,
  type TopLevelWorkItemType,
} from "@/lib/ado";
import { AREAS } from "@/lib/work-items-data";
import { safeUrl } from "@/lib/safe-url";

type PartialOutcome = {
  id: number | null;
  message: string;
};

export function CreateMyWorkItemDialog({
  open,
  config,
  creatorIdentity,
  creatorName,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  config: AdoConfig;
  creatorIdentity: string | null;
  creatorName: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (workItemType: TopLevelWorkItemType) => Promise<void>;
}) {
  const [workItemType, setWorkItemType] =
    useState<TopLevelWorkItemType>(ADO_WORK_ITEM_TYPE);
  const [category, setCategory] = useState(AREAS[0]?.code ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<PartialOutcome | null>(null);

  useEffect(() => {
    if (!open) return;
    setWorkItemType(ADO_WORK_ITEM_TYPE);
    setCategory(AREAS[0]?.code ?? "");
    setTitle("");
    setDescription("");
    setSaving(false);
    setError(null);
    setPartial(null);
  }, [open]);

  const canSubmit =
    Boolean(creatorIdentity) &&
    Boolean(category) &&
    title.trim().length > 0 &&
    !saving;
  const targetPath = categoryAreaPath(category, config.areaRoot);
  const partialUrl =
    partial?.id != null ? safeUrl(workItemUrl(config, String(partial.id))) : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !creatorIdentity) return;
    setSaving(true);
    setError(null);
    setPartial(null);
    try {
      const created = await createWorkItem(config, {
        title,
        description,
        categoryCode: category,
        workItemType,
        assigneeIdentity: creatorIdentity,
      });
      await onCreated(workItemType);

      const itemLabel = created.id
        ? `${workItemType} ${created.id}`
        : `The ${workItemType.toLowerCase()}`;
      if (created.followUpError) {
        const message = `${itemLabel} was created, but assignment to ${creatorName} could not be confirmed: ${created.followUpError}`;
        setPartial({ id: created.id, message });
        toast.error(`${itemLabel} created with an assignment problem`, {
          description: created.followUpError,
        });
        return;
      }

      toast.success(`${itemLabel} created`, {
        description: `${created.areaPath} · assigned to ${creatorName}`,
      });
      onOpenChange(false);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : `Azure DevOps rejected the new ${workItemType.toLowerCase()}.`;
      setError(message);
      toast.error(`Couldn’t create the ${workItemType.toLowerCase()}`, {
        description: message,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="w95-dialog max-w-lg gap-0" showCloseButton={false}>
        <DialogHeader className="space-y-0">
          <div className="w95-titlebar">
            <FilePlus2 className="h-4 w-4" />
            <DialogTitle className="min-w-0 flex-1 truncate text-left text-[12px] font-bold text-white">
              New My Work item
            </DialogTitle>
            <button
              type="button"
              className="w95-titlebtn text-[10px] leading-none"
              disabled={saving}
              onClick={() => onOpenChange(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <DialogDescription className="sr-only">
            Create a User Story or Bug in Azure DevOps and assign it to yourself.
          </DialogDescription>
        </DialogHeader>

        <form className="p-3" onSubmit={submit}>
          <div className="space-y-3">
            <div className="grid gap-1">
              <Label htmlFor="my-work-new-type" className="text-[11px] font-bold">
                Type
              </Label>
              <Select
                value={workItemType}
                disabled={saving}
                onValueChange={(value) => {
                  if (
                    value === ADO_WORK_ITEM_TYPE ||
                    value === MY_BUG_WORK_ITEM_TYPE
                  ) {
                    setWorkItemType(value);
                  }
                }}
              >
                <SelectTrigger id="my-work-new-type" className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ADO_WORK_ITEM_TYPE}>User Story</SelectItem>
                  <SelectItem value={MY_BUG_WORK_ITEM_TYPE}>Bug</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1">
              <Label
                htmlFor="my-work-new-category"
                className="text-[11px] font-bold"
              >
                Category
              </Label>
              <Select
                value={category}
                disabled={saving}
                onValueChange={setCategory}
              >
                <SelectTrigger
                  id="my-work-new-category"
                  className="w-full"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AREAS.map((area) => (
                    <SelectItem key={area.code} value={area.code}>
                      {area.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="truncate font-mono text-[10px] text-[#404040]">
                {targetPath}
              </span>
            </div>

            <div className="grid gap-1">
              <Label htmlFor="my-work-new-title" className="text-[11px] font-bold">
                Title
              </Label>
              <Input
                id="my-work-new-title"
                value={title}
                disabled={saving}
                maxLength={255}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
              />
            </div>

            <div className="grid gap-1">
              <Label
                htmlFor="my-work-new-description"
                className="text-[11px] font-bold"
              >
                Description
              </Label>
              <Textarea
                id="my-work-new-description"
                value={description}
                disabled={saving}
                rows={5}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional"
                className="resize-y"
              />
            </div>

            <p className="text-[10px] text-[#404040]">
              Assigned to {creatorName} so it appears in My Work.
            </p>
            {!creatorIdentity && (
              <p className="font-bold text-[#a00000]" role="alert">
                Your Azure DevOps identity could not be resolved, so this item
                cannot be safely assigned to you.
              </p>
            )}
            {error && (
              <p className="w95-field px-2 py-1 font-bold text-[#a00000]" role="alert">
                {error}
              </p>
            )}
            {partial && (
              <div className="w95-field space-y-1 px-2 py-1 font-bold text-[#a00000]">
                <p>{partial.message}</p>
                {partialUrl && (
                  <a
                    href={partialUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline"
                  >
                    Open the created item
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="mt-4 flex-row justify-end">
            <button
              type="button"
              className="w95-btn h-8 px-4 text-[11px]"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w95-btn w95-btn--default h-8 px-4 text-[11px]"
              disabled={!canSubmit}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <FilePlus2 className="h-3.5 w-3.5" />
                  Create {workItemType}
                </>
              )}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
