// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import type { ReviewLink, ShareStatus } from "@/lib/tauri";

/** The Rust side, as far as the dialog can tell. */
const server = {
  status: null as unknown as ShareStatus,
  links: [] as ReviewLink[],
  published: 0,
  publishError: null as unknown,
};
const emptyUpdate = () => {
  let binary = "";
  for (const b of Y.encodeStateAsUpdate(new Y.Doc())) binary += String.fromCharCode(b);
  return btoa(binary);
};

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", () => ({
  // The project store resets the preview when the project changes.
  cancelCompile: vi.fn(async () => {}),
  isShareError: (v: unknown) =>
    typeof v === "object" && v !== null && "kind" in v && "message" in v,
  shareStatus: vi.fn(async () => server.status),
  shareFolder: vi.fn(async () => [{ path: "main.tex", kind: "text", text: "x" }]),
  shareCreate: vi.fn(async (_dir: string, name: string) => {
    server.status = {
      ...server.status,
      link: { server: server.status.server, projectId: "p".repeat(22), name },
    };
    return server.status.link;
  }),
  shareSync: vi.fn(async () => ({ update: emptyUpdate(), stateVector: "AA==" })),
  shareCommentState: vi.fn(async () => ({ seen: [], onDisk: [] })),
  shareSaveComments: vi.fn(async () => []),
  listComments: vi.fn(async () => []),
  shareUploadAssets: vi.fn(async () => {}),
  sharePush: vi.fn(async () => {}),
  sharePublish: vi.fn(async (_dir: string, main: string | null) => {
    if (server.publishError) throw server.publishError;
    server.published++;
    return {
      id: `s${server.published}`,
      main,
      pdf: "a".repeat(64),
      synctex: null,
      size: 10,
      createdAt: "2026-10-30T12:00:00.000Z",
    };
  }),
  shareSnapshots: vi.fn(async () =>
    server.published > 0
      ? [
          {
            id: "s1",
            main: "main.tex",
            pdf: "a".repeat(64),
            synctex: null,
            size: 10,
            createdAt: "2026-10-30T12:00:00.000Z",
          },
        ]
      : [],
  ),
  shareLinks: vi.fn(async () => server.links),
  shareCreateLink: vi.fn(async (_dir: string, role: "commenter" | "viewer") => {
    const made: ReviewLink = {
      id: `l${server.links.length + 1}`.padEnd(22, "x"),
      role,
      expiresAt: null,
      createdAt: "2026-10-30T12:05:00.000Z",
    };
    server.links = [made, ...server.links];
    return { ...made, url: "https://polemic.example.org/r/secret-token" };
  }),
  shareDeleteLink: vi.fn(async (_dir: string, id: string) => {
    server.links = server.links.filter((l) => l.id !== id);
  }),
  shareStop: vi.fn(async () => {
    server.status = { ...server.status, link: null };
    server.published = 0;
    server.links = [];
  }),
}));

import { ShareDialog } from "@/components/ShareDialog";
import * as tauri from "@/lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

let root: Root | null = null;

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<ShareDialog open onOpenChange={() => {}} />));
}

/** The dialog renders in a portal on the body. */
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;

async function click(label: string) {
  const target = button(label);
  if (!target) throw new Error(`no button ${label} in: ${text()}`);
  await act(async () => target.click());
}

describe("ShareDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.status = {
      server: "https://polemic.example.org",
      signedIn: true,
      link: null,
    };
    server.links = [];
    server.published = 0;
    server.publishError = null;
    useProjectStore.setState({
      project: { name: "Thesis", path: "/home/ada/thesis" },
      mainFile: "main.tex",
    });
    useSettingsStore.setState({ settingsDialogOpen: false, settingsSection: null });
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("asks a signed-out user to sign in", async () => {
    server.status = { ...server.status, signedIn: false };
    await render();
    expect(text()).toContain("Sharing is part of Polemic Professional.");
    expect(button("Publish for review")).toBeUndefined();
    await click("Sign in");
    expect(useSettingsStore.getState().settingsSection).toBe("account");
  });

  it("publishes the project with its main file, then offers links", async () => {
    await render();
    expect(text()).toContain("Not published yet.");
    expect(text()).not.toContain("Review links");
    await click("Publish for review");
    expect(tauri.shareCreate).toHaveBeenCalledWith("/home/ada/thesis", "Thesis");
    expect(tauri.sharePublish).toHaveBeenCalledWith("/home/ada/thesis", "main.tex");
    expect(text()).toContain("Published ");
    expect(button("Publish again")).toBeDefined();
    expect(text()).toContain("Review links");
    expect(text()).toContain("No links yet.");
  });

  it("shows a new link once, lists it and deletes it", async () => {
    server.status.link = {
      server: server.status.server,
      projectId: "p".repeat(22),
      name: "Thesis",
    };
    server.published = 1;
    await render();
    await click("Create link");
    expect(tauri.shareCreateLink).toHaveBeenCalledWith(
      "/home/ada/thesis",
      "commenter",
      null,
    );
    const url = document.body.querySelector("input[readonly]") as HTMLInputElement;
    expect(url.value).toBe("https://polemic.example.org/r/secret-token");
    expect(text()).toContain("the link is shown once");
    expect(text()).toContain("Can comment");

    await act(async () =>
      (
        document.body.querySelector(
          'button[aria-label="Delete link"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(tauri.shareDeleteLink).toHaveBeenCalled();
    expect(text()).toContain("No links yet.");
    expect(document.body.querySelector("input[readonly]")).toBeNull();
  });

  it("explains a free plan, with the account page", async () => {
    server.publishError = {
      kind: "planRequired",
      message: "Sharing needs Polemic Professional.",
    };
    await render();
    await click("Publish for review");
    expect(text()).toContain("Sharing needs Polemic Professional.");
    await click("See plans");
    expect(openUrl).toHaveBeenCalledWith("https://polemic.example.org/account");
  });

  it("stops sharing only after a confirmation", async () => {
    server.status.link = {
      server: server.status.server,
      projectId: "p".repeat(22),
      name: "Thesis",
    };
    server.published = 1;
    await render();
    await click("Stop sharing…");
    expect(tauri.shareStop).not.toHaveBeenCalled();
    expect(text()).toContain("Your files stay as they are.");
    await click("Stop sharing");
    expect(tauri.shareStop).toHaveBeenCalledWith("/home/ada/thesis");
    expect(text()).toContain("Not published yet.");
    expect(text()).not.toContain("Review links");
  });
});
