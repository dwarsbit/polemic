// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccountStatus, CloudCompileStatus, CompileProvider } from "@/lib/tauri";

const account = {
  status: null as unknown as AccountStatus,
  cloud: "available" as CloudCompileStatus,
};

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", () => ({
  accountStatus: vi.fn(async () => account.status),
  cloudCompileStatus: vi.fn(async () => account.cloud),
  setCompileProvider: vi.fn(async (provider: CompileProvider) => ({
    compileProvider: provider,
  })),
  cancelCompile: vi.fn(async () => {}),
  compileProject: vi.fn(async () => ({ success: false, issues: [], log: "", engine: "pdflatex" })),
  getPdf: vi.fn(async () => new Uint8Array()),
  setPreviewZoom: vi.fn(async () => {}),
}));

import {
  CompileErrorActions,
  CompileSettingsSection,
} from "@/components/CompileSettingsSection";
import * as tauri from "@/lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";
import type { ReactNode } from "react";

let root: Root | null = null;
let host: HTMLDivElement;

async function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;

async function click(label: string) {
  await act(async () => button(label).click());
}

describe("CompileSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.cloud = "available";
    account.status = {
      server: "https://polemic.example.org",
      signedIn: true,
      user: {
        id: "u1",
        name: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        createdAt: "2026-10-28T10:00:00.000Z",
        plan: "professional",
      },
      problem: null,
    };
    useSettingsStore.setState({
      compileProvider: "local",
      settingsDialogOpen: false,
      settingsSection: null,
    });
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
  });

  it("compiles on this computer by default and picks Polemic when Professional", async () => {
    await render(<CompileSettingsSection />);
    expect(button("On this computer").getAttribute("data-state")).toBe("on");
    expect(button("With Polemic").disabled).toBe(false);
    await click("With Polemic");
    expect(tauri.setCompileProvider).toHaveBeenCalledWith("polemic");
    expect(useSettingsStore.getState().compileProvider).toBe("polemic");
    expect(host.textContent).toContain("On https://polemic.example.org, with TeX Live");
  });

  it("points at the account when signed out", async () => {
    account.status = { ...account.status, signedIn: false, user: null };
    await render(<CompileSettingsSection />);
    expect(button("With Polemic").disabled).toBe(true);
    expect(tauri.cloudCompileStatus).not.toHaveBeenCalled();
    await click("Sign in");
    expect(useSettingsStore.getState().settingsSection).toBe("account");
  });

  it("says Professional is needed on the free plan", async () => {
    account.status = {
      ...account.status,
      user: { ...account.status.user!, plan: "free" },
    };
    account.cloud = "planRequired";
    await render(<CompileSettingsSection />);
    expect(button("With Polemic").disabled).toBe(true);
    expect(host.textContent).toContain("needs Polemic Professional");
    await click("See plans");
    expect(openUrl).toHaveBeenCalledWith("https://polemic.example.org/account");
  });

  it("says when the server has no cloud compile, and keeps an earlier choice changeable", async () => {
    account.cloud = "disabled";
    useSettingsStore.setState({ compileProvider: "polemic" });
    await render(<CompileSettingsSection />);
    expect(host.textContent).toContain("https://polemic.example.org has no cloud compile");
    expect(button("With Polemic").disabled).toBe(false);
    await click("On this computer");
    expect(tauri.setCompileProvider).toHaveBeenCalledWith("local");
  });
});

describe("CompileErrorActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ compileProvider: "local", settingsSection: null });
    useProjectStore.setState({
      project: { name: "p", path: "/p" },
      mainFile: "main.tex",
    });
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
  });

  it("offers Polemic when no TeX is installed", async () => {
    await render(<CompileErrorActions kind="noTex" />);
    await click("Compile with Polemic");
    expect(tauri.setCompileProvider).toHaveBeenCalledWith("polemic");
    expect(useSettingsStore.getState().compileProvider).toBe("polemic");
    expect(tauri.compileProject).toHaveBeenCalledWith("/p", "main.tex");
    await click("install TeX");
    expect(useSettingsStore.getState().settingsSection).toBe("tex");
  });

  it("goes back to this computer when the server cannot compile", async () => {
    useSettingsStore.setState({ compileProvider: "polemic" });
    await render(<CompileErrorActions kind="disabled" />);
    await click("Compile on this computer");
    expect(tauri.setCompileProvider).toHaveBeenCalledWith("local");
    expect(usePreviewStore.getState().status).not.toBe("idle");
  });

  it("shows nothing for errors in the document", async () => {
    await render(<CompileErrorActions kind={null} />);
    expect(host.textContent).toBe("");
    act(() => root?.unmount());
    host.remove();
    await render(<CompileErrorActions kind="failed" />);
    expect(host.textContent).toBe("");
  });
});
