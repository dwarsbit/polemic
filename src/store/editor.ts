import { create } from "zustand";

interface EditorState {
  content: string;
  /** Bumped when content is set externally (file open), so the view resyncs. */
  docVersion: number;
  jumpTarget: number | null;
  setContent: (content: string) => void;
  loadContent: (content: string) => void;
  jumpTo: (line: number) => void;
  clearJump: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  content: "",
  docVersion: 0,
  jumpTarget: null,
  setContent: (content) => set({ content }),
  loadContent: (content) =>
    set((state) => ({ content, docVersion: state.docVersion + 1 })),
  jumpTo: (line) => set({ jumpTarget: line }),
  clearJump: () => set({ jumpTarget: null }),
}));
