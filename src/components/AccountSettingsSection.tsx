import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { ExternalLink, LogOut, MoreHorizontal, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatStorage } from "@/components/UsageSummary";
import { retryGrammar } from "@/lib/grammar-check";
import {
  accountCancelSignIn,
  accountSetServer,
  accountSignIn,
  accountSignOut,
  accountStatus,
  accountUsage,
  type AccountStatus,
  type AccountUsage,
  type AccountUser,
} from "@/lib/tauri";
import { initialsOf } from "@/store/settings";
import { cn } from "cn";

export const DEFAULT_ACCOUNT_SERVER = "https://app.polemicapp.com";
export const PRIVACY_POLICY_URL = "https://polemicapp.com/privacy";

const link = "underline underline-offset-2 hover:text-foreground";
const card = "rounded-xl border bg-card shadow-xs";

/** Plan names as the account page shows them; "professional" comes from servers before the current plans. */
const PLAN_NAMES: Record<NonNullable<AccountUser["plan"]>, string> = {
  free: "Free",
  student: "Student",
  pro: "Pro",
  professional: "Pro",
};

const minutes = (seconds: number) => Number((seconds / 60).toFixed(1));

/** The sign-in photo, else the initials on a primary circle, else a person icon. */
function Avatar({
  name,
  photo,
  large,
}: {
  name?: string;
  photo?: string | null;
  large?: boolean;
}) {
  const size = large ? "size-12 text-base" : "size-10 text-sm";
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", size)}
      />
    );
  }
  const initials = name ? initialsOf(name) : "";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        initials
          ? "bg-primary-fill text-white dark:bg-primary"
          : "bg-muted text-muted-foreground",
        size,
      )}
      aria-hidden
    >
      {initials || <UserRound className="size-5" />}
    </div>
  );
}

function Meter({
  label,
  value,
  share,
  full,
}: {
  label: string;
  value: string;
  share: number | null;
  full: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("tabular-nums", full && "text-warning")}>{value}</span>
      </div>
      {share !== null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              full ? "bg-warning" : "bg-primary-fill dark:bg-primary",
            )}
            style={{ width: `${Math.min(100, Math.max(2, share * 100))}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** The plan with storage and today's compile time, from GET /api/usage. */
function PlanSummary({
  plan,
  usage,
  onChangePlan,
}: {
  plan: string;
  usage: AccountUsage | null;
  onChangePlan: () => void;
}) {
  const links = usage?.reviewLinks;
  const { storage, compile } = usage ?? {};
  return (
    <div className="border-t px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{plan} plan</p>
          {links && (
            <p className="text-xs text-muted-foreground">
              {links.limit === null
                ? "Unlimited review links"
                : `${links.count} of ${links.limit} active review ${links.limit === 1 ? "link" : "links"}`}
            </p>
          )}
        </div>
        <Button variant="link" size="sm" className="px-0" onClick={onChangePlan}>
          Change plan
        </Button>
      </div>
      {storage && compile && (
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
          <Meter
            label="Storage"
            value={`${formatStorage(storage.usedBytes)} of ${formatStorage(storage.limitBytes)}`}
            share={storage.usedBytes / storage.limitBytes}
            full={storage.usedBytes >= storage.limitBytes}
          />
          {compile.limitSeconds === null ? (
            <Meter
              label="Compile time today"
              value={`${minutes(compile.usedSeconds)} minutes`}
              share={null}
              full={false}
            />
          ) : (
            <Meter
              label="Compile time today"
              value={`${minutes(compile.usedSeconds)} of ${minutes(compile.limitSeconds)} minutes`}
              share={compile.usedSeconds / compile.limitSeconds}
              full={compile.usedSeconds >= compile.limitSeconds}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The Polemic account: who is signed in, their plan and usage, and
 * sign-in through the browser. The server sits behind "Use custom
 * server". The token stays in the Rust side and the OS credential
 * store; this page only sees the user.
 */
export function AccountSettingsSection() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [server, setServer] = useState("");
  const [editingServer, setEditingServer] = useState(false);
  const [busy, setBusy] = useState<
    "loading" | "signing-in" | "signing-up" | "signing-out" | "saving" | null
  >("loading");
  const [error, setError] = useState<string | null>(null);

  function show(next: AccountStatus) {
    setStatus(next);
    setServer(next.server);
  }

  useEffect(() => {
    let live = true;
    accountStatus()
      .then((s) => live && show(s))
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setBusy(null));
    // A sign-in still waiting for the browser keeps going when the page
    // closes (it times out on its own); reopening the page shows the result.
    return () => {
      live = false;
    };
  }, []);

  const signedInUser = status?.signedIn ? status.user : null;
  useEffect(() => {
    if (!signedInUser?.plan) return;
    let live = true;
    accountUsage()
      .then((u) => live && setUsage(u))
      .catch(() => {
        // The plan still shows; the meters wait for the next visit.
      });
    return () => {
      live = false;
    };
  }, [signedInUser?.id, signedInUser?.plan]);

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const saveServer = () =>
    run("saving", async () => {
      show(await accountSetServer(server));
      setUsage(null);
      setEditingServer(false);
    });

  const signIn = (createAccount: boolean) =>
    run(createAccount ? "signing-up" : "signing-in", async () => {
      await accountSignIn(createAccount);
      show(await accountStatus());
      retryGrammar();
    });

  const signOut = () =>
    run("signing-out", async () => {
      await accountSignOut();
      setUsage(null);
      show(await accountStatus());
    });

  const openAccountPage = () => {
    if (status) void openUrl(`${status.server}/account`);
  };

  // An empty field means Polemic's online services.
  const typedServer = server.trim().replace(/\/+$/, "") || DEFAULT_ACCOUNT_SERVER;
  const serverChanged = status !== null && typedServer !== status.server;
  const customServer = status !== null && status.server !== DEFAULT_ACCOUNT_SERVER;
  const waiting = busy === "signing-in" || busy === "signing-up";

  let body;
  if (busy === "loading") {
    body = (
      <p className="px-4 py-4 text-sm text-muted-foreground">Checking your account…</p>
    );
  } else if (waiting) {
    body = (
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Waiting for the browser…</p>
          <p className="text-xs text-muted-foreground">
            {busy === "signing-up"
              ? "Create your account there and choose Allow. Then come back here."
              : "Sign in there and choose Allow. Then come back here."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void accountCancelSignIn()}>
          Cancel
        </Button>
      </div>
    );
  } else if (status?.signedIn) {
    const user = status.user;
    body = (
      <>
        <div className="flex items-center gap-3 px-4 py-4">
          <Avatar name={user?.name} photo={status.avatar} large />
          <div className="min-w-0 flex-1">
            {user ? (
              <>
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </>
            ) : (
              <p className="text-sm font-medium">Signed in</p>
            )}
            {status.problem && (
              <p className="text-xs text-muted-foreground">{status.problem}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={openAccountPage}
          >
            Manage account <ExternalLink data-icon="inline-end" className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="More account actions"
                disabled={busy !== null}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void signOut()}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {user?.plan && (
          <PlanSummary
            plan={PLAN_NAMES[user.plan]}
            usage={usage}
            onChangePlan={openAccountPage}
          />
        )}
      </>
    );
  } else {
    body = (
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Not signed in</p>
          <p className="text-xs text-muted-foreground">
            {status?.problem ??
              "Sign in for review links, grammar checking and cloud compile."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null || serverChanged}
          onClick={() => void signIn(true)}
        >
          Create account
        </Button>
        <Button
          size="sm"
          disabled={busy !== null || serverChanged}
          onClick={() => void signIn(false)}
        >
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className={card} aria-live="polite" aria-label="Polemic account">
        {body}
      </section>

      {status?.signedIn && busy === null && (
        <p className="px-1 text-xs text-muted-foreground">
          On your account page you can change your plan, see your signed-in devices,
          download your data or delete your account.
          {status.server === DEFAULT_ACCOUNT_SERVER && (
            <>
              {" "}
              <button
                type="button"
                className={link}
                onClick={() => void openUrl(PRIVACY_POLICY_URL)}
              >
                Privacy policy
              </button>
            </>
          )}
        </p>
      )}

      {editingServer ? (
        <section className={cn(card, "px-4 py-3")}>
          <label className="text-sm font-medium" htmlFor="account-server">
            Server
          </label>
          <div className="mt-2 flex gap-2">
            <Input
              id="account-server"
              autoFocus
              placeholder={DEFAULT_ACCOUNT_SERVER}
              value={server}
              disabled={waiting}
              onChange={(e) => setServer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && serverChanged) void saveServer();
                if (e.key === "Escape" && status) {
                  setServer(status.server);
                  setEditingServer(false);
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!serverChanged || busy !== null}
              onClick={() => void saveServer()}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy === "saving"}
              onClick={() => {
                if (status) setServer(status.server);
                setEditingServer(false);
              }}
            >
              Cancel
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Your organization&rsquo;s own Polemic server. Leave it empty for
            Polemic&rsquo;s online services. Changing it signs you out.
          </p>
        </section>
      ) : (
        status !== null && (
          <p className="px-1 text-xs text-muted-foreground">
            {customServer && <>Server: {status.server} · </>}
            <button
              type="button"
              className={link}
              disabled={busy !== null}
              onClick={() => {
                if (customServer) setServer(status.server);
                else setServer("");
                setEditingServer(true);
              }}
            >
              {customServer ? "Change server" : "Use custom server"}
            </button>
          </p>
        )
      )}

      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
