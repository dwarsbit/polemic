import { useMemo, useState } from "react";
import { FilePlus2, FolderPlus } from "lucide-react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { FileTree } from "@/components/FileTree";
import { SectionHeader } from "@/components/SectionHeader";
import { SymbolsPanel } from "@/components/SymbolsPanel";
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
import type { FileEntry } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

type DialogKind = null | "newFile" | "newFolder" | "rename" | "delete";

const SIDEBAR_PANEL_IDS = [
  "sidebar-files",
  "sidebar-search",
  "sidebar-outline",
  "sidebar-symbols",
];

/** Pixel height of a collapsed section (the header strip). */
const COLLAPSED_THRESHOLD_PX = 44;

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
  const content = useEditorStore((s) => s.content);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const outline = useMemo(() => parseOutline(content), [content]);
  const panelLayout = useSettingsStore((s) => s.panelLayout);
  const persistPanelLayout = useSettingsStore((s) => s.persistPanelLayout);

  const filesRef = usePanelRef();
  const searchRef = usePanelRef();
  const outlineRef = usePanelRef();
  const symbolsRef = usePanelRef();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [dialogKind, setDialogKind] = useState<DialogKind>(null);
  const [entryName, setEntryName] = useState("");
  const [target, setTarget] = useState<FileEntry | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  function togglePanel(id: string, ref: React.RefObject<PanelImperativeHandle | null>) {
    const panel = ref.current;
    if (!panel) return;
    const wasCollapsed = collapsed[id] ?? false;
    setCollapsed((state) => ({ ...state, [id]: !wasCollapsed }));
    if (wasCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }

  /** Keep the chevron state in sync when the panel is resized (incl. drag). */
  function syncCollapsed(id: string, sizeInPixels: number) {
    const isCollapsed = sizeInPixels <= COLLAPSED_THRESHOLD_PX;
    if ((collapsed[id] ?? false) !== isCollapsed) {
      setCollapsed((state) => ({ ...state, [id]: isCollapsed }));
    }
  }

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

  const sidebarLayout = Object.fromEntries(
    SIDEBAR_PANEL_IDS.filter((id) => panelLayout?.[id] !== undefined).map((id) => [
      id,
      panelLayout![id],
    ]),
  );

  return (
    <aside className="flex h-full w-full flex-col border-r bg-sidebar text-sidebar-foreground">
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
          defaultSize={0.28}
          minSize={0.12}
          collapsible
          collapsedSize="2.25rem"
          panelRef={filesRef}
          onResize={(size) => syncCollapsed("sidebar-files", size.inPixels)}
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
            {(collapsed["sidebar-files"] ?? false) === false && (
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
            )}
          </div>
        </Panel>
        <Separator className="h-px w-full bg-border hover:bg-primary/50" />
        <Panel
          id="sidebar-search"
          defaultSize={0.16}
          minSize={0.1}
          collapsible
          collapsedSize="2.25rem"
          panelRef={searchRef}
          onResize={(size) => syncCollapsed("sidebar-search", size.inPixels)}
        >
          <ProjectSearch
            key={project?.path ?? "none"}
            collapsed={collapsed["sidebar-search"] ?? false}
            onToggle={() => togglePanel("sidebar-search", searchRef)}
          />
        </Panel>
        <Separator className="h-px w-full bg-border hover:bg-primary/50" />
        <Panel
          id="sidebar-outline"
          defaultSize={0.24}
          minSize={0.12}
          collapsible
          collapsedSize="2.25rem"
          panelRef={outlineRef}
          onResize={(size) => syncCollapsed("sidebar-outline", size.inPixels)}
        >
          <div className="flex h-full flex-col">
            <SectionHeader
              label="OUTLINE"
              collapsed={collapsed["sidebar-outline"] ?? false}
              onToggle={() => togglePanel("sidebar-outline", outlineRef)}
            />
            {(collapsed["sidebar-outline"] ?? false) === false && (
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
            )}
          </div>
        </Panel>
        <Separator className="h-px w-full bg-border hover:bg-primary/50" />
        <Panel
          id="sidebar-symbols"
          defaultSize={0.18}
          minSize={0.1}
          collapsible
          collapsedSize="2.25rem"
          panelRef={symbolsRef}
          onResize={(size) => syncCollapsed("sidebar-symbols", size.inPixels)}
        >
          <SymbolsPanel
            collapsed={collapsed["sidebar-symbols"] ?? false}
            onToggle={() => togglePanel("sidebar-symbols", symbolsRef)}
          />
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
    </aside>
  );
}
