// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { Channel, NOT_AVAILABLE, invoke } from "@/web/core";
import { defaultSettings } from "@/web/settings";
import type { Settings } from "@/lib/tauri";

beforeEach(() => localStorage.clear());

describe("web invoke", () => {
  it("starts from the browser defaults", async () => {
    const settings = await invoke<Settings>("get_settings");
    expect(settings).toEqual(defaultSettings());
    expect(settings.compileProvider).toBe("polemic");
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
    expect(await invoke("get_settings")).toEqual(defaultSettings());
    localStorage.setItem("polemic.settings", "[]");
    expect(await invoke("get_settings")).toEqual(defaultSettings());
  });

  it("rejects desktop commands with a message, as Tauri does", async () => {
    await expect(invoke("compile_project", { projectDir: "x" })).rejects.toBe(
      NOT_AVAILABLE,
    );
  });

  it("has no templates yet", async () => {
    expect(await invoke("list_templates")).toEqual([]);
  });

  it("offers a channel that nothing sends on", () => {
    const channel = new Channel<string>();
    expect(() => channel.onmessage("x")).not.toThrow();
  });
});
