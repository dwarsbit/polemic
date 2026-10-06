import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore, type EditorFace } from "./ui";

const updatePreferences = vi.fn((prefs: unknown) => Promise.resolve(prefs));

vi.mock("@/lib/tauri", () => ({
  updatePreferences: (prefs: unknown) => updatePreferences(prefs),
}));

function setMode(kind: "tex" | "bib", mode: EditorFace) {
  if (kind === "tex") useUiStore.getState().setTexEditorMode(mode);
  else useUiStore.getState().setBibEditorMode(mode);
}

beforeEach(() => {
  useUiStore.getState().hydrateEditorModes("code", "visual");
  updatePreferences.mockClear();
});

describe("editor face persistence", () => {
  it("remembers the tex face in the store and persists it", () => {
    setMode("tex", "visual");
    expect(useUiStore.getState().texEditorMode).toBe("visual");
    expect(updatePreferences).toHaveBeenCalledWith({ texEditorMode: "visual" });
  });

  it("remembers the bib face and persists it separately", () => {
    setMode("bib", "code");
    expect(useUiStore.getState().bibEditorMode).toBe("code");
    expect(updatePreferences).toHaveBeenCalledWith({ bibEditorMode: "code" });
  });

  it("hydrates persisted modes without re-persisting them", () => {
    useUiStore.getState().hydrateEditorModes("visual", "code");
    expect(useUiStore.getState().texEditorMode).toBe("visual");
    expect(useUiStore.getState().bibEditorMode).toBe("code");
    expect(updatePreferences).not.toHaveBeenCalled();
  });
});
