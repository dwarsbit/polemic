import { create } from "zustand";
import { updatePreferences } from "@/lib/tauri";

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
  /** Apply the persisted face modes at startup, without re-persisting. */
  hydrateEditorModes: (tex: EditorFace, bib: EditorFace) => void;
}

/** Persist one face mode; outside the app the call is a rejected
 *  promise and the mode is still remembered for this session. */
function persistFace(key: "texEditorMode" | "bibEditorMode", mode: EditorFace): void {
  updatePreferences({ [key]: mode }).catch(() => {});
}

/**
 * The Visual/Code face is remembered per file kind and across
 * restarts (persisted with the app settings on the Rust side).
 */
export const useUiStore = create<UiState>((set) => ({
  bibliographySearch: "",
  setBibliographySearch: (bibliographySearch) => set({ bibliographySearch }),
  texEditorMode: "code",
  setTexEditorMode: (texEditorMode) => {
    set({ texEditorMode });
    persistFace("texEditorMode", texEditorMode);
  },
  bibEditorMode: "visual",
  setBibEditorMode: (bibEditorMode) => {
    set({ bibEditorMode });
    persistFace("bibEditorMode", bibEditorMode);
  },
  hydrateEditorModes: (tex, bib) => set({ texEditorMode: tex, bibEditorMode: bib }),
}));
