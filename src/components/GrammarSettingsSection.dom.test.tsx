// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccountStatus, GrammarSettings } from "@/lib/tauri";

const account = { status: null as unknown as AccountStatus };

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", () => ({
  accountStatus: vi.fn(async () => account.status),
  grammarRules: vi.fn(async () => []),
  updateGrammarSettings: vi.fn(async (grammar: GrammarSettings) => ({ grammar })),
}));

import { GrammarSettingsSection } from "@/components/GrammarSettingsSection";
import { useGrammarStatus } from "@/lib/grammar-check";
import * as tauri from "@/lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettingsStore } from "@/store/settings";

const grammar: GrammarSettings = {
  enabled: null,
  provider: null,
  languageToolUrl: null,
  englishVariant: null,
  disabledRules: [],
};

let root: Root | null = null;
let host: HTMLDivElement;

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<GrammarSettingsSection />));
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;

async function click(label: string) {
  await act(async () => button(label).click());
}

describe("GrammarSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      grammar,
      settingsDialogOpen: false,
      settingsSection: null,
    });
    useGrammarStatus.setState({ problem: null, retry: 0 });
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
  });

  it("picks Polemic when signed in", async () => {
    await render();
    expect(button("Polemic").disabled).toBe(false);
    await click("Polemic");
    expect(tauri.updateGrammarSettings).toHaveBeenCalledWith({
      ...grammar,
      provider: "polemic",
    });
    expect(host.textContent).toContain("checked on https://polemic.example.org");
  });

  it("points at the account when signed out", async () => {
    account.status = { ...account.status, signedIn: false, user: null };
    await render();
    expect(button("Polemic").disabled).toBe(true);
    await click("sign in");
    expect(useSettingsStore.getState().settingsSection).toBe("account");
  });

  it("says Professional is needed and links to the account page", async () => {
    useSettingsStore.setState({ grammar: { ...grammar, provider: "polemic" } });
    useGrammarStatus.setState({
      problem: {
        kind: "planRequired",
        message: "Grammar checking with Polemic needs Polemic Professional.",
        retryAfter: null,
      },
    });
    await render();
    expect(host.textContent).toContain("needs Polemic Professional");
    await click("See plans");
    expect(openUrl).toHaveBeenCalledWith("https://polemic.example.org/account");
  });

  it("keeps settings from before the choice on their LanguageTool server", async () => {
    useSettingsStore.setState({
      grammar: { ...grammar, languageToolUrl: "http://localhost:8081/v2" },
    });
    await render();
    expect(button("LanguageTool server").getAttribute("data-state")).toBe("on");
    expect((host.querySelector("#languagetool-url") as HTMLInputElement).value).toBe(
      "http://localhost:8081/v2",
    );
  });
});
