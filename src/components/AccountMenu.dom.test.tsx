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
  plan: "free",
};

const server = {
  status: null as unknown as AccountStatus,
  usage: null as AccountUsage | null,
};

vi.mock("@/lib/tauri", () => ({
  accountStatus: vi.fn(async () => server.status),
  accountUsage: vi.fn(async () => server.usage),
  accountSignOut: vi.fn(async () => {
    server.status = { ...server.status, signedIn: false, user: null };
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

import { openUrl } from "@tauri-apps/plugin-opener";
import { AccountMenu } from "@/components/AccountMenu";
import * as tauri from "@/lib/tauri";
import { useAccountStore } from "@/store/account";

let root: Root | null = null;
let host: HTMLDivElement;

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<AccountMenu />));
}

const trigger = () =>
  host.querySelector<HTMLButtonElement>('[aria-label="Polemic account"]');

async function openMenu() {
  await act(async () => {
    trigger()!.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, bubbles: true, pointerId: 1 }),
    );
  });
}

async function choose(label: string) {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (i) => i.textContent?.trim() === label,
  )!;
  item.dispatchEvent(
    new PointerEvent("click", { button: 0, bubbles: true, pointerId: 1 }),
  );
  await act(async () => {});
}

describe("AccountMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({ status: null });
    server.status = {
      server: "https://app.polemicapp.com",
      signedIn: true,
      user: ada,
      problem: null,
    };
    server.usage = {
      storage: { usedBytes: 42_000_000, limitBytes: 100_000_000 },
      compile: {
        usedPercent: 30,
        resetsAt: "2026-11-09T00:00:00.000Z",
      },
      reviewLinks: { count: 1, limit: 1 },
    };
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
  });

  it("shows nothing while signed out", async () => {
    server.status = { ...server.status, signedIn: false, user: null };
    await render();
    expect(trigger()).toBeNull();
  });

  it("shows the initials, then the plan and usage when opened", async () => {
    await render();
    expect(trigger()?.textContent).toBe("AL");

    await openMenu();
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.textContent).toContain("Ada Lovelace");
    expect(menu.textContent).toContain("ada@example.com");
    expect(menu.textContent).toContain("Free");
    expect(menu.textContent).toContain("42 MB of 100 MB");
    expect(menu.textContent).toContain("Cloud compile today30% used");
    expect(menu.textContent).not.toContain("minutes");
    expect(menu.textContent).toContain("1 of 1 active review link");
  });

  it("opens the account page", async () => {
    await render();
    await openMenu();
    await choose("Manage account");
    expect(openUrl).toHaveBeenCalledWith("https://app.polemicapp.com/account");
  });

  it("signs out and hides the avatar", async () => {
    await render();
    await openMenu();
    await choose("Sign out");
    expect(tauri.accountSignOut).toHaveBeenCalledOnce();
    expect(trigger()).toBeNull();
  });
});
