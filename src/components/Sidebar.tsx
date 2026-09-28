import { useMemo, useState } from "react";
import { Camera, FilePlus2, FolderPlus, ListTree, RotateCcw } from "lucide-react";
import { FileTree } from "@/components/FileTree";
import { ProjectSearch } from "@/components/ProjectSearch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { parseOutline } from "@/lib/outline";
import type { FileEntry, SnapshotInfo } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

type DialogKind = null | "newFile" | "newFolder" | "rename" | "delete" | "restore";

/** Append .tex to extensionless names (new files, or renames of .tex files). */
function ensureTexExtension(path: string, wasTex = true): string {
  if (!path.includes(".")) {
    return wasTex ? `${path}.tex` : path;
  }
  return path;
}

export function Sidebar() {
  const project = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  const activeFile = useProjectStore((s) => s.activeFile);
  const snapshots = useProjectStore((s) => s.snapshots);
  const content = useEditorStore((s) => s.content);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const outline = useMemo(() => parseOutline(content), [content]);

  const [dialogKind, setDialogKind] = useState<DialogKind>(null);
  const [entryName, setEntryName] = useState("");
  const [target, setTarget] = useState<FileEntry | SnapshotInfo | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  function openDialog(
    kind: Exclude<DialogKind, null>,
    opts?: { target?: FileEntry | SnapshotInfo; name?: string },
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
        case "restore": {
          const snap = target as SnapshotInfo;
          if (snap) await store.restoreSnapshot(snap.id);
          break;
        }
      }
      setDialogKind(null);
    } catch (e) {
      setDialogError(String(e));
    }
  }

  return (
    <aside className="flex h-full w-full flex-col border-r">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">FILES</span>
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
      </div>
      <div className="max-h-[45%] overflow-y-auto px-2 pb-2">
        {files.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">Empty project.</p>
        ) : (
          <FileTree
            entries={files}
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
      <Separator />
      <ProjectSearch key={project?.path ?? "none"} />
      <Separator />
      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground">
        <ListTree className="size-3.5" />
        OUTLINE
      </div>
      <div className="max-h-64 flex-1 overflow-y-auto px-2 pb-2">
        {outline.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            {activeFile ? "No sections in this file." : "No file open."}
          </p>
        ) : (
          <ul>
            {outline.map((entry) => (
              <li key={`${entry.line}-${entry.title}`}>
                <button
                  type="button"
                  className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-accent"
                  style={{ paddingLeft: `${8 + entry.level * 12}px` }}
                  onClick={() => jumpTo(entry.line)}
                >
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Separator />
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">SNAPSHOTS</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="Take a snapshot of the current project state"
          onClick={() => void useProjectStore.getState().takeSnapshot()}
        >
          <Camera className="size-3.5" />
        </Button>
      </div>
      <div className="max-h-40 overflow-y-auto px-2 pb-2">
        {snapshots.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No snapshots yet.</p>
        ) : (
          <ul>
            {snapshots.map((snap) => (
              <li
                key={snap.id}
                className="flex items-center justify-between rounded px-2 py-1"
              >
                <span className="truncate text-xs">
                  {new Date(snap.createdAtMillis).toLocaleString()}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  title="Restore this snapshot"
                  onClick={() => openDialog("restore", { target: snap })}
                >
                  <RotateCcw className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
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
              {dialogKind === "restore" && "Restore snapshot"}
            </DialogTitle>
          </DialogHeader>
          {dialogKind === "delete" ? (
            <p className="text-sm">
              Delete <span className="font-medium">{(target as FileEntry)?.path}</span>?
              This cannot be undone. Consider taking a snapshot first.
            </p>
          ) : dialogKind === "restore" ? (
            <p className="text-sm">
              Restore the project to the snapshot from{" "}
              {target
                ? new Date((target as SnapshotInfo).createdAtMillis).toLocaleString()
                : ""}
              ? A safety snapshot of the current state is created first.
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
              variant={
                dialogKind === "delete" || dialogKind === "restore"
                  ? "destructive"
                  : "default"
              }
              disabled={
                dialogKind !== "delete" &&
                dialogKind !== "restore" &&
                entryName.trim() === ""
              }
              onClick={() => void handleConfirm()}
            >
              {dialogKind === "delete" && "Delete"}
              {dialogKind === "restore" && "Restore"}
              {dialogKind !== "delete" && dialogKind !== "restore" && "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
