// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GitPullOutcome, GitStatus } from "@/lib/tauri";

/**
 * The Git panel's remote half: adding a remote, pull/push with the
 * ahead/behind counts, and a pull that stops on conflicts.
 */

const repo = {
  status: null as unknown as GitStatus,
  pullOutcome: { kind: "upToDate" } as GitPullOutcome,
  /** Files whose hand edit left markers behind. */
  markersLeft: [] as string[],
  /** What github_publish refuses with, if anything. */
  publishError: null as string | null,
};

function status(partial: Partial<GitStatus> = {}): GitStatus {
  return {
    available: true,
    isRepo: true,
    branch: "main",
    ahead: 0,
    behind: 0,
    entries: [],
    remote: null,
    upstream: null,
    conflicts: [],
    merging: false,
    ...partial,
  };
}

vi.mock("@/lib/tauri", () => ({
  gitStatus: vi.fn(async () => repo.status),
  gitInit: vi.fn(async () => {}),
  gitStage: vi.fn(async (_dir: string, paths: string[]) => {
    repo.status = {
      ...repo.status,
      conflicts: repo.status.conflicts.filter((p) => !paths.includes(p)),
    };
  }),
  gitUnstage: vi.fn(async () => {}),
  gitCommit: vi.fn(async () => {
    repo.status = status({ remote: repo.status.remote, upstream: "origin/main" });
  }),
  gitSetRemote: vi.fn(async (_dir: string, url: string) => {
    repo.status = { ...repo.status, remote: url === "" ? null : url };
  }),
  gitFetch: vi.fn(async () => {}),
  gitPull: vi.fn(async () => {
    if (repo.pullOutcome.kind === "conflicts") {
      repo.status = {
        ...repo.status,
        behind: 0,
        merging: true,
        conflicts: repo.pullOutcome.paths,
      };
    } else {
      repo.status = { ...repo.status, behind: 0 };
    }
    return repo.pullOutcome;
  }),
  gitPush: vi.fn(async () => {
    repo.status = { ...repo.status, ahead: 0, upstream: "origin/main" };
  }),
  gitResolveConflict: vi.fn(async (_dir: string, path: string) => {
    repo.status = {
      ...repo.status,
      conflicts: repo.status.conflicts.filter((p) => p !== path),
    };
  }),
  gitMarkResolved: vi.fn(async (_dir: string, path: string) => {
    if (repo.markersLeft.includes(path)) {
      throw new Error(`${path} still has conflict markers (line 3)`);
    }
    repo.status = {
      ...repo.status,
      conflicts: repo.status.conflicts.filter((p) => p !== path),
    };
  }),
  gitAbortMerge: vi.fn(async () => {
    repo.status = { ...repo.status, merging: false, conflicts: [] };
  }),
  gitShowHead: vi.fn(async () => null),
  readProjectFile: vi.fn(async () => ""),
  githubPublish: vi.fn(async (_dir: string, name: string) => {
    if (repo.publishError) throw new Error(repo.publishError);
    const url = `https://github.com/ada/${name}.git`;
    repo.status = { ...repo.status, remote: url, upstream: "origin/main" };
    return url;
  }),
  suggestedRepoName: (name: string) => name.replace(/\s+/g, "-"),
}));

vi.mock("@/store/project", () => {
  const state = {
    project: { name: "paper", path: "/tmp/paper" },
    openFile: vi.fn(async () => {}),
    syncFromDisk: vi.fn(async () => {}),
    buffers: {},
  };
  const useProjectStore = (selector: (s: typeof state) => unknown) => selector(state);
  useProjectStore.getState = () => state;
  return { useProjectStore };
});

import { GitPanel, remoteLabel, syncNotice } from "@/components/GitPanel";
import * as tauri from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

let root: Root | null = null;
let host: HTMLDivElement;

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <GitPanel />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
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

async function type(input: HTMLInputElement, value: string) {
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
  repo.status = status();
  repo.pullOutcome = { kind: "upToDate" };
  repo.markersLeft = [];
  repo.publishError = null;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
});

describe("GitPanel remotes", () => {
  it("adds a remote, then shows pull and push instead", async () => {
    await render();
    expect(host.textContent).toContain("No remote yet.");
    expect(button("Pull")).toBeUndefined();

    await click("Add remote…");
    const input = host.querySelector("input") as HTMLInputElement;
    await type(input, "https://github.com/ada/paper.git");
    await click("Save remote");

    expect(tauri.gitSetRemote).toHaveBeenCalledWith(
      "/tmp/paper",
      "https://github.com/ada/paper.git",
    );
    expect(host.textContent).toContain("github.com/ada/paper");
    expect(button("Pull")).toBeDefined();
    expect(button("Push")).toBeDefined();
  });

  it("pushes and pulls with the counts on the buttons", async () => {
    repo.status = status({
      remote: "git@github.com:ada/paper.git",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    await render();
    expect(button("Push 2")).toBeDefined();
    expect(button("Pull 1")).toBeDefined();

    await click("Push 2");
    expect(tauri.gitPush).toHaveBeenCalledWith("/tmp/paper");
    expect(host.textContent).toContain("Pushed.");
    expect(button("Push")).toBeDefined();

    repo.pullOutcome = { kind: "updated" };
    await click("Pull 1");
    expect(tauri.gitPull).toHaveBeenCalledWith("/tmp/paper");
    expect(host.textContent).toContain("Updated from the remote.");
    // The pulled files reach the editor.
    expect(useProjectStore.getState().syncFromDisk).toHaveBeenCalled();
  });

  it("lists a pull's conflicts until each is marked resolved, then commits the merge", async () => {
    repo.status = status({ remote: "https://github.com/ada/paper.git", behind: 1 });
    repo.pullOutcome = { kind: "conflicts", paths: ["main.tex", "refs.bib"] };
    await render();

    await click("Pull 1");
    expect(host.textContent).toContain("Both sides changed 2 files");
    expect(host.textContent).toContain("main.tex");
    expect(host.textContent).toContain("refs.bib");
    expect(button("Finish merge")).toBeDefined();
    expect(button("Finish merge")!.disabled).toBe(true);
    expect(button("Pull")!.disabled).toBe(true);

    const resolve = [...host.querySelectorAll("button")].filter(
      (b) => b.title === "Mark resolved",
    );
    expect(resolve).toHaveLength(2);
    await act(async () => resolve[0]!.click());
    await settle();
    expect(tauri.gitMarkResolved).toHaveBeenCalledWith("/tmp/paper", "main.tex");
    expect(host.textContent).not.toContain("main.tex");
    expect(button("Finish merge")!.disabled).toBe(true);

    await act(async () => button("Mark resolved")!.click());
    await settle();
    expect(button("Finish merge")!.disabled).toBe(false);
    await click("Finish merge");
    expect(tauri.gitCommit).toHaveBeenCalledWith("/tmp/paper", "Merge remote changes");
    expect(button("Commit")).toBeDefined();
  });

  it("keeps mine or theirs per file, and refuses to mark a file with markers", async () => {
    repo.status = status({
      remote: "https://github.com/ada/paper.git",
      merging: true,
      conflicts: ["main.tex", "refs.bib", "notes.tex"],
    });
    repo.markersLeft = ["notes.tex"];
    await render();

    const rowButtons = (title: string) =>
      [...host.querySelectorAll("button")].filter((b) => b.title.startsWith(title));
    await act(async () => rowButtons("Keep mine")[0]!.click());
    await settle();
    expect(tauri.gitResolveConflict).toHaveBeenCalledWith(
      "/tmp/paper",
      "main.tex",
      "ours",
    );
    await act(async () => rowButtons("Keep theirs")[0]!.click());
    await settle();
    expect(tauri.gitResolveConflict).toHaveBeenCalledWith(
      "/tmp/paper",
      "refs.bib",
      "theirs",
    );
    expect(host.textContent).not.toContain("main.tex");
    expect(host.textContent).not.toContain("refs.bib");

    await act(async () => rowButtons("Mark resolved")[0]!.click());
    await settle();
    expect(tauri.gitMarkResolved).toHaveBeenCalledWith("/tmp/paper", "notes.tex");
    expect(host.textContent).toContain("still has conflict markers");
    expect(host.textContent).toContain("notes.tex");
    expect(button("Finish merge")!.disabled).toBe(true);

    repo.markersLeft = [];
    await act(async () => rowButtons("Mark resolved")[0]!.click());
    await settle();
    expect(host.textContent).not.toContain("notes.tex");
    expect(button("Finish merge")!.disabled).toBe(false);
  });

  it("aborts a merge", async () => {
    repo.status = status({
      remote: "https://github.com/ada/paper.git",
      merging: true,
      conflicts: ["main.tex"],
    });
    await render();
    await click("Abort merge");
    expect(tauri.gitAbortMerge).toHaveBeenCalledWith("/tmp/paper");
    expect(button("Abort merge")).toBeUndefined();
    expect(button("Commit")).toBeDefined();
  });
});

describe("Publish to GitHub", () => {
  it("publishes as a private repository named after the project", async () => {
    await render();
    await click("Publish to GitHub…");
    const name = host.querySelector<HTMLInputElement>(
      'input[aria-label="Repository name"]',
    )!;
    expect(name.value).toBe("paper");
    const isPrivate = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(isPrivate.checked).toBe(true);

    await click("Publish");
    expect(tauri.githubPublish).toHaveBeenCalledWith("/tmp/paper", "paper", true);
    expect(host.textContent).toContain("Published to github.com/ada/paper.");
    expect(host.textContent).toContain("github.com/ada/paper");
    expect(button("Push")).toBeDefined();
  });

  it("keeps the form and links to the accounts when there is no GitHub account", async () => {
    repo.publishError =
      "Add a GitHub account in Settings first: sign in with GitHub or add a token";
    await render();
    await click("Publish to GitHub…");
    await click("Publish");
    expect(host.textContent).toContain("Add a GitHub account in Settings first");
    expect(button("Open git accounts")).toBeDefined();
    expect(host.querySelector('input[aria-label="Repository name"]')).not.toBeNull();
  });
});

describe("remote wording", () => {
  it("names a remote by host and path", () => {
    expect(remoteLabel("https://github.com/ada/paper.git")).toBe(
      "github.com/ada/paper",
    );
    expect(remoteLabel("git@gitlab.com:ada/paper.git")).toBe("gitlab.com:ada/paper");
    expect(remoteLabel("ssh://git@git.overleaf.com/abc")).toBe("git.overleaf.com/abc");
  });

  it("counts the conflicted files", () => {
    expect(syncNotice("conflicts", 1)).toContain("one file");
    expect(syncNotice("conflicts", 3)).toContain("3 files");
  });
});
