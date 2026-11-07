import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  shareCancelInvite,
  shareInvite,
  shareMembers,
  shareRemoveMember,
  shareSetRole,
  type InviteRole,
  type ProjectMembers,
} from "@/lib/tauri";

export const ROLE_LABELS: Record<InviteRole | "viewer", string> = {
  editor: "Can edit",
  commenter: "Can comment",
  viewer: "Can view",
};

/** A plain check: the server says what it refuses. */
const looksLikeEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Who works on the project, for its owner: members with their role,
 * open invites, and a form to invite someone by email. Editors need
 * only a free account, and what they add counts against the owner's
 * storage.
 */
export function SharePeople({
  dir,
  people,
  onChange,
  attempt,
}: {
  dir: string;
  people: ProjectMembers;
  onChange: (people: ProjectMembers) => void;
  /** Runs an action, showing its error in the dialog. */
  attempt: (action: () => Promise<void>) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [busy, setBusy] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const reload = async () => onChange(await shareMembers(dir));

  const run = (key: string, action: () => Promise<void>) =>
    attempt(async () => {
      setBusy(key);
      try {
        await action();
      } finally {
        setBusy(null);
      }
    });

  const invite = () =>
    run("invite", async () => {
      const address = email.trim();
      setSentTo(null);
      await shareInvite(dir, address, role);
      setEmail("");
      setSentTo(address);
      await reload();
    });

  const empty = people.members.length === 0 && people.invites.length === 0;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium">People</h3>
      {empty ? (
        <p className="text-xs text-muted-foreground">
          Invite a co-author or supervisor by email. Editors work on the project in
          their own desktop app or browser with a free account, and what they add counts
          toward your storage.
        </p>
      ) : (
        <ul className="divide-y rounded-md border text-xs">
          {people.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.name}</span>
                <span className="block truncate text-muted-foreground">{m.email}</span>
              </span>
              <Select
                value={m.role}
                disabled={busy !== null}
                onValueChange={(v) =>
                  void run(m.userId, async () => {
                    await shareSetRole(dir, m.userId, v as InviteRole);
                    await reload();
                  })
                }
              >
                <SelectTrigger
                  className="h-7 w-32 text-xs"
                  aria-label={`What ${m.name} can do`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">{ROLE_LABELS.editor}</SelectItem>
                  <SelectItem value="commenter">{ROLE_LABELS.commenter}</SelectItem>
                  {m.role === "viewer" && (
                    <SelectItem value="viewer" disabled>
                      {ROLE_LABELS.viewer}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label={`Remove ${m.name}`}
                title="Remove from the project"
                disabled={busy !== null}
                onClick={() =>
                  void run(m.userId, async () => {
                    await shareRemoveMember(dir, m.userId);
                    await reload();
                  })
                }
              >
                {busy === m.userId ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <X className="size-3" />
                )}
              </Button>
            </li>
          ))}
          {people.invites.map((i) => (
            <li key={i.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{i.email}</span>
                <span className="block text-muted-foreground">
                  Invited · {ROLE_LABELS[i.role].toLowerCase()}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={busy !== null}
                onClick={() =>
                  void run(i.id, async () => {
                    await shareCancelInvite(dir, i.id);
                    await reload();
                  })
                }
              >
                {busy === i.id && <Loader2 className="size-3 animate-spin" />}
                Cancel invite
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (looksLikeEmail(email)) void invite();
        }}
      >
        <Input
          type="email"
          className="h-7 min-w-0 flex-1 text-xs"
          placeholder="Email address"
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
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={busy !== null || !looksLikeEmail(email)}
        >
          {busy === "invite" && <Loader2 className="size-3 animate-spin" />}
          Invite
        </Button>
      </form>
      {sentTo && (
        <p className="text-2xs text-muted-foreground" role="status">
          Invite sent to {sentTo}. The link in it works for 14 days.
        </p>
      )}
    </section>
  );
}
