import { useEffect, useState } from "react";
import { FileCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  applyDocumentSettings,
  readDocumentSettings,
  type DocumentSettings,
} from "@/lib/document-settings";
import * as api from "@/lib/tauri";
import { useDialogsStore } from "@/store/dialogs";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

const CLASS_PRESETS = [
  "article",
  "report",
  "book",
  "scrartcl",
  "scrreprt",
  "beamer",
];

const CUSTOM = "__custom__";

type Draft = Omit<DocumentSettings, "packageCount"> & { packageCount: number };

/**
 * Document settings: class, font size, paper, columns, draft mode, and
 * the title metadata of the MAIN file — reachable from the left rail
 * regardless of which file is open. The package count links to the
 * package manager; saving applies the preamble rewrite to the main
 * file through the shared editor store (so open editors resync).
 */
export function DocumentSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mainFile = useProjectStore((s) => s.mainFile);
  const activeFile = useProjectStore((s) => s.activeFile);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [available, setAvailable] = useState(false);

  // Load the main file's settings whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const { project, buffers } = useProjectStore.getState();
      if (project === null || mainFile === null) {
        if (!cancelled) {
          setDraft(null);
          setAvailable(false);
        }
        return;
      }
      let content: string;
      if (activeFile === mainFile) {
        content = useEditorStore.getState().content; // live buffer, unsaved included
      } else if (buffers[mainFile] !== undefined) {
        content = buffers[mainFile]!;
      } else {
        try {
          content = await api.readProjectFile(project.path, mainFile);
        } catch {
          if (!cancelled) {
            setDraft(null);
            setAvailable(false);
          }
          return;
        }
      }
      if (cancelled) return;
      const settings = readDocumentSettings(content);
      setAvailable(settings !== null);
      setDraft(settings);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mainFile, activeFile]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => (prev === null ? prev : { ...prev, [key]: value }));
  };

  async function save() {
    if (draft === null) return;
    const { project, buffers, activeFile: activeNow } = useProjectStore.getState();
    if (project === null || mainFile === null) return;
    let content: string;
    if (activeNow === mainFile) {
      content = useEditorStore.getState().content;
    } else if (buffers[mainFile] !== undefined) {
      content = buffers[mainFile]!;
    } else {
      try {
        content = await api.readProjectFile(project.path, mainFile);
      } catch {
        return;
      }
    }
    const next = applyDocumentSettings(content, draft);
    if (next === null || next === content) {
      onOpenChange(false);
      return;
    }
    if (activeNow === mainFile) {
      // Through the shared store so both editor faces resync.
      useEditorStore.getState().loadContent(next);
    }
    useProjectStore.getState().markDirty(mainFile, next);
    onOpenChange(false);
  }

  const classPreset = draft !== null && CLASS_PRESETS.includes(draft.className)
    ? draft.className
    : CUSTOM;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCog className="size-4" />
            Document settings
          </DialogTitle>
        </DialogHeader>
        {draft === null || !available ? (
          <p className="text-sm text-muted-foreground">
            {mainFile === null
              ? "This project has no main file."
              : `No configurable document class found in ${mainFile}.`}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs">
                Class
                <Select
                  value={classPreset}
                  onValueChange={(value) => {
                    if (value !== CUSTOM) set("className", value);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASS_PRESETS.map((preset) => (
                      <SelectItem key={preset} value={preset}>
                        {preset}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>Custom…</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Font size
                <Select
                  value={draft.fontSize === "" ? "default" : draft.fontSize}
                  onValueChange={(value) => set("fontSize", value === "default" ? "" : value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Class default</SelectItem>
                    <SelectItem value="10pt">10pt</SelectItem>
                    <SelectItem value="11pt">11pt</SelectItem>
                    <SelectItem value="12pt">12pt</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Paper
                <Select
                  value={draft.paper === "" ? "default" : draft.paper}
                  onValueChange={(value) => set("paper", value === "default" ? "" : value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Class default</SelectItem>
                    <SelectItem value="a4paper">A4</SelectItem>
                    <SelectItem value="letterpaper">Letter</SelectItem>
                    <SelectItem value="a5paper">A5</SelectItem>
                    <SelectItem value="legalpaper">Legal</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Layout
                <Select
                  value={draft.twoColumn ? "twocolumn" : "onecolumn"}
                  onValueChange={(value) => set("twoColumn", value === "twocolumn")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="onecolumn">One column</SelectItem>
                    <SelectItem value="twocolumn">Two columns</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            {classPreset === CUSTOM && (
              <label className="flex flex-col gap-1 text-xs">
                Custom class
                <Input
                  value={draft.className}
                  onChange={(e) => set("className", e.target.value)}
                  placeholder="IEEEtran, acmart, …"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs">
              Other class options
              <Input
                value={draft.customOptions}
                onChange={(e) => set("customOptions", e.target.value)}
                placeholder="twoside, fleqn, …"
              />
            </label>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className="text-xs font-medium">Draft mode</p>
                <p className="text-xs text-muted-foreground">
                  No floats, single spacing for review copies
                </p>
              </div>
              <Switch checked={draft.draft} onCheckedChange={(v) => set("draft", v)} />
            </div>
            <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
              <p className="text-xs font-medium">Title metadata</p>
              <Input
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Title — \title{…}"
              />
              <Input
                value={draft.author}
                onChange={(e) => set("author", e.target.value)}
                placeholder="Author — \author{…}"
              />
              <Input
                value={draft.date}
                onChange={(e) => set("date", e.target.value)}
                placeholder="Date — \date{…}"
              />
            </div>
            <button
              type="button"
              className="flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-accent/50"
              onClick={() => {
                onOpenChange(false);
                useDialogsStore.getState().setPackagesDialogOpen(true);
              }}
            >
              <span>
                {draft.packageCount} package{draft.packageCount === 1 ? "" : "s"}
              </span>
              <span className="text-xs text-muted-foreground">Manage packages →</span>
            </button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={draft === null || !available} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
