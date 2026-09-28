import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FilePlus2, FolderPlus } from "lucide-react";
import { FileTree } from "@/components/FileTree";
import { SectionHeader } from "@/components/SectionHeader";
import { useDocumentOrder } from "@/hooks/useDocumentOrder";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { sortTreeByDocumentOrder } from "@/lib/doc-structure";
import { gitIgnored, gitStatus, type FileEntry } from "@/lib/tauri";
import { resolveVersionControl, useSettingsStore } from "@/store/settings";
import { useProjectStore } from "@/store/project";

type DialogKind = null | "newFile" | "newFolder" | "rename" | "delete";

/** Append .tex to extensionless names (new files, or renames of .tex files). */
function ensureTexExtension(path: string, wasTex = true): string {
  if (!path.includes(".")) {
    return wasTex ? `${path}.tex` : path;
  }
  return path;
}

export function FilesPanel() {
  const files = useProjectStore((s) => s.files);
  const project = useProjectStore((s) => s.project);
  const versionControl = useSettingsStore((s) => resolveVersionControl(s));
  const order = useDocumentOrder();

  const gitEnabled = versionControl === "git" && project !== null;
  const { data: status } = useQuery({
    queryKey: ["git-status", project?.path],
    queryFn: () => gitStatus(project!.path),
    enabled: gitEnabled,
  });
  const { data: ignored } = useQuery({
    queryKey: ["git-ignored", project?.path],
    queryFn: () => gitIgnored(project!.path),
    enabled: gitEnabled,
  });

  const statusOf = useMemo(() => {
    const map = new Map<string, "added" | "changed" | "ignored">();
    for (const entry of status?.entries ?? []) {
      map.set(entry.path, entry.x === "?" || entry.x === "A" ? "added" : "changed");
    }
    for (const path of ignored ?? []) {
      map.set(path, "ignored");
    }
    return (path: string) => map.get(path);
  }, [status, ignored]);

  // Display order: .tex files (and directories containing them) sorted
  // by their position in the document; everything else keeps its order.
  const sortedFiles = useMemo(() => {
    const positionOf = new Map<string, number>();
    (order ?? []).forEach((path, index) => positionOf.set(path, index));
    return sortTreeByDocumentOrder(files, positionOf);
  }, [files, order]);

  const [dialogKind, setDialogKind] = useState<DialogKind>(null);
  const [entryName, setEntryName] = useState("");
  const [target, setTarget] = useState<FileEntry | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  function openDialog(
    kind: Exclude<DialogKind, null>,
    opts?: { target?: FileEntry; name?: string },
  ) {
    setDialogError(null);
    setTarget(opts?.target ?? null);
    setEntryName(opts?.name ?? "");
    setDialogKind(kind);
  }

  async function handleConfirm() {
    const store = useProjectStore.getState();
    const raw = entryName.trim();
    try {
      switch (dialogKind) {
        case "newFile":
          if (raw) await store.createEntry(ensureTexExtension(raw), false);
          break;
        case "newFolder":
          if (raw) await store.createEntry(raw, true);
          break;
        case "rename": {
          const entry = target as FileEntry;
          const wasTex = entry?.path.endsWith(".tex") ?? false;
          if (entry && raw && raw !== entry.path)
            await store.renameEntry(entry.path, ensureTexExtension(raw, wasTex));
          break;
        }
        case "delete": {
          const entry = target as FileEntry;
          if (entry) await store.deleteEntry(entry.path);
          break;
        }
      }
      setDialogKind(null);
    } catch (e) {
      setDialogError(String(e));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        label="FILES"
        collapsed={false}
        actions={
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="New file"
              onClick={() => openDialog("newFile")}
            >
              <FilePlus2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="New folder"
              onClick={() => openDialog("newFolder")}
            >
              <FolderPlus className="size-3.5" />
            </Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {files.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">Empty project.</p>
        ) : (
          <FileTree
            entries={sortedFiles}
            statusOf={gitEnabled ? statusOf : undefined}
            onRename={(entry) =>
              openDialog("rename", { target: entry, name: entry.path })
            }
            onDelete={(entry) => openDialog("delete", { target: entry })}
            onSetMain={(entry) =>
              void useProjectStore.getState().setMainFile(entry.path)
            }
          />
        )}
      </div>

      {/* --- dialogs --- */}
      <Dialog
        open={dialogKind !== null}
        onOpenChange={(open) => {
          if (!open) setDialogKind(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogKind === "newFile" && "New file"}
              {dialogKind === "newFolder" && "New folder"}
              {dialogKind === "rename" && "Rename"}
              {dialogKind === "delete" && "Delete"}
            </DialogTitle>
          </DialogHeader>
          {dialogKind === "delete" ? (
            <p className="text-sm">
              Delete <span className="font-medium">{(target as FileEntry)?.path}</span>?
              This cannot be undone. Consider taking a snapshot first.
            </p>
          ) : (
            <Input
              autoFocus
              placeholder={
                dialogKind === "newFolder" ? "chapters" : "chapters/intro.tex"
              }
              value={entryName}
              onChange={(e) => setEntryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleConfirm();
              }}
            />
          )}
          {dialogError && <p className="text-xs text-destructive">{dialogError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogKind(null)}>
              Cancel
            </Button>
            <Button
              variant={dialogKind === "delete" ? "destructive" : "default"}
              disabled={dialogKind !== "delete" && entryName.trim() === ""}
              onClick={() => void handleConfirm()}
            >
              {dialogKind === "delete" && "Delete"}
              {dialogKind !== "delete" && "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
