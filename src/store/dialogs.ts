import { create } from "zustand";
import type { CompileIssue } from "@/lib/tauri";

interface DialogsState {
  shortcutsOpen: boolean;
  aboutOpen: boolean;
  paletteOpen: boolean;
  tableDialogOpen: boolean;
  packagesDialogOpen: boolean;
  documentSettingsOpen: boolean;
  /** Dev builds only: the Component Gallery screen (Develop menu). */
  galleryOpen: boolean;
  /** The issue the AI quickfix dialog is working on; null = closed. */
  aiFixIssue: CompileIssue | null;
  setShortcutsOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setTableDialogOpen: (open: boolean) => void;
  setPackagesDialogOpen: (open: boolean) => void;
  setDocumentSettingsOpen: (open: boolean) => void;
  setGalleryOpen: (open: boolean) => void;
  setAiFixIssue: (issue: CompileIssue | null) => void;
}

export const useDialogsStore = create<DialogsState>((set) => ({
  shortcutsOpen: false,
  aboutOpen: false,
  paletteOpen: false,
  tableDialogOpen: false,
  packagesDialogOpen: false,
  documentSettingsOpen: false,
  galleryOpen: false,
  aiFixIssue: null,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setAboutOpen: (open) => set({ aboutOpen: open }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setTableDialogOpen: (open) => set({ tableDialogOpen: open }),
  setPackagesDialogOpen: (open) => set({ packagesDialogOpen: open }),
  setDocumentSettingsOpen: (open) => set({ documentSettingsOpen: open }),
  setGalleryOpen: (open) => set({ galleryOpen: open }),
  setAiFixIssue: (issue) => set({ aiFixIssue: issue }),
}));
