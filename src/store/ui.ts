import { create } from "zustand";

/** The active file's face in the editor column: the rendered or
 *  managed form (Visual) or the raw text (Code). */
export type EditorFace = "visual" | "code";

interface UiState {
  /** The Bibliography panel's search box; store-backed so other
   *  surfaces (a cite pill) can drive it. */
  bibliographySearch: string;
  setBibliographySearch: (query: string) => void;
  /** The .tex editor's face; Visual is the rich text mode. */
  texEditorMode: EditorFace;
  setTexEditorMode: (mode: EditorFace) => void;
  /** The .bib editor's face: the References card or the raw text. */
  bibEditorMode: EditorFace;
  setBibEditorMode: (mode: EditorFace) => void;
}

/**
 * The Visual/Code face is remembered per file kind.
 */
export const useUiStore = create<UiState>((set) => ({
  bibliographySearch: "",
  setBibliographySearch: (bibliographySearch) => set({ bibliographySearch }),
  texEditorMode: "code",
  setTexEditorMode: (texEditorMode) => set({ texEditorMode }),
  bibEditorMode: "visual",
  setBibEditorMode: (bibEditorMode) => set({ bibEditorMode }),
}));
