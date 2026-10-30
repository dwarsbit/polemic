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
import {
  publishApi,
  publishForReview,
  type PublishedSnapshot,
  type PublishStep,
} from "@/lib/share";
import {
  isShareError,
  shareCreateLink,
  shareDeleteLink,
  shareLinks,
  shareSnapshots,
  shareStatus,
  shareStop,
  type ReviewLink,
  type ShareError,
  type ShareStatus,
} from "@/lib/tauri";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

const link = "underline underline-offset-2 hover:text-foreground";

const STEP_LABELS: Record<PublishStep, string> = {
  reading: "Reading the project…",
  uploading: "Uploading…",
  publishing: "Publishing…",
};

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
 * Share for review (Professional): publishes the project one way to the
 * account's server, with the PDF of the last compile, and manages the
 * review links that open it in a browser. The folder stays the source
 * of truth; publishing again replaces the version reviewers see.
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
  const [step, setStep] = useState<PublishStep | null>(null);
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

  const publish = () =>
    attempt(async () => {
      if (!dir || !project) return;
      try {
        const snapshot = await publishForReview(
          publishApi(dir),
          { name: project.name, main: mainFile },
          setStep,
        );
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
          Publish this project to {status?.server ?? "your Polemic server"} so reviewers
          can read the source and its PDF in a browser. Your files stay where they are;
          the server keeps a copy for the links.
        </DialogDescription>
      </DialogHeader>

      {status === null && error === null && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      )}

      {signedOut && (
        <p className="text-xs text-muted-foreground">
          Sharing is part of Polemic Professional.{" "}
          <button
            type="button"
            className={link}
            onClick={() => openSettings("account")}
          >
            Sign in
          </button>{" "}
          to your Polemic account first.
        </p>
      )}

      {status !== null && !signedOut && (
        <div className="space-y-4">
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

          {shared && (
            <section className="space-y-2 border-t pt-3">
              {confirmStop ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Delete the server copy, its published versions and every review
                    link? Your files stay as they are.
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
          {error.kind === "planRequired" && accountPage && (
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
