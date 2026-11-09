import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { ExternalLink, LogOut, UserRound } from "lucide-react";
import { Avatar, PLAN_NAMES, UsageMeters } from "@/components/AccountParts";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { accountSignOut, accountUsage, type AccountUsage } from "@/lib/tauri";
import { useAccountStore } from "@/store/account";
import { usePreviewStore } from "@/store/preview";

/**
 * The signed-in account at the toolbar's right end: the avatar opens
 * who is signed in, the plan with its usage, the account page and
 * Sign out. Nothing shows while signed out.
 */
export function AccountMenu() {
  const status = useAccountStore((s) => s.status);
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<AccountUsage | null>(null);

  useEffect(() => {
    void useAccountStore.getState().refresh();
  }, []);

  // Fresh numbers each time the menu opens: compiles add up meanwhile.
  const userId = status?.signedIn ? status.user?.id : undefined;
  useEffect(() => {
    if (!open || !userId) return;
    let live = true;
    accountUsage()
      .then((u) => live && setUsage(u))
      .catch(() => {
        // The menu still works; the meters wait for the next open.
      });
    return () => {
      live = false;
    };
  }, [open, userId]);

  if (!status?.signedIn) return null;
  const user = status.user;
  const plan = user?.plan ? PLAN_NAMES[user.plan] : null;
  const links = usage?.reviewLinks;

  async function signOut() {
    try {
      await accountSignOut();
      setUsage(null);
    } catch (e) {
      usePreviewStore.getState().setNotice(String(e));
    }
    await useAccountStore.getState().refresh();
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ml-1 rounded-full outline-hidden ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          title={user ? `${user.name} (${user.email})` : "Polemic account"}
          aria-label="Polemic account"
        >
          <Avatar name={user?.name} photo={status.avatar} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex items-center gap-3 px-3 pt-2 pb-3">
          <Avatar name={user?.name} photo={status.avatar} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name ?? "Signed in"}</p>
            {user && (
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            )}
          </div>
          {plan && <Badge variant="secondary">{plan}</Badge>}
        </div>
        {status.problem && (
          <p className="px-3 pb-3 text-xs text-muted-foreground">{status.problem}</p>
        )}
        {usage && (
          <>
            <DropdownMenuSeparator className="mt-0" />
            <div className="px-3 py-2">
              <UsageMeters usage={usage} className="space-y-3" />
              {links && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {links.limit === null
                    ? "Unlimited review links"
                    : `${links.count} of ${links.limit} active review ${links.limit === 1 ? "link" : "links"}`}
                </p>
              )}
            </div>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void openUrl(`${status.server}/account`)}>
          <UserRound />
          Manage account
          <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
