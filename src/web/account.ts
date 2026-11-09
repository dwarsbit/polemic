/**
 * The account commands in the browser: the services app's session
 * stands in for the desktop app's sign-in. Signing in happens before
 * the editor shows (src/web/start.tsx), so these only read the account
 * and sign out.
 */

import type { AccountStatus, AccountUsage, AccountUser } from "@/lib/tauri";
import { request, ServerError } from "@/web/server";

async function status(): Promise<AccountStatus> {
  const server = window.location.origin;
  try {
    const user = await request<AccountUser>("/api/me");
    return { server, signedIn: true, user, problem: null, avatar: user.image ?? null };
  } catch (e) {
    // Signed in (the page needs it), but who it is can't be said now.
    const problem = e instanceof Error ? e.message : String(e);
    return { server, signedIn: true, user: null, problem, avatar: null };
  }
}

async function usage(): Promise<AccountUsage | null> {
  try {
    return await request<AccountUsage>("/api/usage");
  } catch (e) {
    // A server without plans has no usage to show.
    if (e instanceof ServerError && e.status === 404) return null;
    throw e;
  }
}

async function signOut(): Promise<void> {
  await request("/api/auth/sign-out", { method: "POST", json: {} });
  window.location.assign("/sign-in");
}

export const accountCommands = {
  account_status: status,
  account_usage: usage,
  account_sign_out: signOut,
};
