import { useState } from "react";
import { Loader2, Mail, X } from "lucide-react";
import { Avatar } from "@/components/AccountParts";
import { InviteForm, ROLE_LABELS } from "@/components/ShareParts";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Share } from "@/hooks/useShare";
import {
  shareCancelInvite,
  shareMembers,
  shareRemoveMember,
  shareSetRole,
  type InviteRole,
} from "@/lib/tauri";
import { useAccountStore } from "@/store/account";

/**
 * Who works on the project, for its owner: a form to invite someone by
 * email, then the owner, the members with their role and the open
 * invites.
 */
export function SharePeople({ share }: { share: Share }) {
  const account = useAccountStore((s) => s.status);
  const [busy, setBusy] = useState<string | null>(null);
  const { dir, people } = share;
  if (!dir || !people) return null;

  const run = (key: string, action: () => Promise<unknown>) =>
    share.attempt(async () => {
      setBusy(key);
      try {
        await action();
        share.setPeople(await shareMembers(dir));
      } finally {
        setBusy(null);
      }
    });

  const empty = people.members.length === 0 && people.invites.length === 0;
  const me = account?.signedIn ? account.user : null;

  return (
    <section className="space-y-2.5">
      <h3 className="text-sm font-medium">People</h3>
      <InviteForm share={share} />
      {empty ? (
        <p className="text-xs text-muted-foreground">
          Invite co-authors to edit, or a supervisor to comment.
        </p>
      ) : (
        <ul className="space-y-2.5 pt-1">
          {me && (
            <li className="flex items-center gap-2.5">
              <Avatar name={me.name} photo={account?.avatar} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {me.name} (you)
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {me.email}
                </span>
              </span>
              <span className="w-32 px-2.5 text-xs text-muted-foreground">Owner</span>
              <span className="size-6 shrink-0" aria-hidden />
            </li>
          )}
          {people.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2.5">
              <Avatar name={m.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{m.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {m.email}
                </span>
              </span>
              <Select
                value={m.role}
                disabled={busy !== null}
                onValueChange={(v) =>
                  void run(m.userId, () => shareSetRole(dir, m.userId, v as InviteRole))
                }
              >
                <SelectTrigger
                  className="h-7 w-32 text-xs"
                  aria-label={`What ${m.name} can do`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
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
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove ${m.name}`}
                title="Remove from the project"
                disabled={busy !== null}
                onClick={() =>
                  void run(m.userId, () => shareRemoveMember(dir, m.userId))
                }
              >
                {busy === m.userId ? <Loader2 className="animate-spin" /> : <X />}
              </Button>
            </li>
          ))}
          {people.invites.map((i) => (
            <li key={i.id} className="flex items-center gap-2.5">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground"
                aria-hidden
              >
                <Mail className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{i.email}</span>
                <span className="block text-xs text-muted-foreground">
                  Invited · {ROLE_LABELS[i.role].toLowerCase()}
                </span>
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Cancel the invite for ${i.email}`}
                title="Cancel invite"
                disabled={busy !== null}
                onClick={() => void run(i.id, () => shareCancelInvite(dir, i.id))}
              >
                {busy === i.id ? <Loader2 className="animate-spin" /> : <X />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
