import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, ExternalLink, Link2, Loader2, Trash2 } from "lucide-react";
import { SharePeople } from "@/components/SharePeople";
import {
  Confirm,
  LeaveConfirm,
  PublishedLine,
  ROLE_LABELS,
  ShareProblem,
  ShareStart,
  SyncNotice,
  useCopied,
} from "@/components/ShareParts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copyText, useShare, type Share } from "@/hooks/useShare";
import { type ReviewLink } from "@/lib/tauri";
import { features } from "@/lib/target";

const EXPIRY = [
  { value: "never", label: "No expiry", days: null },
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
] as const;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/**
 * Share, in full: the people, the review links and what reviewers see,
 * and stopping or leaving. The toolbar's Share button covers the quick
 * steps (SharePopover.tsx); both work through useShare.
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
      <DialogContent className="gap-5">
        {/* Mounted while open, so each opening starts fresh. */}
        <ShareBody />
      </DialogContent>
    </Dialog>
  );
}

function ShareBody() {
  const share = useShare();
  const [confirm, setConfirm] = useState<"stop" | "leave" | null>(null);
  const { status, info, invited, owner, shared, projectPage } = share;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share</DialogTitle>
        <DialogDescription className="text-xs">
          {invited
            ? `${info?.owner?.name ?? "Someone"} shared this project with you.`
            : "Invite people to work on this project, or send reviewers a link."}
        </DialogDescription>
      </DialogHeader>

      {share.loading && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      )}

      {status !== null && (share.signedOut || (!shared && features.localFiles)) && (
        <ShareStart share={share} />
      )}

      {status !== null && !share.signedOut && shared && (
        <>
          <SyncNotice share={share} />
          {owner && <SharePeople share={share} />}
          {owner && <ReviewLinks share={share} />}

          {invited && (
            <section className="space-y-1">
              <h3 className="text-sm font-medium">Your role</h3>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[!info || info.role === "owner" ? "editor" : info.role]}.
                Only {info?.owner?.name ?? "the owner"} can invite people and make
                review links.
              </p>
            </section>
          )}

          {confirm === "leave" ? (
            <div className="border-t pt-4">
              <LeaveConfirm share={share} onCancel={() => setConfirm(null)} />
            </div>
          ) : confirm === "stop" ? (
            <div className="border-t pt-4">
              <Confirm
                action="Stop sharing"
                busy={share.busy === "stop"}
                onConfirm={() => void share.stop().then(() => setConfirm(null))}
                onCancel={() => setConfirm(null)}
              >
                Stop sharing this project? People you invited lose access, its review
                links stop working and it no longer opens in your browser. Your files
                stay on this computer.
              </Confirm>
            </div>
          ) : (
            (projectPage || invited || features.localFiles) && (
              <div className="flex items-center justify-between gap-2 border-t pt-4">
                {projectPage ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openUrl(projectPage)}
                  >
                    <ExternalLink />
                    Open in browser
                  </Button>
                ) : (
                  <span />
                )}
                {/* In the browser, the server's copy is the project itself. */}
                {invited ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirm("leave")}
                  >
                    Leave project…
                  </Button>
                ) : (
                  features.localFiles && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirm("stop")}
                    >
                      Stop sharing…
                    </Button>
                  )
                )}
              </div>
            )
          )}
        </>
      )}

      <ShareProblem share={share} />
    </>
  );
}

/** The review links, a way to make one, and when the project was published. */
function ReviewLinks({ share }: { share: Share }) {
  const [role, setRole] = useState<ReviewLink["role"]>("commenter");
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]["value"]>("never");
  const [copied, markCopied] = useCopied<string>();
  const { links, urls } = share;
  const working = share.busy === "link";

  async function copy(id: string, url: string) {
    if (await copyText(url)) markCopied(id);
  }

  async function create() {
    const days = EXPIRY.find((e) => e.value === expiry)?.days ?? null;
    const made = await share.createLink(role, days);
    if (made?.url) await copy(made.id, made.url);
  }

  return (
    <section className="space-y-2.5">
      <h3 className="text-sm font-medium">Review links</h3>
      <p className="text-xs text-muted-foreground">
        Anyone with a link can read what you published last in their browser.
      </p>

      {links.length > 0 && (
        <ul className="space-y-2.5 pt-1">
          {links.map((l) => {
            const url = urls[l.id];
            return (
              <li key={l.id} className="flex items-center gap-2.5">
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  aria-hidden
                >
                  <Link2 className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    {ROLE_LABELS[l.role]}
                    {l.active === false && (
                      <span
                        className="rounded-full border px-1.5 text-[10px] font-normal text-muted-foreground"
                        title="Your plan includes fewer active review links than you have. Delete a link, or upgrade on your account page."
                      >
                        Paused
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Made {day(l.createdAt)}
                    {l.expiresAt ? ` · expires ${day(l.expiresAt)}` : " · no expiry"}
                    {!url && " · can’t be copied on this device"}
                  </span>
                </span>
                {url && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void copy(l.id, url)}
                  >
                    {copied === l.id ? <Check /> : <Copy />}
                    {copied === l.id ? "Copied" : "Copy link"}
                  </Button>
                )}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Delete link"
                  title="Delete link: it stops working"
                  onClick={() => void share.deleteLink(l.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={role} onValueChange={(v) => setRole(v as ReviewLink["role"])}>
          <SelectTrigger className="h-7 text-xs" aria-label="What the link allows">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="commenter">{ROLE_LABELS.commenter}</SelectItem>
            <SelectItem value="viewer">{ROLE_LABELS.viewer}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={expiry}
          onValueChange={(v) => setExpiry(v as (typeof EXPIRY)[number]["value"])}
        >
          <SelectTrigger className="h-7 text-xs" aria-label="When the link expires">
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
          disabled={working || share.step !== null}
          onClick={() => void create()}
        >
          {working && <Loader2 className="size-3 animate-spin" />}
          Create link
        </Button>
      </div>

      <PublishedLine share={share} />
    </section>
  );
}
