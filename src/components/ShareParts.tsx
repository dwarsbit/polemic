import { useEffect, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STEP_LABELS, formatShareDate, type Share } from "@/hooks/useShare";
import { shareInvite, shareMembers, type InviteRole } from "@/lib/tauri";
import { features } from "@/lib/target";
import { useLinkStore } from "@/store/link";
import { useSettingsStore } from "@/store/settings";
import { cn } from "cn";

export const ROLE_LABELS: Record<InviteRole | "viewer", string> = {
  editor: "Can edit",
  commenter: "Can comment",
  viewer: "Can view",
};

const link = "underline underline-offset-2 hover:text-foreground";

/** A plain check: the server says what it refuses. */
const looksLikeEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** True for a moment after `mark()`: a copy button says "Copied". */
export function useCopied<T = true>(): [T | null, (what: T) => void] {
  const [copied, setCopied] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [
    copied,
    (what) => {
      setCopied(what);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2000);
    },
  ];
}

/** Invites someone by email, to edit or to comment. */
export function InviteForm({ share }: { share: Share }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { dir } = share;

  const invite = () =>
    share.attempt(async () => {
      if (!dir) return;
      const address = email.trim();
      setSentTo(null);
      setBusy(true);
      try {
        await shareInvite(dir, address, role);
        setEmail("");
        setSentTo(address);
        share.setPeople(await shareMembers(dir));
      } finally {
        setBusy(false);
      }
    });

  return (
    <div className="space-y-1.5">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && looksLikeEmail(email)) void invite();
        }}
      >
        <Input
          type="email"
          className="h-7 min-w-0 flex-1 text-xs"
          placeholder="name@university.edu"
          aria-label="Email address to invite"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setSentTo(null);
          }}
        />
        <Select value={role} onValueChange={(v) => setRole(v as InviteRole)}>
          <SelectTrigger className="h-7 text-xs" aria-label="What they can do">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="editor">{ROLE_LABELS.editor}</SelectItem>
            <SelectItem value="commenter">{ROLE_LABELS.commenter}</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={busy || !looksLikeEmail(email)}>
          {busy && <Loader2 className="size-3 animate-spin" />}
          Invite
        </Button>
      </form>
      {sentTo && (
        <p
          className="flex items-center gap-1 text-xs text-muted-foreground"
          role="status"
        >
          <Check className="size-3 text-success" />
          Invite sent to {sentTo}
        </p>
      )}
    </div>
  );
}

/** When the project was published last, with Publish again. */
export function PublishedLine({
  share,
  className,
}: {
  share: Share;
  className?: string;
}) {
  const { latest, step } = share;
  if (!latest && !step) return null;
  return (
    <p className={cn("text-xs text-muted-foreground", className)} role="status">
      {step ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-3 animate-spin" />
          {STEP_LABELS[step]}
        </span>
      ) : (
        latest && (
          <>
            Last published {formatShareDate(latest.createdAt)}
            {latest.pdf === null ? ", without a PDF: compile first. " : ". "}
            <button
              type="button"
              className={cn(link, "text-foreground")}
              onClick={() => void share.publish()}
            >
              Publish again
            </button>
          </>
        )
      )}
    </p>
  );
}

/** What went wrong, with the plans where a plan is the way out. */
export function ShareProblem({ share }: { share: Share }) {
  const { error, accountPage } = share;
  if (error === null || error.kind === "signedOut") return null;
  return (
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
  );
}

/** Why the project isn't in sync, with a way out; nothing while it is. */
export function SyncNotice({ share }: { share: Share }) {
  const openSettings = useSettingsStore((s) => s.openSettings);
  const status = share.linkStatus;
  if (!features.localFiles || !share.shared || !status) return null;
  if (status.kind === "synced" || status.kind === "syncing") return null;
  return (
    <p className="rounded-md bg-warning/10 px-3 py-2 text-xs" role="status">
      {status.kind === "offline"
        ? "You're offline. Your changes sync when you're back online."
        : status.kind === "signedOut"
          ? "Sign in to keep this project in sync."
          : status.message}{" "}
      {status.kind === "signedOut" ? (
        <button type="button" className={link} onClick={() => openSettings("account")}>
          Sign in
        </button>
      ) : (
        <button
          type="button"
          className={link}
          onClick={() => void useLinkStore.getState().syncNow()}
        >
          Try again
        </button>
      )}
    </p>
  );
}

/** Before sharing: what it gives, and the one step that starts it. */
export function ShareStart({ share }: { share: Share }) {
  const openSettings = useSettingsStore((s) => s.openSettings);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Work on this project with co-authors, send reviewers a link and open it in your
        browser.
        {share.signedOut && " Sharing needs a free Polemic account."}
      </p>
      {share.signedOut ? (
        <Button size="sm" onClick={() => openSettings("account")}>
          Sign in
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={share.step !== null}
          onClick={() => void share.share()}
        >
          {share.step === "sharing" && <Loader2 className="size-3 animate-spin" />}
          Share project
        </Button>
      )}
    </div>
  );
}

/** A step that takes something away, asked once more before it happens. */
export function Confirm({
  children,
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  children: ReactNode;
  /** The button's label: the action by name. */
  action: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{children}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={busy} onClick={onConfirm}>
          {busy && <Loader2 className="size-3 animate-spin" />}
          {action}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Asks someone invited whether to leave, then leaves. */
export function LeaveConfirm({
  share,
  onCancel,
}: {
  share: Share;
  onCancel: () => void;
}) {
  const owner = share.info?.owner?.name;
  return (
    <Confirm
      action="Leave project"
      busy={share.busy === "leave"}
      onConfirm={() => void share.leave()}
      onCancel={onCancel}
    >
      Leave {owner ? `${owner}’s` : "this"} project?{" "}
      {features.localFiles
        ? "Your copy stays on this computer and no longer gets changes."
        : "You no longer see it in your projects."}{" "}
      Only {owner ?? "the owner"} can invite you again.
    </Confirm>
  );
}

/** What someone invited can do, in a sentence. */
export function invitedLine(share: Share): string {
  return share.info?.writable
    ? "You can edit this project, and your changes reach everyone working on it."
    : "You can read this project and comment on it.";
}
