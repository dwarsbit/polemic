import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  accountCancelSignIn,
  accountSetServer,
  accountSignIn,
  accountSignOut,
  accountStatus,
  type AccountStatus,
} from "@/lib/tauri";

export const DEFAULT_ACCOUNT_SERVER = "https://app.polemicapp.com";

/**
 * The Polemic account (Professional edition): the server, who is
 * signed in, and sign-in through the browser. The token stays in the
 * Rust side and the OS credential store; this page only sees the user.
 */
export function AccountSettingsSection() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [server, setServer] = useState("");
  const [busy, setBusy] = useState<
    "loading" | "signing-in" | "signing-out" | "saving" | null
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
    });

  const signIn = () =>
    run("signing-in", async () => {
      await accountSignIn();
      show(await accountStatus());
    });

  const signOut = () =>
    run("signing-out", async () => {
      await accountSignOut();
      show(await accountStatus());
    });

  const serverChanged =
    status !== null && server.trim().replace(/\/+$/, "") !== status.server;

  return (
    <div className="space-y-4 py-4">
      <div>
        <label className="text-xs text-muted-foreground" htmlFor="account-server">
          Server
        </label>
        <div className="mt-1 flex gap-2">
          <Input
            id="account-server"
            placeholder={DEFAULT_ACCOUNT_SERVER}
            value={server}
            disabled={busy === "signing-in"}
            onChange={(e) => setServer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && serverChanged) void saveServer();
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
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {DEFAULT_ACCOUNT_SERVER} for Polemic Professional, or your
          organization&rsquo;s own Polemic server. Changing it signs you out.
        </p>
      </div>

      <div className="rounded-lg border bg-background px-3 py-3" aria-live="polite">
        {busy === "loading" ? (
          <p className="text-sm text-muted-foreground">Checking your account…</p>
        ) : busy === "signing-in" ? (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Waiting for the browser…</p>
              <p className="text-xs text-muted-foreground">
                Sign in there and choose Allow. Then come back here.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void accountCancelSignIn()}
            >
              Cancel
            </Button>
          </div>
        ) : status?.signedIn ? (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              {status.user ? (
                <>
                  <p className="truncate text-sm font-medium">{status.user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {status.user.email}
                  </p>
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
              onClick={() => void signOut()}
            >
              {busy === "signing-out" ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Not signed in</p>
              <p className="text-xs text-muted-foreground">
                {status?.problem ??
                  "Everything that runs on your computer works without an account. Sign in to use Polemic Professional services."}
              </p>
            </div>
            <Button
              size="sm"
              disabled={busy !== null || serverChanged}
              onClick={() => void signIn()}
            >
              Sign in
            </Button>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
