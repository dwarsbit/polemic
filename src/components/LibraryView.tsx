import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpRight,
  FolderOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
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
import {
  createProject,
  deleteProject,
  getSettings,
  renameProject,
  setPinnedProject,
  type Settings,
} from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

type ActionDialog =
  | { kind: "none" }
  | { kind: "rename"; path: string; name: string }
  | { kind: "delete"; path: string; name: string };

export function LibraryView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<ActionDialog>({ kind: "none" });
  const openProject = useProjectStore((s) => s.openProject);

  useEffect(() => {
    void getSettings()
      .then(setSettings)
      .catch((e) => setError(String(e)));
  }, []);

  async function refresh() {
    try {
      setSettings(await getSettings());
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      const info = await createProject(name);
      await openProject(info.path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(path: string) {
    setError(null);
    try {
      await openProject(path);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleOpenFolder() {
    setError(null);
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string" && dir) await handleOpen(dir);
  }

  const projects = settings
    ? [...settings.recentProjects].sort((a, b) => {
        const aPinned = settings.pinnedProjects.includes(a.path) ? 0 : 1;
        const bPinned = settings.pinnedProjects.includes(b.path) ? 0 : 1;
        return aPinned - bPinned;
      })
    : [];

  async function confirmAction() {
    setError(null);
    try {
      if (action.kind === "rename") {
        await renameProject(action.path, newName);
        await refresh();
      } else if (action.kind === "delete") {
        setSettings(await deleteProject(action.path));
      }
      setAction({ kind: "none" });
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight">Polemic</h1>
        <p className="text-sm text-muted-foreground">
          Local-first LaTeX editing, compiled on your machine.
        </p>
        <Separator className="my-4" />
        <div className="flex gap-2">
          <Input
            placeholder="New project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() !== "") void handleCreate();
            }}
          />
          <Button
            onClick={() => void handleCreate()}
            disabled={busy || name.trim() === ""}
          >
            <Plus />
            Create
          </Button>
        </div>
        <div className="mt-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void handleOpenFolder()}
          >
            <FolderOpen />
            Open existing folder
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <Separator className="my-4" />
        <h2 className="mb-2 text-xs font-medium text-muted-foreground">
          RECENT PROJECTS
        </h2>
        {settings === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          <ul className="space-y-1">
            {projects.map((project) => {
              const pinned = settings.pinnedProjects.includes(project.path);
              return (
                <li
                  key={project.path}
                  className="group flex items-center justify-between rounded px-2 py-1.5 hover:bg-accent"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-col text-left"
                    onClick={() => void handleOpen(project.path)}
                  >
                    <span className="truncate text-sm font-medium">
                      {pinned && <Pin className="mr-1 inline size-3 -rotate-45" />}
                      {project.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {project.path}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={pinned ? "Unpin project" : "Pin project"}
                      onClick={() => {
                        void setPinnedProject(project.path, !pinned).then(refresh);
                      }}
                    >
                      {pinned ? <PinOff /> : <Pin />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Rename project"
                      onClick={() => {
                        setNewName(project.name);
                        setAction({ kind: "rename", ...project });
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Move project to trash"
                      onClick={() => setAction({ kind: "delete", ...project })}
                    >
                      <Trash2 />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Open project"
                      onClick={() => void handleOpen(project.path)}
                    >
                      <ArrowUpRight />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog
        open={action.kind !== "none"}
        onOpenChange={(open) => {
          if (!open) setAction({ kind: "none" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action.kind === "rename" ? "Rename project" : "Delete project"}
            </DialogTitle>
          </DialogHeader>
          {action.kind === "rename" ? (
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim() !== "") void confirmAction();
              }}
            />
          ) : action.kind === "delete" ? (
            <p className="text-sm">
              Move <span className="font-medium">{action.name}</span> to the trash? The
              folder stays in the trash until you empty it.
            </p>
          ) : null}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction({ kind: "none" })}>
              Cancel
            </Button>
            <Button
              variant={action.kind === "delete" ? "destructive" : "default"}
              disabled={action.kind === "rename" && newName.trim() === ""}
              onClick={() => void confirmAction()}
            >
              {action.kind === "delete" ? "Move to trash" : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
