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
import { SharePeople, ROLE_LABELS } from "@/components/SharePeople";
import { type PublishedSnapshot } from "@/lib/share";
import {
  isShareError,
  shareCreate,
  shareCreateLink,
  shareDeleteLink,
  shareInfo,
  shareLeave,
  shareLinks,
  shareMembers,
  sharePublish,
  shareSnapshots,
  shareStatus,
  shareStop,
  type AccountProject,
  type ProjectMembers,
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
  /** The account's role and the owner; null while not shared. */
  info: AccountProject | null;
  latest: PublishedSnapshot | null;
  links: ReviewLink[];
  /** Members and invites, for the owner; null for others, or from a server without invites. */
  people: ProjectMembers | null;
}

/**
 * The folder's link, then, when shared, the account's role; for the
 * owner also the latest version, the links and the people.
 */
async function loadShare(dir: string): Promise<ShareState> {
  const status = await shareStatus(dir);
  const none = { status, info: null, latest: null, links: [], people: null };
  if (!status.signedIn || !status.link) return none;
  const info = await shareInfo(dir);
  if (info.role !== "owner") return { ...none, info };
  const [snapshots, links, people] = await Promise.all([
    shareSnapshots(dir),
    shareLinks(dir),
    shareMembers(dir).catch(() => null),
  ]);
  return { status, info, latest: snapshots[0] ?? null, links, people };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Share. On the desktop, sharing links the folder with a copy on the
 * account's server that syncs both ways (store/link.ts), so the
 * project also opens in the browser. The owner invites people to edit
 * or comment; publishing fixes the version reviewers see, with the PDF
 * of the last compile, and the review links open it. The folder stays
 * the place you work. Someone invited sees whose project it is and can
 * leave it.
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

  const leaveProject = useProjectStore((s) => s.leaveProject);
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [info, setInfo] = useState<AccountProject | null>(null);
  const [people, setPeople] = useState<ProjectMembers | null>(null);
  const [latest, setLatest] = useState<PublishedSnapshot | null>(null);
  const [links, setLinks] = useState<ReviewLink[]>([]);
  const [step, setStep] = useState<Step | null>(null);
  const linkStatus = useLinkStore((s) => s.status);
  const [busy, setBusy] = useState<"link" | "stop" | "leave" | null>(null);
  const [error, setError] = useState<ShareError | null>(null);
  const [role, setRole] = useState<ReviewLink["role"]>("commenter");
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]["value"]>("never");
  const [created, setCreated] = useState<ReviewLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const dir = project?.path ?? null;

  const show = useCallback((state: ShareState) => {
    setStatus(state.status);
    setInfo(state.info);
    setLatest(state.latest);
    setLinks(state.links);
    setPeople(state.people);
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

  /** Someone invited leaves: the server copy stays the owner's; the folder stays as it is. */
  const leave = () =>
    attempt(async () => {
      if (!dir) return;
      setBusy("leave");
      try {
        useLinkStore.getState().stop();
        await shareLeave(dir);
        setConfirmLeave(false);
        // In the browser the project was the server's: back to the list.
        if (!features.localFiles) {
          await leaveProject();
          return;
        }
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
  // Before sharing, the folder is this account's to share.
  const owner = !shared || info?.role === "owner";
  const invited = shared && info !== null && info.role !== "owner";
  const publishing = step !== null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share</DialogTitle>
        <DialogDescription className="text-xs">
          {invited ? (
            <>
              {info.owner?.name ?? "Someone"} shared this project with you.{" "}
              {info.writable
                ? "You can edit it, and your changes reach everyone working on it."
                : "You can read it and comment on it."}
            </>
          ) : features.localFiles ? (
            <>
              Share this project with your Polemic account to open it in your browser,
              invite people to work on it and give reviewers a link. Your files stay
              where they are, and the account keeps a copy in sync with them.
            </>
          ) : (
            <>
              Invite people to work on this project, or publish it so reviewers can read
              the source and its PDF in a browser. Reviewers see the version you
              published last, with the PDF of your last compile.
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
                        void openUrl(
                          `${status.server}/projects/${status.link!.projectId}`,
                        )
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
                    Not shared yet. Saved changes sync both ways once you share: what
                    you save here appears in your browser, and changes made there arrive
                    in this folder.
                  </p>
                  <Button
                    size="sm"
                    disabled={step !== null}
                    onClick={() => void share()}
                  >
                    {step === "sharing" && <Loader2 className="size-3 animate-spin" />}
                    Share this project
                  </Button>
                </>
              )}
            </section>
          )}

          {shared && owner && people && dir && (
            <SharePeople
              dir={dir}
              people={people}
              onChange={setPeople}
              attempt={attempt}
            />
          )}

          {invited && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium">Your role</h3>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[info.role === "owner" ? "editor" : info.role]}. Only{" "}
                {info.owner?.name ?? "the owner"} can invite people, publish and make
                review links.
              </p>
            </section>
          )}

          {owner && (
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
                    No PDF went with it: compile, then publish again so reviewers see
                    one.
                  </>
                )}
              </p>
              <Button size="sm" disabled={publishing} onClick={() => void publish()}>
                {publishing && <Loader2 className="size-3 animate-spin" />}
                {latest ? "Publish again" : "Publish for review"}
              </Button>
            </section>
          )}

          {shared && owner && (
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
          {invited && (
            <section className="space-y-2 border-t pt-3">
              {confirmLeave ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Leave {info.owner?.name ?? "the owner"}&apos;s project?{" "}
                    {features.localFiles
                      ? "This folder stops syncing and keeps its files."
                      : "It leaves your list of projects."}{" "}
                    Only the owner can invite you again.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy === "leave"}
                      onClick={() => void leave()}
                    >
                      {busy === "leave" && <Loader2 className="size-3 animate-spin" />}
                      Leave project
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmLeave(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                  onClick={() => setConfirmLeave(true)}
                >
                  Leave project…
                </button>
              )}
            </section>
          )}

          {shared && owner && features.localFiles && (
            <section className="space-y-2 border-t pt-3">
              {confirmStop ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Delete the server copy, its published versions and every review
                    link? The project no longer opens in your browser, and people you
                    invited lose it. Your files stay as they are.
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
          {(error.kind === "planRequired" || error.kind === "limitReached") &&
            accountPage && (
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
