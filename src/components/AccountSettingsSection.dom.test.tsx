// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccountStatus, AccountUser } from "@/lib/tauri";

const ada: AccountUser = {
  id: "u1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  emailVerified: true,
  createdAt: "2026-10-28T10:00:00.000Z",
};

const server = { status: null as unknown as AccountStatus, finishSignIn: () => {} };

vi.mock("@/lib/tauri", () => ({
  accountStatus: vi.fn(async () => server.status),
  accountSetServer: vi.fn(async (url: string) => {
    server.status = { server: url.replace(/\/+$/, ""), signedIn: false, user: null, problem: null };
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
  accountSignOut: vi.fn(async () => {
    server.status = { ...server.status, signedIn: false, user: null };
  }),
}));

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
  [...host.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;

async function click(label: string) {
  await act(async () => button(label).click());
}

describe("AccountSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.status = { server: "https://app.polemicapp.com", signedIn: false, user: null, problem: null };
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

    await click("Sign out");
    expect(tauri.accountSignOut).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Not signed in");
  });

  it("cancels a pending sign-in", async () => {
    await render();
    await click("Sign in");
    await click("Cancel");
    expect(tauri.accountCancelSignIn).toHaveBeenCalled();
  });

  it("saves a self-hosted server before signing in", async () => {
    await render();
    const input = host.querySelector<HTMLInputElement>("#account-server")!;
    expect(input.value).toBe("https://app.polemicapp.com");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "https://polemic.example.org/");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Sign in waits until the new server is saved.
    expect(button("Sign in").disabled).toBe(true);
    await click("Save");
    expect(tauri.accountSetServer).toHaveBeenCalledWith("https://polemic.example.org/");
    expect(input.value).toBe("https://polemic.example.org");
    expect(button("Sign in").disabled).toBe(false);
  });

  it("shows why the account could not be loaded", async () => {
    server.status = { ...server.status, signedIn: true, problem: "Could not reach https://app.polemicapp.com." };
    await render();
    expect(host.textContent).toContain("Signed in");
    expect(host.textContent).toContain("Could not reach");
    expect(button("Sign out")).toBeDefined();
  });
});
