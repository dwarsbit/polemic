// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Channel, NOT_AVAILABLE, invoke } from "@/web/core";
import { defaultSettings } from "@/web/settings";
import type { Settings } from "@/lib/tauri";

/** The server's project list, as GET /api/projects answers it. */
const serverProjects = [
  {
    id: "p1",
    name: "Street trees",
    role: "owner",
    owner: { id: "u1", name: "Ada" },
    source: "online",
    writable: true,
  },
  {
    id: "p2",
    name: "Thesis",
    role: "owner",
    owner: { id: "u1", name: "Ada" },
    source: "desktop",
    writable: false,
  },
  {
    id: "p3",
    name: "Night heat",
    role: "editor",
    owner: { id: "u2", name: "Bo" },
    source: "online",
    writable: true,
  },
];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/projects"
        ? Response.json({ projects: serverProjects })
        : Response.json({ error: "not_found", message: "Not found." }, { status: 404 }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

const withProjects = (settings: Settings): Settings => ({
  ...settings,
  recentProjects: [
    { name: "Street trees", path: "/projects/p1", detail: "Yours" },
    {
      name: "Thesis",
      path: "/projects/p2",
      detail: "Yours, read-only: published from the desktop app",
    },
    { name: "Night heat", path: "/projects/p3", detail: "Shared by Bo" },
  ],
});

describe("web invoke", () => {
  it("starts from the browser defaults", async () => {
    const settings = await invoke<Settings>("get_settings");
    expect(settings).toEqual(withProjects(defaultSettings()));
    expect(settings.compileProvider).toBe("polemic");
    expect(settings.grammar.provider).toBe("polemic");
  });

  it("turns writing aids stored as off back on, once", async () => {
    localStorage.setItem(
      "polemic.settings",
      JSON.stringify({
        ...defaultSettings(),
        spellcheck: false,
        grammar: { enabled: false },
      }),
    );
    let settings = await invoke<Settings>("get_settings");
    expect(settings.spellcheck).toBeNull();
    expect(settings.grammar.enabled).toBeNull();
    await invoke("update_preferences", { spellcheck: false });
    settings = await invoke<Settings>("get_settings");
    expect(settings.spellcheck).toBe(false);
  });

  it("keeps preferences across calls", async () => {
    const updated = await invoke<Settings>("update_preferences", {
      theme: "dark",
      fontSize: 16,
      authorName: "Ada",
    });
    expect(updated.theme).toBe("dark");
    const again = await invoke<Settings>("get_settings");
    expect(again.theme).toBe("dark");
    expect(again.fontSize).toBe(16);
    expect(again.authorName).toBe("Ada");
  });

  it("clears the author name on an empty string", async () => {
    await invoke("update_preferences", { authorName: "Ada" });
    const cleared = await invoke<Settings>("update_preferences", { authorName: "" });
    expect(cleared.authorName).toBeNull();
  });

  it("ignores keys that are not preferences", async () => {
    const updated = await invoke<Settings>("update_preferences", {
      projectsRoot: "/etc",
    });
    expect(updated.projectsRoot).toBe("");
  });

  it("pins the newest project first", async () => {
    await invoke("set_pinned_project", { path: "a", pinned: true });
    const settings = await invoke<Settings>("set_pinned_project", {
      path: "b",
      pinned: true,
    });
    expect(settings.pinnedProjects).toEqual(["b", "a"]);
    const unpinned = await invoke<Settings>("set_pinned_project", {
      path: "b",
      pinned: false,
    });
    expect(unpinned.pinnedProjects).toEqual(["a"]);
  });

  it("stores the panel layout and preview zoom", async () => {
    await invoke("set_panel_layout", { layout: { files: 20 } });
    await invoke("set_preview_zoom", { zoom: 1.25 });
    const settings = await invoke<Settings>("get_settings");
    expect(settings.panelLayout).toEqual({ files: 20 });
    expect(settings.previewZoom).toBe(1.25);
  });

  it("falls back to the defaults over unreadable storage", async () => {
    localStorage.setItem("polemic.settings", "{not json");
    expect(await invoke("get_settings")).toEqual(withProjects(defaultSettings()));
    localStorage.setItem("polemic.settings", "[]");
    expect(await invoke("get_settings")).toEqual(withProjects(defaultSettings()));
  });

  it("rejects desktop commands with a message, as Tauri does", async () => {
    await expect(invoke("git_commit", { projectDir: "x" })).rejects.toBe(NOT_AVAILABLE);
  });

  it("refuses project commands for a project that isn't open", async () => {
    await expect(invoke("list_files", { projectDir: "/projects/p1" })).rejects.toBe(
      "This project isn't open.",
    );
  });

  it("says when a project can't be opened", async () => {
    await expect(invoke("open_project", { path: "/projects/gone" })).rejects.toThrow(
      "This project doesn't exist or isn't shared with you.",
    );
  });

  it("offers the desktop app's templates", async () => {
    const templates = await invoke<{ id: string; files?: unknown }[]>("list_templates");
    expect(templates.map((t) => t.id)).toContain("article");
    expect(templates[0].files).toBeUndefined();
  });

  it("offers a channel that nothing sends on", () => {
    const channel = new Channel<string>();
    expect(() => channel.onmessage("x")).not.toThrow();
  });
});
