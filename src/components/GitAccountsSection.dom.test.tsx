// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GitAccountView } from "@/lib/tauri";

/**
 * The Git accounts page: adding an account sends the token once and
 * never shows it again; editing keeps the token unless a new one is
 * typed; removing forgets it.
 */

const store = {
  accounts: [] as GitAccountView[],
  tokens: {} as Record<string, string>,
  githubAvailable: false,
  gitlabAvailable: false,
  /** Ends the pending GitHub sign-in: the code was entered, or cancelled. */
  finishGithub: (() => {}) as (outcome: "entered" | "cancelled") => void,
};

vi.mock("@/lib/tauri", () => ({
  gitAccounts: vi.fn(async () => store.accounts),
  gitAccountSave: vi.fn(
    async (account: {
      id?: string;
      host: string;
      username: string;
      token?: string;
    }) => {
      if (account.host === "bad host")
        throw new Error("The host should look like github.com");
      const id = account.id ?? `id-${store.accounts.length + 1}`;
      if (account.token) store.tokens[id] = account.token;
      const view = {
        id,
        host: account.host,
        username: account.username,
        name: null,
        hasToken: id in store.tokens,
      };
      const index = store.accounts.findIndex((a) => a.id === id);
      if (index === -1) store.accounts = [...store.accounts, view];
      else store.accounts = store.accounts.map((a) => (a.id === id ? view : a));
      return store.accounts;
    },
  ),
  gitAccountRemove: vi.fn(async (id: string) => {
    delete store.tokens[id];
    store.accounts = store.accounts.filter((a) => a.id !== id);
    return store.accounts;
  }),
  HOSTING_NAMES: { github: "GitHub", gitlab: "GitLab" },
  signInAvailable: vi.fn(async (provider: string) =>
    provider === "github" ? store.githubAvailable : store.gitlabAvailable,
  ),
  signInStart: vi.fn(async () => ({
    userCode: "ABCD-1234",
    verificationUri: "https://github.com/login/device",
    expiresIn: 900,
  })),
  signInFinish: vi.fn(
    () =>
      new Promise<GitAccountView[]>((resolve, reject) => {
        store.finishGithub = (outcome) => {
          if (outcome === "cancelled") {
            reject(new Error("Sign-in cancelled"));
            return;
          }
          store.tokens["gh"] = "gho_token";
          store.accounts = [
            ...store.accounts,
            {
              id: "gh",
              host: "github.com",
              username: "ada",
              name: null,
              hasToken: true,
            },
          ];
          resolve(store.accounts);
        };
      }),
  ),
  signInCancel: vi.fn(async () => store.finishGithub("cancelled")),
}));

import { GitAccountsSection, tokenHint } from "@/components/GitAccountsSection";
import * as tauri from "@/lib/tauri";

let root: Root | null = null;
let host: HTMLDivElement;

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<GitAccountsSection />));
  await settle();
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent === label || b.title === label,
  ) as HTMLButtonElement | undefined;

async function click(label: string) {
  const b = button(label);
  expect(b, label).toBeDefined();
  await act(async () => b!.click());
  await settle();
}

async function type(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  store.accounts = [];
  store.tokens = {};
  store.githubAvailable = false;
  store.gitlabAvailable = false;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
});

describe("GitAccountsSection", () => {
  it("adds an account with a token and lists it without the token", async () => {
    await render();
    expect(host.textContent).toContain("No accounts yet");

    await click("Add account");
    expect(button("Add account")!.disabled).toBe(true);
    await type("git-host", "github.com");
    expect(host.textContent).toContain("Personal access tokens");
    await type("git-username", "ada");
    await type("git-token", "ghp_secret");
    await click("Add account");

    expect(tauri.gitAccountSave).toHaveBeenCalledWith({
      id: undefined,
      host: "github.com",
      username: "ada",
      token: "ghp_secret",
    });
    expect(host.textContent).toContain("github.com");
    expect(host.textContent).toContain("ada · token set");
    expect(host.textContent).not.toContain("ghp_secret");
    expect(host.querySelector("#git-token")).toBeNull();
  });

  it("edits the username without resending a token, and removes", async () => {
    store.accounts = [
      { id: "id-1", host: "gitlab.com", username: "ada", name: null, hasToken: true },
    ];
    store.tokens = { "id-1": "glpat" };
    await render();

    await click("Change the username or token");
    expect(host.querySelector<HTMLInputElement>("#git-host")!.disabled).toBe(true);
    await type("git-username", "oauth2");
    await click("Save changes");
    expect(tauri.gitAccountSave).toHaveBeenCalledWith({
      id: "id-1",
      host: "gitlab.com",
      username: "oauth2",
      token: undefined,
    });
    expect(host.textContent).toContain("oauth2 · token set");

    await click("Remove the account and forget its token");
    expect(tauri.gitAccountRemove).toHaveBeenCalledWith("id-1");
    expect(host.textContent).toContain("No accounts yet");
  });

  it("shows the backend's refusal and keeps the form open", async () => {
    await render();
    await click("Add account");
    await type("git-host", "bad host");
    await type("git-token", "t");
    await click("Add account");
    expect(host.textContent).toContain("should look like github.com");
    expect(host.querySelector("#git-host")).not.toBeNull();
  });
});

describe("Sign in with GitHub", () => {
  it("is hidden when this build has no GitHub client ID", async () => {
    await render();
    expect(button("Sign in with GitHub")).toBeUndefined();
    expect(button("Add account")).toBeDefined();
  });

  it("shows the code until it is entered, then lists the GitHub account", async () => {
    store.githubAvailable = true;
    await render();
    await click("Sign in with GitHub");
    expect(tauri.signInStart).toHaveBeenCalledWith("github");
    expect(host.textContent).toContain("ABCD-1234");
    expect(host.textContent).toContain("Waiting for GitHub");
    expect(button("Add account")).toBeUndefined();

    await act(async () => store.finishGithub("entered"));
    await settle();
    expect(host.textContent).not.toContain("ABCD-1234");
    expect(host.textContent).toContain("github.com");
    expect(host.textContent).toContain("ada · token set");
  });

  it("offers GitLab when the build has its application ID, and shows who signed in", async () => {
    store.gitlabAvailable = true;
    store.accounts = [
      { id: "gl", host: "gitlab.com", username: "oauth2", name: "ada", hasToken: true },
    ];
    await render();
    expect(button("Sign in with GitHub")).toBeUndefined();
    expect(button("Sign in with GitLab")).toBeDefined();
    expect(host.textContent).toContain("ada · token set");
    expect(host.textContent).not.toContain("oauth2");
  });

  it("cancels without an error", async () => {
    store.githubAvailable = true;
    await render();
    await click("Sign in with GitHub");
    await click("Cancel");
    expect(tauri.signInCancel).toHaveBeenCalled();
    expect(host.textContent).not.toContain("ABCD-1234");
    expect(host.textContent).not.toContain("cancelled");
    expect(button("Sign in with GitHub")).toBeDefined();
  });
});

describe("tokenHint", () => {
  it("knows the usual hosts", () => {
    expect(tokenHint("GitHub.com")).toContain("GitHub");
    expect(tokenHint("gitlab.com")).toContain("GitLab");
    expect(tokenHint("git.overleaf.com")).toContain("Overleaf");
    expect(tokenHint("codeberg.org")).toBeNull();
  });
});
