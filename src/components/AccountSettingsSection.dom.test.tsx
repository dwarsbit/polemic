// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccountStatus, AccountUsage, AccountUser } from "@/lib/tauri";

const ada: AccountUser = {
  id: "u1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  emailVerified: true,
  createdAt: "2026-10-28T10:00:00.000Z",
  plan: "student",
};

const server = {
  status: null as unknown as AccountStatus,
  usage: null as AccountUsage | null,
  finishSignIn: () => {},
};

vi.mock("@/lib/tauri", () => ({
  accountStatus: vi.fn(async () => server.status),
  accountSetServer: vi.fn(async (url: string) => {
    server.status = {
      server: url.replace(/\/+$/, ""),
      signedIn: false,
      user: null,
      problem: null,
    };
    return server.status;
  }),
  accountSignIn: vi.fn(
    () =>
      new Promise<AccountUser>((resolve) => {
        server.finishSignIn = () => {
          server.status = { ...server.status, signedIn: true, user: ada };
          resolve(ada);
        };
      }),
  ),
  accountCancelSignIn: vi.fn(async () => {}),
  accountUsage: vi.fn(async () => server.usage),
  accountSignOut: vi.fn(async () => {
    server.status = { ...server.status, signedIn: false, user: null };
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

import { openUrl } from "@tauri-apps/plugin-opener";
import { AccountSettingsSection } from "@/components/AccountSettingsSection";
import * as tauri from "@/lib/tauri";

let root: Root | null = null;
let host: HTMLDivElement;

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<AccountSettingsSection />));
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement;

async function click(label: string) {
  await act(async () => button(label).click());
}

/** Sign out sits in the "More account actions" menu. */
async function signOutFromMenu() {
  const trigger = host.querySelector<HTMLButtonElement>(
    '[aria-label="More account actions"]',
  )!;
  await act(async () => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, bubbles: true, pointerId: 1 }),
    );
  });
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (i) => i.textContent?.trim() === "Sign out",
  )!;
  item.dispatchEvent(
    new PointerEvent("click", { button: 0, bubbles: true, pointerId: 1 }),
  );
  await act(async () => {});
}

describe("AccountSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.status = {
      server: "https://app.polemicapp.com",
      signedIn: false,
      user: null,
      problem: null,
    };
    server.usage = {
      storage: { usedBytes: 1_200_000_000, limitBytes: 5_000_000_000 },
      compile: {
        usedSeconds: 720,
        limitSeconds: 3000,
        resetsAt: "2026-11-09T00:00:00.000Z",
      },
      reviewLinks: { count: 3, limit: null },
    };
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
  });

  it("signs in through the browser and out again", async () => {
    await render();
    expect(host.textContent).toContain("Not signed in");

    await click("Sign in");
    expect(tauri.accountSignIn).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Waiting for the browser");

    await act(async () => server.finishSignIn());
    expect(host.textContent).toContain("Ada Lovelace");
    expect(host.textContent).toContain("ada@example.com");
    expect(host.textContent).toContain("Student plan");
    expect(host.textContent).toContain("1.2 GB of 5 GB");
    expect(host.textContent).toContain("12 of 50 minutes");
    expect(host.textContent).toContain("Unlimited review links");

    await signOutFromMenu();
    expect(tauri.accountSignOut).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Not signed in");
  });

  it("opens the sign-up form from Create account", async () => {
    await render();
    await click("Create account");
    expect(tauri.accountSignIn).toHaveBeenCalledWith(true);
    expect(host.textContent).toContain("Create your account there");
  });

  it("shows the sign-in photo, else the initials", async () => {
    server.status = { ...server.status, signedIn: true, user: ada };
    await render();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("AL");
    act(() => root?.unmount());
    host.remove();

    server.status = { ...server.status, avatar: "data:image/png;base64,AAAA" };
    await render();
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("shows Pro's compile time without a limit, and Free's review link", async () => {
    server.status = {
      ...server.status,
      signedIn: true,
      user: { ...ada, plan: "free" },
    };
    server.usage = {
      storage: { usedBytes: 100_000_000, limitBytes: 100_000_000 },
      compile: {
        usedSeconds: 90,
        limitSeconds: null,
        resetsAt: "2026-11-09T00:00:00.000Z",
      },
      reviewLinks: { count: 1, limit: 1 },
    };
    await render();
    expect(host.textContent).toContain("Free plan");
    expect(host.textContent).toContain("1 of 1 active review link");
    expect(host.textContent).toContain("1.5 minutes");
    expect(host.textContent).not.toContain("1.5 of");
  });

  it("hides the plan for servers without plans", async () => {
    server.status = { ...server.status, signedIn: true, user: { ...ada, plan: null } };
    await render();
    expect(host.textContent).not.toContain("Change plan");
    expect(tauri.accountUsage).not.toHaveBeenCalled();
  });

  it("opens the account page and the privacy policy when signed in", async () => {
    server.status = { ...server.status, signedIn: true, user: ada };
    await render();
    expect(host.textContent).toContain("download your data or delete your account");
    await click("Manage account");
    expect(openUrl).toHaveBeenCalledWith("https://app.polemicapp.com/account");
    await click("Privacy policy");
    expect(openUrl).toHaveBeenCalledWith("https://polemicapp.com/privacy");
  });

  it("links a self-hosted server's account page, without Polemic's privacy policy", async () => {
    server.status = {
      ...server.status,
      server: "https://polemic.example.org",
      signedIn: true,
      user: ada,
    };
    await render();
    expect(host.textContent).toContain("Server: https://polemic.example.org");
    await click("Manage account");
    expect(openUrl).toHaveBeenCalledWith("https://polemic.example.org/account");
    expect(button("Privacy policy")).toBeUndefined();
  });

  it("cancels a pending sign-in", async () => {
    await render();
    await click("Sign in");
    await click("Cancel");
    expect(tauri.accountCancelSignIn).toHaveBeenCalled();
  });

  it("saves a self-hosted server before signing in", async () => {
    await render();
    expect(host.querySelector("#account-server")).toBeNull();
    await click("Use custom server");
    const input = host.querySelector<HTMLInputElement>("#account-server")!;
    expect(input.value).toBe("");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setValue.call(input, "https://polemic.example.org/");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Sign in waits until the new server is saved.
    expect(button("Sign in").disabled).toBe(true);
    await click("Save");
    expect(tauri.accountSetServer).toHaveBeenCalledWith("https://polemic.example.org/");
    expect(host.querySelector("#account-server")).toBeNull();
    expect(host.textContent).toContain("Server: https://polemic.example.org");
    expect(button("Sign in").disabled).toBe(false);
  });

  it("shows why the account could not be loaded", async () => {
    server.status = {
      ...server.status,
      signedIn: true,
      problem: "Could not reach https://app.polemicapp.com.",
    };
    await render();
    expect(host.textContent).toContain("Signed in");
    expect(host.textContent).toContain("Could not reach");
    await signOutFromMenu();
    expect(tauri.accountSignOut).toHaveBeenCalledOnce();
  });
});
