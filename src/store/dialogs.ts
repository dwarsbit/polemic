import { create } from "zustand";

interface DialogsState {
  shortcutsOpen: boolean;
  aboutOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
}

export const useDialogsStore = create<DialogsState>((set) => ({
  shortcutsOpen: false,
  aboutOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setAboutOpen: (open) => set({ aboutOpen: open }),
}));
