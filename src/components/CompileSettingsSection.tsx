import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { ToggleButton } from "@/components/ui/toggle-button";
import { ToggleButtonGroup } from "@/components/ui/toggle-button-group";
import {
  accountStatus,
  cloudCompileStatus,
  type AccountStatus,
  type CloudCompileStatus,
  type CompileError,
  type CompileProvider,
} from "@/lib/tauri";
import { usePreviewStore } from "@/store/preview";
import { useSettingsStore } from "@/store/settings";

const link = "underline underline-offset-2 hover:text-foreground";

/**
 * Where compiles run: on this computer with the user's TeX install, or
 * with Polemic on the account's server (Professional). Says why the
 * server is not an option when signed out, on the free plan, or when
 * the server has no cloud compile.
 */
export function CompileSettingsSection() {
  const provider = useSettingsStore((s) => s.compileProvider);
  const setProvider = useSettingsStore((s) => s.setCompileProvider);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [cloud, setCloud] = useState<CloudCompileStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    accountStatus()
      .then(async (status) => {
        if (!live) return;
        setAccount(status);
        if (!status.signedIn) return;
        const available = await cloudCompileStatus();
        if (live) setCloud(available);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function choose(next: CompileProvider) {
    setError(null);
    try {
      await setProvider(next);
    } catch (e) {
      setError(String(e));
    }
  }

  const signedIn = account?.signedIn === true && cloud !== "signedOut";
  const server = account?.server ?? "your Polemic server";
  const accountPage = account ? `${account.server}/account` : null;
  const freePlan = account?.user?.plan === "free" || cloud === "planRequired";
  const usable = signedIn && !freePlan && cloud !== "disabled";

  return (
    <div className="space-y-2 py-2">
      <ToggleButtonGroup
        type="single"
        value={provider}
        onValueChange={(value) => {
          if (value === "local" || value === "polemic") void choose(value);
        }}
      >
        <ToggleButton value="local" size="sm">
          On this computer
        </ToggleButton>
        <ToggleButton
          value="polemic"
          size="sm"
          disabled={!usable && provider !== "polemic"}
          title={usable ? undefined : "Needs a Polemic Professional account"}
        >
          With Polemic
        </ToggleButton>
      </ToggleButtonGroup>

      <p className="text-xs text-muted-foreground" role="status">
        {provider === "local" ? (
          <>
            latexmk and your TeX distribution, below.{" "}
            {usable && "With Polemic, the server compiles and nothing needs to be installed."}
          </>
        ) : (
          <>
            On {server}, with TeX Live and the same latexmk rules. Fonts installed
            only on this computer are not there: put their files in the project.
          </>
        )}
      </p>

      {account !== null && !signedIn && (
        <p className="text-xs text-muted-foreground">
          Compiling with Polemic is part of Polemic Professional.{" "}
          <button type="button" className={link} onClick={() => openSettings("account")}>
            Sign in
          </button>{" "}
          to your Polemic account first.
        </p>
      )}
      {signedIn && freePlan && (
        <p className="text-xs text-muted-foreground">
          Compiling with Polemic needs Polemic Professional.
          {accountPage && (
            <>
              {" "}
              <button type="button" className={link} onClick={() => void openUrl(accountPage)}>
                See plans
              </button>
            </>
          )}
        </p>
      )}
      {signedIn && cloud === "disabled" && (
        <p className="text-xs text-muted-foreground">
          {server} has no cloud compile. Ask its administrator, or compile on this
          computer.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * What the user can do about a compile error: compile with Polemic when
 * no TeX is installed, sign in, or go back to this computer when the
 * server cannot compile.
 */
export function CompileErrorActions({ kind }: { kind: CompileError["kind"] | null }) {
  const setProvider = useSettingsStore((s) => s.setCompileProvider);
  const openSettings = useSettingsStore((s) => s.openSettings);

  async function compileOn(provider: CompileProvider) {
    await setProvider(provider);
    await usePreviewStore.getState().compileNow();
  }

  const action = (label: string, run: () => void) => (
    <Button variant="outline" size="sm" onClick={run}>
      {label}
    </Button>
  );

  switch (kind) {
    case "noTex":
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {action("Compile with Polemic", () => void compileOn("polemic"))}
          <span className="text-muted-foreground">
            on Polemic's server (Professional), or{" "}
            <button type="button" className={link} onClick={() => openSettings("tex")}>
              install TeX
            </button>
            .
          </span>
        </div>
      );
    case "signedOut":
    case "planRequired":
      return (
        <div className="flex flex-wrap gap-2">
          {action("Account settings", () => openSettings("account"))}
          {action("Compile on this computer", () => void compileOn("local"))}
        </div>
      );
    case "disabled":
      return action("Compile on this computer", () => void compileOn("local"));
    default:
      return null;
  }
}
