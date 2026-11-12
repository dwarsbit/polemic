import { errorText } from "@/lib/error-text";
import { useEffect, useState } from "react";
import { ArrowLeft, Folder, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getSettings,
  isShareError,
  linkAccountProjects,
  linkOpenAccountProject,
  type AccountProjectRow,
} from "@/lib/tauri";
import { useDialogsStore } from "@/store/dialogs";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * The projects on the Polemic account, made in the browser or shared
 * from another computer. Opening one asks where to keep it: a new
 * folder in the projects folder, or a new or empty folder you pick.
 * The folder then syncs both ways. A project already on this computer
 * opens its folder.
 */
export function AccountProjectsDialog() {
  const request = useDialogsStore((s) => s.accountProjects);
  const close = () => useDialogsStore.getState().setAccountProjects(null);
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        {request !== null && (
          // A link that arrives while the dialog is open starts over.
          <AccountProjects
            key={request.projectId ?? ""}
            wanted={request.projectId}
            onDone={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccountProjects({
  wanted,
  onDone,
}: {
  /** The project an "Open in the desktop app" link asked for. */
  wanted: string | null;
  onDone: () => void;
}) {
  const openProject = useProjectStore((s) => s.openProject);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const [projects, setProjects] = useState<AccountProjectRow[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The project whose folder is being chosen; null shows the list. */
  const [placing, setPlacing] = useState<AccountProjectRow | null>(null);
  const [opening, setOpening] = useState<{ id: string; choose: boolean } | null>(null);
  const [missing, setMissing] = useState(false);
  const [projectsRoot, setProjectsRoot] = useState("");

  async function open(project: AccountProjectRow, choose: boolean) {
    setError(null);
    setOpening({ id: project.id, choose });
    try {
      const info = await linkOpenAccountProject(project.id, project.name, choose);
      // Null: the folder dialog was cancelled.
      if (info === null) return;
      onDone();
      await openProject(info.path);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setOpening(null);
    }
  }

  /** On this computer already: its folder opens. Otherwise ask where. */
  function choose(project: AccountProjectRow) {
    setError(null);
    if (project.folder) void open(project, false);
    else setPlacing(project);
  }

  useEffect(() => {
    let live = true;
    void getSettings()
      .then((settings) => live && setProjectsRoot(settings.projectsRoot))
      .catch(() => {});
    linkAccountProjects()
      .then((all) => {
        if (!live) return;
        const list = all.filter((p) => p.writable);
        setProjects(list);
        if (wanted === null) return;
        const project = list.find((p) => p.id === wanted);
        if (project) choose(project);
        else setMissing(true);
      })
      .catch((e) => {
        if (!live) return;
        if (isShareError(e) && e.kind === "signedOut") setSignedOut(true);
        else setError(errorText(e));
        setProjects([]);
      });
    return () => {
      live = false;
    };
    // Runs once: the dialog remounts for another project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (placing) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Open “{placing.name}”</DialogTitle>
          <DialogDescription className="text-xs">
            Choose where to keep this project on your computer. The folder stays in sync
            with your account.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <PlaceButton
            icon={<Folder />}
            label="In your projects folder"
            detail={projectsRoot}
            busy={opening !== null && !opening.choose}
            disabled={opening !== null}
            onClick={() => void open(placing, false)}
          />
          <PlaceButton
            icon={<FolderOpen />}
            label="In another folder…"
            detail="Pick a new or empty folder."
            busy={opening !== null && opening.choose}
            disabled={opening !== null}
            onClick={() => void open(placing, true)}
          />
        </div>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <div>
          <Button
            variant="ghost"
            size="sm"
            disabled={opening !== null}
            onClick={() => {
              setError(null);
              setPlacing(null);
            }}
          >
            <ArrowLeft />
            All projects
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Open from your account</DialogTitle>
        <DialogDescription className="text-xs">
          Projects you made in your browser or shared from another computer. Opening one
          puts it in a folder on this computer that stays in sync with your account.
        </DialogDescription>
      </DialogHeader>
      {missing && (
        <p className="text-xs text-muted-foreground" role="status">
          That project isn’t in this account. Sign in with the account you use in your
          browser, or pick a project below.
        </p>
      )}
      {projects === null ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : signedOut ? (
        <p className="text-xs text-muted-foreground">
          Sign in to your Polemic account first.{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => {
              onDone();
              openSettings("account");
            }}
          >
            Sign in
          </button>
        </p>
      ) : projects.length === 0 && !error ? (
        <p className="text-xs text-muted-foreground">
          No projects in your account yet. Share a project, or make one in your browser.
        </p>
      ) : (
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span
                  className="block truncate text-xs text-muted-foreground"
                  title={p.folder ?? undefined}
                >
                  {[
                    p.role === "owner" ? "" : `${p.owner?.name ?? "Someone"}’s project`,
                    p.folder
                      ? "On this computer"
                      : p.updatedAt
                        ? `Changed ${formatDate(p.updatedAt)}`
                        : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={opening !== null}
                onClick={() => choose(p)}
              >
                {opening?.id === p.id && <Loader2 className="size-3 animate-spin" />}
                {p.folder ? "Open" : "Open…"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** One place to keep the project: a label with what it means below. */
function PlaceButton({
  icon,
  label,
  detail,
  busy,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-3 rounded-md border bg-background px-3 py-2 text-left shadow-xs outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-60 dark:bg-transparent dark:hover:bg-input/30 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    >
      {busy ? <Loader2 className="animate-spin" /> : icon}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground" title={detail}>
          {detail}
        </span>
      </span>
    </button>
  );
}
