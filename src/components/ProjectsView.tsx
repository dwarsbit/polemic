import { useEffect, useRef, useState } from "react";
import { ChevronDown, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  createProject,
  deleteProject,
  getSettings,
  gitCloneProject,
  listTemplates,
  openProjectDialog,
  projectNameFromRemote,
  renameProject,
  setPinnedProject,
  texPackageInfo,
  type Settings,
  type TemplateInfo,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { PolemicLogoVertical } from "@/components/PolemicLogo";
import { UsageSummary } from "@/components/UsageSummary";
import { useDialogsStore } from "@/store/dialogs";
import { useProjectStore } from "@/store/project";
import { features } from "@/lib/target";

/** Journal and conference templates share one segment with a menu, so
 *  the picker keeps the general-purpose templates up front. */
const PUBLISHER_TEMPLATES = ["acm", "ieee", "lncs", "elsevier"];

type ActionDialog =
  | { kind: "none" }
  | { kind: "rename"; path: string; name: string }
  | { kind: "delete"; path: string; name: string }
  | { kind: "clone" };

export function ProjectsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<ActionDialog>({ kind: "none" });
  const [cloneUrl, setCloneUrl] = useState("");
  // The clone's project name: taken from the URL until the user types one.
  const [cloneName, setCloneName] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templateId, setTemplateId] = useState("article");
  // Packages the chosen template needs but the TeX distribution lacks.
  const [missing, setMissing] = useState<{ id: string; packages: string[] } | null>(
    null,
  );
  const openProject = useProjectStore((s) => s.openProject);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSettings()
      .then(setSettings)
      .catch((e) => {
        setError(String(e));
        setLoadFailed(true);
      });
    void listTemplates()
      .then(setTemplates)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const requires = templates.find((t) => t.id === templateId)?.requires ?? [];
    if (requires.length === 0) return;
    let cancelled = false;
    void texPackageInfo(requires.map((r) => r.file))
      .then((infos) => {
        if (cancelled) return;
        const packages = requires
          .filter((_, i) => infos[i]?.installed === false)
          .map((r) => r.package);
        setMissing({ id: templateId, packages: [...new Set(packages)] });
      })
      .catch(() => {
        // No TeX tools to ask: say nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [templates, templateId]);
  const missingPackages =
    missing !== null && missing.id === templateId ? missing.packages : [];

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
      const info = await createProject(name, templateId);
      await openProject(info.path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  /** The browser build: a new project from a zip's files. */
  async function handleUploadZip() {
    setError(null);
    const [{ pickFiles }, { importProjectZip }] = await Promise.all([
      import("@/web/uploads"),
      import("@/web/projects"),
    ]);
    const [zip] = await pickFiles({ multiple: false, accept: ".zip" });
    if (!zip) return;
    setBusy(true);
    try {
      const info = await importProjectZip(
        name.trim() || zip.name.replace(/\.zip$/i, ""),
        zip,
      );
      await openProject(info.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    try {
      // The dialog runs Rust-side: only a folder the user picked is admitted.
      const info = await openProjectDialog();
      if (info !== null) await handleOpen(info.path);
    } catch (e) {
      setError(String(e));
    }
  }

  const projects = settings
    ? [...settings.recentProjects].sort((a, b) => {
        const aPinned = settings.pinnedProjects.includes(a.path) ? 0 : 1;
        const bPinned = settings.pinnedProjects.includes(b.path) ? 0 : 1;
        return aPinned - bPinned;
      })
    : [];

  const effectiveCloneName = cloneName ?? projectNameFromRemote(cloneUrl);
  const canClone = cloneUrl.trim() !== "" && effectiveCloneName.trim() !== "" && !busy;

  async function confirmAction() {
    setError(null);
    try {
      if (action.kind === "rename") {
        await renameProject(action.path, newName);
        await refresh();
      } else if (action.kind === "delete") {
        setSettings(await deleteProject(action.path));
      } else if (action.kind === "clone") {
        setBusy(true);
        try {
          const info = await gitCloneProject(cloneUrl, effectiveCloneName);
          setAction({ kind: "none" });
          await openProject(info.path);
        } finally {
          setBusy(false);
        }
        return;
      }
      setAction({ kind: "none" });
    } catch (e) {
      setError(String(e));
    }
  }

  const publisherTemplates = templates.filter((t) =>
    PUBLISHER_TEMPLATES.includes(t.id),
  );
  const selectedPublisher = publisherTemplates.find((t) => t.id === templateId);

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-4 pt-10 pb-16 text-foreground">
      <h1 className="mt-auto mb-8 shrink-0 text-foreground">
        <PolemicLogoVertical className="h-28 w-auto" />
      </h1>
      <div className="mb-auto w-full max-w-lg shrink-0 rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex gap-2">
          <Input
            ref={nameInput}
            autoFocus
            className="h-9"
            placeholder="New project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() !== "") void handleCreate();
            }}
          />
          <Button
            size="lg"
            onClick={() => {
              // An empty name has nothing to create: point at the field.
              if (name.trim() === "") nameInput.current?.focus();
              else void handleCreate();
            }}
            disabled={busy}
          >
            Create
          </Button>
        </div>
        {templates.length > 0 && (
          <div className="mt-3">
            <div
              role="radiogroup"
              aria-label="Template"
              className="flex flex-wrap gap-0.5 rounded-md bg-muted p-0.5"
            >
              {templates
                .filter((t) => !PUBLISHER_TEMPLATES.includes(t.id))
                .map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    role="radio"
                    aria-checked={templateId === template.id}
                    title={template.description}
                    className={templateSegment(templateId === template.id)}
                    onClick={() => setTemplateId(template.id)}
                  >
                    {template.name}
                  </button>
                ))}
              {publisherTemplates.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selectedPublisher !== undefined}
                      title={selectedPublisher?.description}
                      className={templateSegment(selectedPublisher !== undefined)}
                    >
                      {selectedPublisher?.name ?? "Publisher"}
                      <ChevronDown className="size-3 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuRadioGroup
                      value={selectedPublisher?.id ?? ""}
                      onValueChange={setTemplateId}
                    >
                      {publisherTemplates.map((template) => (
                        <DropdownMenuRadioItem
                          key={template.id}
                          value={template.id}
                          title={template.description}
                        >
                          {template.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {missingPackages.length > 0 && (
              <p className="mt-2 text-xs text-warning">
                This template needs {missingPackages.join(", ")}, which your TeX
                distribution lacks. With TeX Live, install them with{" "}
                <code className="font-mono">
                  tlmgr install {missingPackages.join(" ")}
                </code>
                . MiKTeX installs them on the first compile.
              </p>
            )}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <h2 className="mt-5 mb-1.5 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          {features.localFiles ? "Recent" : "Projects"}
        </h2>
        {settings === null ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            {loadFailed ? "Couldn't load your projects." : "Loading…"}
          </p>
        ) : projects.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            {features.localFiles
              ? "No projects yet. Create one above or open a folder."
              : "No projects yet. Name one above, pick a template and select Create, or upload a zip of a project you have. Projects you share from the desktop app show up here too."}
          </p>
        ) : (
          <ul className="-mx-1 space-y-0.5">
            {projects.map((project) => {
              const pinned = settings.pinnedProjects.includes(project.path);
              return (
                <li
                  key={project.path}
                  className="group relative flex items-center rounded-md hover:bg-muted"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-baseline gap-3 px-2.5 py-1.5 text-left"
                    title={features.localFiles ? project.path : undefined}
                    onClick={() => void handleOpen(project.path)}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">
                        {pinned && (
                          <Pin className="mr-1 inline size-3 -rotate-45 text-muted-foreground" />
                        )}
                        {project.name}
                      </span>
                      {project.detail && (
                        <span className="truncate text-xs text-muted-foreground">
                          {project.detail}
                        </span>
                      )}
                    </span>
                    {project.openedAt !== undefined && (
                      <span className="shrink-0 text-2xs text-muted-foreground group-focus-within:invisible group-hover:invisible">
                        {formatOpened(project.openedAt)}
                      </span>
                    )}
                  </button>
                  {/* Over the date on hover, so the row keeps its height. */}
                  <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={pinned ? "Unpin project" : "Pin project"}
                      onClick={() => {
                        void setPinnedProject(project.path, !pinned).then(refresh);
                      }}
                    >
                      {pinned ? <PinOff /> : <Pin />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
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
                      size="icon-sm"
                      className="hover:text-destructive"
                      title={
                        features.localFiles ? "Move project to trash" : "Delete project"
                      }
                      onClick={() => setAction({ kind: "delete", ...project })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {features.localFiles ? (
            <>
              <Button variant="outline" onClick={() => void handleOpenFolder()}>
                Open folder…
              </Button>
              <Button
                variant="outline"
                title="Clone a Git repository into a new project"
                onClick={() => {
                  setError(null);
                  setCloneUrl("");
                  setCloneName(null);
                  setAction({ kind: "clone" });
                }}
              >
                Clone from Git…
              </Button>
              <Button
                variant="outline"
                title="Open a project from your Polemic account, made in your browser or on another computer"
                onClick={() =>
                  useDialogsStore.getState().setAccountProjects({ projectId: null })
                }
              >
                Open from your account…
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              title="Make a project from the files in a zip, named as above or after the zip"
              disabled={busy}
              onClick={() => void handleUploadZip()}
            >
              Upload a zip…
            </Button>
          )}
        </div>
        {/* Signed in with the site's session: the plan's limits. */}
        {!features.desktopAccount && <UsageSummary />}
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
              {action.kind === "rename"
                ? "Rename project"
                : action.kind === "clone"
                  ? "Clone repository"
                  : "Delete project"}
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
            features.localFiles ? (
              <p className="text-sm">
                Move <span className="font-medium">{action.name}</span> to the trash?
                You can restore it from there until you empty the trash.
              </p>
            ) : (
              <p className="text-sm">
                Delete <span className="font-medium">{action.name}</span> with its
                files, comments and review links? This can't be undone.
              </p>
            )
          ) : action.kind === "clone" ? (
            <div className="flex flex-col gap-2">
              <Input
                autoFocus
                placeholder="https://github.com/you/paper.git"
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canClone) void confirmAction();
                }}
              />
              <Input
                placeholder="Project name"
                value={effectiveCloneName}
                onChange={(e) => setCloneName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canClone) void confirmAction();
                }}
              />
              <p className="text-xs text-muted-foreground">
                The repository is cloned into your projects folder. A private repository
                needs a git account in Settings, or an SSH key.
              </p>
            </div>
          ) : null}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction({ kind: "none" })}>
              Cancel
            </Button>
            <Button
              variant={action.kind === "delete" ? "destructive" : "default"}
              disabled={
                (action.kind === "rename" && newName.trim() === "") ||
                (action.kind === "clone" && !canClone)
              }
              onClick={() => void confirmAction()}
            >
              {action.kind === "delete"
                ? features.localFiles
                  ? "Move to trash"
                  : "Delete"
                : action.kind === "clone"
                  ? busy
                    ? "Cloning…"
                    : "Clone"
                  : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One segment of the template picker. */
function templateSegment(selected: boolean): string {
  return cn(
    "inline-flex flex-auto items-center justify-center gap-1 rounded-sm px-2 py-1 text-[13px] font-medium whitespace-nowrap transition-colors",
    selected
      ? "bg-background text-foreground shadow-xs"
      : "text-muted-foreground hover:text-foreground",
  );
}

/** "Today", "Yesterday", "Oct 28", or "Oct 28, 2025" in another year. */
export function formatOpened(time: number, now = new Date()): string {
  const date = new Date(time);
  const day = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
