// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HistorySnapshot } from "@/lib/tauri";

/**
 * The server's snapshots of a shared project: the list, what changed
 * since one, and restoring it for everyone (owner and editors only).
 */

const server = {
  writable: true,
  snapshots: [] as HistorySnapshot[],
};
const order: string[] = [];

vi.mock("@/lib/tauri", () => ({
  shareHistory: vi.fn(async () => server.snapshots),
  shareInfo: vi.fn(async () => ({ writable: server.writable })),
  shareHistoryFiles: vi.fn(async (_dir: string, id: string) => ({
    snapshot: server.snapshots.find((s) => s.id === id),
    files: [{ path: "main.tex", text: "Hello.\n" }],
    assets: [],
  })),
  shareFolder: vi.fn(async () => [
    { path: "main.tex", kind: "text", text: "Hello.\n" },
    { path: "notes.tex", kind: "text", text: "Notes.\n" },
  ]),
  shareRestore: vi.fn(async () => {
    order.push("restore");
  }),
}));

vi.mock("@/store/link", () => {
  const state = {
    dir: "/home/ada/thesis",
    syncNow: vi.fn(async () => {
      order.push("sync");
    }),
  };
  const useLinkStore = (selector: (s: typeof state) => unknown) => selector(state);
  useLinkStore.getState = () => state;
  return { useLinkStore };
});

vi.mock("@/store/project", () => {
  const state = {
    project: { name: "Thesis", path: "/home/ada/thesis" },
    buffers: { "main.tex": "Hello again.\n" } as Record<string, string>,
  };
  const useProjectStore = (selector: (s: typeof state) => unknown) => selector(state);
  useProjectStore.getState = () => state;
  return { useProjectStore };
});

import { OnlineSnapshotsPanel } from "@/components/OnlineSnapshotsPanel";
import * as tauri from "@/lib/tauri";

let root: Root | null = null;

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <OnlineSnapshotsPanel label="Online snapshots" />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

const text = () => document.body.textContent ?? "";
const buttons = (label: string) =>
  [...document.body.querySelectorAll("button")].filter(
    (b) => b.textContent?.trim() === label || b.title === label,
  );

async function click(target: HTMLButtonElement | undefined) {
  expect(target).toBeDefined();
  await act(async () => target!.click());
  await settle();
}

describe("OnlineSnapshotsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    server.writable = true;
    server.snapshots = [
      { id: "s2", kind: "restore", size: 10, createdAt: "2026-11-07T12:00:00.000Z" },
      { id: "s1", kind: "hourly", size: 10, createdAt: "2026-11-07T10:00:00.000Z" },
    ];
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("lists the snapshots and restores one for everyone, after syncing", async () => {
    await render();
    expect(text()).toContain("Before a restore");
    expect(buttons("Restore this snapshot")).toHaveLength(2);

    await click(buttons("Restore this snapshot")[1]);
    expect(text()).toContain("The project as it is now is kept as a snapshot first");
    await click(buttons("Restore")[0]);
    expect(tauri.shareRestore).toHaveBeenCalledWith("/home/ada/thesis", "s1", undefined);
    // Saved changes go up first, and the restore comes down right after.
    expect(order).toEqual(["sync", "restore", "sync"]);
  });

  it("shows what changed since a snapshot, unsaved edits included, and restores a file", async () => {
    await render();
    await click(buttons("View changes against the current project")[1]);
    expect(text()).toContain("main.tex");
    expect(text()).toContain("notes.tex");
    expect(text()).toContain("Hello again.");
    await click(buttons("Restore this file from the snapshot")[0]);
    expect(tauri.shareRestore).toHaveBeenCalledWith("/home/ada/thesis", "s1", ["main.tex"]);
  });

  it("lets commenters look without restoring", async () => {
    server.writable = false;
    await render();
    expect(buttons("Restore this snapshot")).toHaveLength(0);
    await click(buttons("View changes against the current project")[0]);
    expect(buttons("Restore this file from the snapshot")).toHaveLength(0);
  });
});
