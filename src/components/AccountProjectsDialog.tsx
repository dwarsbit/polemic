import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  isShareError,
  linkAccountProjects,
  linkOpenAccountProject,
  type AccountProject,
} from "@/lib/tauri";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * The projects on the Polemic account, made in the browser or shared
 * from another computer. Opening one makes a folder for it in the
 * projects folder that syncs both ways.
 */
export function AccountProjectsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {open && <AccountProjects onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AccountProjects({ onDone }: { onDone: () => void }) {
  const openProject = useProjectStore((s) => s.openProject);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const [projects, setProjects] = useState<AccountProject[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    linkAccountProjects()
      .then((list) => live && setProjects(list.filter((p) => p.writable)))
      .catch((e) => {
        if (!live) return;
        if (isShareError(e) && e.kind === "signedOut") setSignedOut(true);
        else setError(isShareError(e) ? e.message : String(e));
        setProjects([]);
      });
    return () => {
      live = false;
    };
  }, []);

  async function open(project: AccountProject) {
    setError(null);
    setOpening(project.id);
    try {
      const info = await linkOpenAccountProject(project.id, project.name);
      onDone();
      await openProject(info.path);
    } catch (e) {
      setError(isShareError(e) ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Open from your account</DialogTitle>
        <DialogDescription className="text-xs">
          Projects you made in your browser or shared from another computer. Opening one
          puts it in your projects folder, and it stays in sync with your account.
        </DialogDescription>
      </DialogHeader>
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
                <span className="block text-xs text-muted-foreground">
                  {p.role === "owner"
                    ? ""
                    : `${p.owner?.name ?? "Someone"}'s project · `}
                  {p.updatedAt ? `Changed ${formatDate(p.updatedAt)}` : ""}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={opening !== null}
                onClick={() => void open(p)}
              >
                {opening === p.id && <Loader2 className="size-3 animate-spin" />}
                Open
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
