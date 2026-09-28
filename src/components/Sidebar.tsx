import { useMemo, useState } from "react";
import { Camera, ChevronDown, FilePlus2, FolderPlus, RotateCcw } from "lucide-react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import type { PanelImperativeHandle } from "react-resizable-panels";
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
import { parseOutline } from "@/lib/outline";
import { cn } from "@/lib/utils";
import type { FileEntry, SnapshotInfo } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

type DialogKind = null | "newFile" | "newFolder" | "rename" | "delete" | "restore";

const SIDEBAR_PANEL_IDS = [
  "sidebar-files",
  "sidebar-search",
  "sidebar-outline",
  "sidebar-snapshots",
];

/** Append .tex to extensionless names (new files, or renames of .tex files). */
function ensureTexExtension(path: string, wasTex = true): string {
  if (!path.includes(".")) {
    return wasTex ? `${path}.tex` : path;
  }
  return path;
}

function SectionHeader({
  label,
  collapsed,
  onToggle,
  actions,
}: {
  label: string;
  collapsed: boolean;
  onToggle?: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 px-3 text-xs font-medium text-muted-foreground">
      {onToggle && (
        <button
          type="button"
          title={collapsed ? "Expand" : "Collapse"}
          className="rounded p-0.5 hover:bg-accent hover:text-foreground"
          onClick={onToggle}
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")}
          />
        </button>
      )}
      <span className="flex-1">{label}</span>
      {actions}
    </div>
  );
}

export function Sidebar() {
  const project = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  const activeFile = useProjectStore((s) => s.activeFile);
  const snapshots = useProjectStore((s) => s.snapshots);
  const content = useEditorStore((s) => s.content);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const outline = useMemo(() => parseOutline(content), [content]);
  const panelLayout = useSettingsStore((s) => s.panelLayout);
  const persistPanelLayout = useSettingsStore((s) => s.persistPanelLayout);

  const filesRef = usePanelRef();
  const searchRef = usePanelRef();
  const snapshotsRef = usePanelRef();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [dialogKind, setDialogKind] = useState<DialogKind>(null);
  const [entryName, setEntryName] = useState("");
  const [target, setTarget] = useState<FileEntry | SnapshotInfo | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  function togglePanel(id: string, ref: React.RefObject<PanelImperativeHandle | null>) {
    const panel = ref.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
    setCollapsed((state) => ({ ...state, [id]: panel.isCollapsed() }));
  }

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

  const sidebarLayout = Object.fromEntries(
    SIDEBAR_PANEL_IDS.filter((id) => panelLayout?.[id] !== undefined).map((id) => [
      id,
      panelLayout![id],
    ]),
  );

  return (
    <aside className="flex h-full w-full flex-col border-r">
      <Group
        orientation="vertical"
        className="h-full"
        defaultLayout={
          Object.keys(sidebarLayout).length > 0 ? sidebarLayout : undefined
        }
        onLayoutChanged={(layout) => persistPanelLayout(layout)}
      >
        <Panel
          id="sidebar-files"
          defaultSize={0.34}
          minSize={0.12}
          collapsible
          collapsedSize="2.25rem"
          panelRef={filesRef}
        >
          <div className="flex h-full flex-col">
            <SectionHeader
              label="FILES"
              collapsed={collapsed["sidebar-files"] ?? false}
              onToggle={() => togglePanel("sidebar-files", filesRef)}
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
          </div>
        </Panel>
        <Separator className="h-px w-full bg-border hover:bg-primary/50" />
        <Panel
          id="sidebar-search"
          defaultSize={0.2}
          minSize={0.1}
          collapsible
          collapsedSize="2.25rem"
          panelRef={searchRef}
        >
          <ProjectSearch
            key={project?.path ?? "none"}
            collapsed={collapsed["sidebar-search"] ?? false}
            onToggle={() => togglePanel("sidebar-search", searchRef)}
          />
        </Panel>
        <Separator className="h-px w-full bg-border hover:bg-primary/50" />
        <Panel id="sidebar-outline" defaultSize={0.3} minSize={0.12}>
          <div className="flex h-full flex-col">
            <SectionHeader label="OUTLINE" collapsed={false} />
            <div className="flex-1 overflow-y-auto px-2 pb-2">
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
          </div>
        </Panel>
        <Separator className="h-px w-full bg-border hover:bg-primary/50" />
        <Panel
          id="sidebar-snapshots"
          defaultSize={0.16}
          minSize={0.08}
          collapsible
          collapsedSize="2.25rem"
          panelRef={snapshotsRef}
        >
          <div className="flex h-full flex-col">
            <SectionHeader
              label="SNAPSHOTS"
              collapsed={collapsed["sidebar-snapshots"] ?? false}
              onToggle={() => togglePanel("sidebar-snapshots", snapshotsRef)}
              actions={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title="Take a snapshot of the current project state"
                  onClick={() => void useProjectStore.getState().takeSnapshot()}
                >
                  <Camera className="size-3.5" />
                </Button>
              }
            />
            <div className="flex-1 overflow-y-auto px-2 pb-2">
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
          </div>
        </Panel>
      </Group>

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
