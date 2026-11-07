import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { type PublishedSnapshot } from "@/lib/share";
import {
  isShareError,
  shareCreate,
  shareCreateLink,
  shareDeleteLink,
  shareLinks,
  sharePublish,
  shareSnapshots,
  shareStatus,
  shareStop,
  type ReviewLink,
  type ShareError,
  type ShareStatus,
} from "@/lib/tauri";
import { features } from "@/lib/target";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";
import { useLinkStore, type LinkStatus } from "@/store/link";

const link = "underline underline-offset-2 hover:text-foreground";

type Step = "sharing" | "syncing" | "publishing";

const STEP_LABELS: Record<Step, string> = {
  sharing: "Sharing…",
  syncing: "Syncing…",
  publishing: "Publishing…",
};

/** The sync's state in words, for the Share dialog. */
function syncLine(status: LinkStatus | null): string {
  switch (status?.kind) {
    case undefined:
    case "syncing":
      return "Syncing…";
    case "synced":
      return "Synced. Saved changes appear in your browser within seconds.";
    case "offline":
      return "Offline. Your changes stay on this computer and sync when you're back online.";
    case "signedOut":
      return "Sign in to your Polemic account to sync.";
    case "full":
    case "failed":
      return status.message;
  }
}

const EXPIRY = [
  { value: "never", label: "No expiry", days: null },
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
] as const;

function toShareError(e: unknown): ShareError {
  if (isShareError(e)) return e;
  return { kind: "failed", message: typeof e === "string" ? e : String(e) };
}

interface ShareState {
  status: ShareStatus;
  latest: PublishedSnapshot | null;
  links: ReviewLink[];
}

/** The folder's link, then, when shared, its latest version and links. */
async function loadShare(dir: string): Promise<ShareState> {
  const status = await shareStatus(dir);
  if (!status.signedIn || !status.link) return { status, latest: null, links: [] };
  const [snapshots, links] = await Promise.all([shareSnapshots(dir), shareLinks(dir)]);
  return { status, latest: snapshots[0] ?? null, links };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Share for review. On the desktop, sharing links the folder with a
 * copy on the account's server that syncs both ways (store/link.ts),
 * so the project also opens in the browser. Publishing fixes the
 * version reviewers see, with the PDF of the last compile, and the
 * review links open it. The folder stays the place you work.
 */
export function ShareDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* Mounted while open, so each opening starts fresh. */}
        <ShareBody />
      </DialogContent>
    </Dialog>
  );
}

function ShareBody() {
  const project = useProjectStore((s) => s.project);
  const mainFile = useProjectStore((s) => s.mainFile);
  const openSettings = useSettingsStore((s) => s.openSettings);

  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [latest, setLatest] = useState<PublishedSnapshot | null>(null);
  const [links, setLinks] = useState<ReviewLink[]>([]);
  const [step, setStep] = useState<Step | null>(null);
  const linkStatus = useLinkStore((s) => s.status);
  const [busy, setBusy] = useState<"link" | "stop" | null>(null);
  const [error, setError] = useState<ShareError | null>(null);
  const [role, setRole] = useState<ReviewLink["role"]>("commenter");
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]["value"]>("never");
  const [created, setCreated] = useState<ReviewLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const dir = project?.path ?? null;

  const show = useCallback((state: ShareState) => {
    setStatus(state.status);
    setLatest(state.latest);
    setLinks(state.links);
  }, []);

  const refresh = useCallback(async () => {
    if (dir) show(await loadShare(dir));
  }, [dir, show]);

  useEffect(() => {
    if (!dir) return;
    let live = true;
    loadShare(dir)
      .then((state) => live && show(state))
      .catch(async (e) => {
        if (!live) return;
        setError(toShareError(e));
        // A server copy deleted elsewhere: the link is gone; show that state.
        const status = await shareStatus(dir).catch(() => null);
        if (live) setStatus(status);
      });
    return () => {
      live = false;
    };
  }, [dir, show]);

  async function attempt(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(toShareError(e));
      await refresh().catch(() => {});
    }
  }

  /** Links the folder with a server copy that syncs both ways. */
  async function linkFolder() {
    if (!dir || !project) return;
    setStep("sharing");
    await shareCreate(dir, project.name);
    await useLinkStore.getState().start(dir);
    await refresh();
  }

  const share = () =>
    attempt(async () => {
      try {
        await linkFolder();
      } finally {
        setStep(null);
      }
    });

  const publish = () =>
    attempt(async () => {
      if (!dir || !project) return;
      try {
        // The browser's project is the server's: nothing to sync first.
        if (features.localFiles) {
          if (status?.link) {
            setStep("syncing");
            await useLinkStore.getState().syncNow();
          } else {
            await linkFolder();
          }
          const synced = useLinkStore.getState().status;
          if (synced?.kind !== "synced") {
            throw {
              kind: synced?.kind === "signedOut" ? "signedOut" : "failed",
              message: `Your latest changes haven't synced yet, so they can't be published. ${syncLine(synced)}`,
            } satisfies ShareError;
          }
        }
        setStep("publishing");
        const snapshot = await sharePublish(dir, mainFile);
        setLatest(snapshot);
        await refresh();
      } finally {
        setStep(null);
      }
    });

  const createLink = () =>
    attempt(async () => {
      if (!dir) return;
      setBusy("link");
      try {
        const days = EXPIRY.find((e) => e.value === expiry)?.days ?? null;
        const made = await shareCreateLink(dir, role, days);
        setCreated(made);
        setCopied(false);
        setLinks(await shareLinks(dir));
      } finally {
        setBusy(null);
      }
    });

  const deleteLink = (id: string) =>
    attempt(async () => {
      if (!dir) return;
      await shareDeleteLink(dir, id);
      if (created?.id === id) setCreated(null);
      setLinks(await shareLinks(dir));
    });

  const stop = () =>
    attempt(async () => {
      if (!dir) return;
      setBusy("stop");
      try {
        useLinkStore.getState().stop();
        await shareStop(dir);
        setConfirmStop(false);
        setCreated(null);
        await refresh();
      } finally {
        setBusy(null);
      }
    });

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => setCopied(true));
  };

  const accountPage = status ? `${status.server}/account` : null;
  const signedOut =
    status !== null && (!status.signedIn || error?.kind === "signedOut");
  const shared = status?.link != null;
  const publishing = step !== null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share for review</DialogTitle>
        <DialogDescription className="text-xs">
          {features.localFiles ? (
            <>
              Share this project with your Polemic account to open it in your browser and
              to give reviewers a link. Your files stay where they are, and the account
              keeps a copy in sync with them.
            </>
          ) : (
            <>
              Publish this project so reviewers can read the source and its PDF in a
              browser. They see the version you published last, with the PDF of your
              last compile.
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      {status === null && error === null && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      )}

      {signedOut && (
        <p className="text-xs text-muted-foreground">
          Sharing needs a free Polemic account.{" "}
          <button
            type="button"
            className={link}
            onClick={() => openSettings("account")}
          >
            Sign in
          </button>{" "}
          first.
        </p>
      )}

      {status !== null && !signedOut && (
        <div className="space-y-4">
          {features.localFiles && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium">Sync</h3>
              {shared ? (
                <>
                  <p className="text-xs text-muted-foreground" role="status">
                    {syncLine(linkStatus)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void openUrl(`${status.server}/projects/${status.link!.projectId}`)
                      }
                    >
                      Open in your browser
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={linkStatus?.kind === "syncing"}
                      onClick={() => void useLinkStore.getState().syncNow()}
                    >
                      Sync now
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Not shared yet. Saved changes sync both ways once you share: what you
                    save here appears in your browser, and changes made there arrive in this
                    folder.
                  </p>
                  <Button size="sm" disabled={step !== null} onClick={() => void share()}>
                    {step === "sharing" && <Loader2 className="size-3 animate-spin" />}
                    Share this project
                  </Button>
                </>
              )}
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-medium">Published version</h3>
            <p className="text-xs text-muted-foreground" role="status">
              {publishing
                ? STEP_LABELS[step]
                : latest
                  ? `Published ${formatDate(latest.createdAt)}.`
                  : "Not published yet."}
              {!publishing && latest && latest.pdf === null && (
                <>
                  {" "}
                  No PDF went with it: compile, then publish again so reviewers see one.
                </>
              )}
            </p>
            <Button size="sm" disabled={publishing} onClick={() => void publish()}>
              {publishing && <Loader2 className="size-3 animate-spin" />}
              {latest ? "Publish again" : "Publish for review"}
            </Button>
          </section>

          {shared && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium">Review links</h3>
              {links.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No links yet. A link opens the published version; anyone who has it
                  can read, and with Can comment, comment.
                </p>
              ) : (
                <ul className="divide-y rounded-md border text-xs">
                  {links.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 px-2 py-1.5">
                      <span className="font-medium">
                        {l.role === "commenter" ? "Can comment" : "Can view"}
                      </span>
                      <span className="flex-1 text-muted-foreground">
                        made {formatDate(l.createdAt)}
                        {l.expiresAt ? `, expires ${formatDate(l.expiresAt)}` : ""}
                      </span>
                      {l.active === false && (
                        <span
                          className="rounded-full border px-1.5 text-[10px] text-muted-foreground"
                          title="Your plan includes fewer active review links than you have. Delete a link, or upgrade on your account page."
                        >
                          Paused
                        </span>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        aria-label="Delete link"
                        title="Delete link: it stops working"
                        onClick={() => void deleteLink(l.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {created?.url && (
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      className="h-7 min-w-0 flex-1 font-mono text-xs"
                      value={created.url}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button
                      size="sm"
                      className="h-7"
                      onClick={() => copy(created.url!)}
                    >
                      {copied ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    Copy it now: the server keeps only a fingerprint, so the link is
                    shown once.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as ReviewLink["role"])}
                >
                  <SelectTrigger
                    className="h-7 text-xs"
                    aria-label="What the link allows"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commenter">Can comment</SelectItem>
                    <SelectItem value="viewer">Can view</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={expiry}
                  onValueChange={(v) =>
                    setExpiry(v as (typeof EXPIRY)[number]["value"])
                  }
                >
                  <SelectTrigger
                    className="h-7 text-xs"
                    aria-label="When the link expires"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={busy === "link" || latest === null}
                  title={latest === null ? "Publish first" : undefined}
                  onClick={() => void createLink()}
                >
                  {busy === "link" && <Loader2 className="size-3 animate-spin" />}
                  Create link
                </Button>
              </div>
            </section>
          )}

          {/* In the browser, the server's copy is the project itself. */}
          {shared && features.localFiles && (
            <section className="space-y-2 border-t pt-3">
              {confirmStop ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Delete the server copy, its published versions and every review
                    link? The project no longer opens in your browser. Your files stay as
                    they are.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy === "stop"}
                      onClick={() => void stop()}
                    >
                      {busy === "stop" && <Loader2 className="size-3 animate-spin" />}
                      Stop sharing
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmStop(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                  onClick={() => setConfirmStop(true)}
                >
                  Stop sharing…
                </button>
              )}
            </section>
          )}
        </div>
      )}

      {error !== null && error.kind !== "signedOut" && (
        <p className="text-xs text-destructive" role="alert">
          {error.message}
          {(error.kind === "planRequired" || error.kind === "limitReached") && accountPage && (
            <>
              {" "}
              <button
                type="button"
                className={link}
                onClick={() => void openUrl(accountPage)}
              >
                See plans
              </button>
            </>
          )}
        </p>
      )}
    </>
  );
}
