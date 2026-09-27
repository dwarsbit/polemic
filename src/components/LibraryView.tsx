import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowUpRight, FolderOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  createProject,
  getSettings,
  removeRecentProject,
  type Settings,
} from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

export function LibraryView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openProject = useProjectStore((s) => s.openProject);

  useEffect(() => {
    void getSettings()
      .then(setSettings)
      .catch((e) => setError(String(e)));
  }, []);

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

  async function handleRemoveRecent(path: string) {
    setError(null);
    try {
      setSettings(await removeRecentProject(path));
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
        ) : settings.recentProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          <ul className="space-y-1">
            {settings.recentProjects.map((project) => (
              <li
                key={project.path}
                className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-accent"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-col text-left"
                  onClick={() => void handleOpen(project.path)}
                >
                  <span className="truncate text-sm font-medium">{project.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {project.path}
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleOpen(project.path)}
                    title="Open project"
                  >
                    <ArrowUpRight />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleRemoveRecent(project.path)}
                    title="Remove from recents (files are kept on disk)"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
