// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccountProjectRow } from "@/lib/tauri";

const row = (id: string, name: string, folder: string | null): AccountProjectRow => ({
  id,
  name,
  role: "owner",
  writable: true,
  source: "online",
  owner: null,
  updatedAt: "2026-11-10T10:00:00.000Z",
  folder,
});

const paper = row("AAAAAAAAAAAAAAAAAAAAAA", "Paper", null);
const thesis = row("BBBBBBBBBBBBBBBBBBBBBB", "Thesis", "/home/ada/Polemic/Thesis");

const server = {
  projects: [paper, thesis],
  picked: "/home/ada/Documents/Paper" as string | null,
};

vi.mock("@/lib/tauri", () => ({
  isShareError: (e: unknown) => typeof e === "object" && e !== null && "kind" in e,
  getSettings: vi.fn(async () => ({ projectsRoot: "/home/ada/Polemic" })),
  linkAccountProjects: vi.fn(async () => server.projects),
  linkOpenAccountProject: vi.fn(async (id: string, name: string, choose: boolean) => {
    const linked = server.projects.find((p) => p.id === id)?.folder;
    if (linked) return { name, path: linked };
    if (choose) return server.picked ? { name, path: server.picked } : null;
    return { name, path: `/home/ada/Polemic/${name}` };
  }),
}));

const openProject = vi.fn<(path: string) => Promise<void>>(async () => {});
vi.mock("@/store/project", () => ({
  useProjectStore: (pick: (s: { openProject: typeof openProject }) => unknown) =>
    pick({ openProject }),
}));
vi.mock("@/store/settings", () => ({
  useSettingsStore: (pick: (s: { openSettings: () => void }) => unknown) =>
    pick({ openSettings: () => {} }),
}));

import { AccountProjectsDialog } from "@/components/AccountProjectsDialog";
import * as tauri from "@/lib/tauri";
import { useDialogsStore } from "@/store/dialogs";

let root: Root | null = null;
let host: HTMLDivElement;

async function show(projectId: string | null) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<AccountProjectsDialog />));
  await act(async () => useDialogsStore.getState().setAccountProjects({ projectId }));
  await act(async () => {});
}

const dialog = () => document.querySelector('[role="dialog"]');
const text = () => dialog()?.textContent ?? "";

async function click(label: string, within?: string) {
  const scope = within
    ? [...document.querySelectorAll('[role="dialog"] li')].find((li) =>
        li.textContent?.includes(within),
      )!
    : dialog()!;
  const button = [...scope.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().startsWith(label),
  )!;
  await act(async () => button.click());
  await act(async () => {});
}

describe("AccountProjectsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.picked = "/home/ada/Documents/Paper";
    useDialogsStore.setState({ accountProjects: null });
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
  });

  it("lists the account's projects and marks the ones on this computer", async () => {
    await show(null);
    expect(text()).toContain("Open from your account");
    expect(text()).toContain("Paper");
    expect(text()).toContain("Thesis");
    expect(text()).toContain("On this computer");
  });

  it("opens a project that is on this computer without asking where", async () => {
    await show(null);
    await click("Open", "Thesis");
    expect(tauri.linkOpenAccountProject).toHaveBeenCalledWith(
      thesis.id,
      "Thesis",
      false,
    );
    expect(openProject).toHaveBeenCalledWith("/home/ada/Polemic/Thesis");
    expect(dialog()).toBeNull();
  });

  it("asks where to keep a project that isn't here yet", async () => {
    await show(null);
    await click("Open", "Paper");
    expect(tauri.linkOpenAccountProject).not.toHaveBeenCalled();
    expect(text()).toContain("Open “Paper”");
    expect(text()).toContain("/home/ada/Polemic");

    await click("In your projects folder");
    expect(tauri.linkOpenAccountProject).toHaveBeenCalledWith(paper.id, "Paper", false);
    expect(openProject).toHaveBeenCalledWith("/home/ada/Polemic/Paper");
  });

  it("puts the project in a folder you pick, and stays when you cancel", async () => {
    await show(null);
    await click("Open", "Paper");
    server.picked = null;
    await click("In another folder");
    expect(openProject).not.toHaveBeenCalled();
    expect(text()).toContain("Open “Paper”");

    server.picked = "/home/ada/Documents/Paper";
    await click("In another folder");
    expect(tauri.linkOpenAccountProject).toHaveBeenLastCalledWith(
      paper.id,
      "Paper",
      true,
    );
    expect(openProject).toHaveBeenCalledWith("/home/ada/Documents/Paper");
  });

  it("says why a folder was refused", async () => {
    vi.mocked(tauri.linkOpenAccountProject).mockRejectedValueOnce({
      kind: "failed",
      message: "That folder already has files in it. Choose a new or empty folder.",
    });
    await show(null);
    await click("Open", "Paper");
    await click("In another folder");
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain(
      "already has files",
    );
    await click("All projects");
    expect(text()).toContain("Open from your account");
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
  });

  it("goes straight to the project a link asked for", async () => {
    await show(paper.id);
    expect(text()).toContain("Open “Paper”");
  });

  it("opens the folder of a linked project a link asked for", async () => {
    await show(thesis.id);
    expect(openProject).toHaveBeenCalledWith("/home/ada/Polemic/Thesis");
  });

  it("says when a link's project isn't in this account", async () => {
    await show("CCCCCCCCCCCCCCCCCCCCCC");
    expect(text()).toContain("isn’t in this account");
    expect(text()).toContain("Paper");
  });
});
