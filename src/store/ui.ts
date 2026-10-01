import { create } from "zustand";

/** The top-level workspace modes, selected from the header. */
export type AppMode = "editor" | "library";

/** The active file's face in the editor column: the rendered or
 *  managed form (Visual) or the raw text (Code). */
export type EditorFace = "visual" | "code";

interface UiState {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  /** The .tex editor's face; Visual is the coming rich text mode. */
  texEditorMode: EditorFace;
  setTexEditorMode: (mode: EditorFace) => void;
  /** The .bib editor's face: the References card or the raw text. */
  bibEditorMode: EditorFace;
  setBibEditorMode: (mode: EditorFace) => void;
}

/**
 * The workspace mode: the editor (with its projects landing) or the
 * global asset library. Per-session — the app always starts in the
 * editor. The Visual/Code face is remembered per file kind.
 */
export const useUiStore = create<UiState>((set) => ({
  mode: "editor",
  setMode: (mode) => set({ mode }),
  texEditorMode: "code",
  setTexEditorMode: (texEditorMode) => set({ texEditorMode }),
  bibEditorMode: "visual",
  setBibEditorMode: (bibEditorMode) => set({ bibEditorMode }),
}));
