import { create } from "zustand";
import type { TableGrid } from "@/lib/table-grid";
import type { CompileIssue } from "@/lib/tauri";

/** A table open in the grid editor, and where its edit goes. */
export interface TableGridRequest {
  grid: TableGrid;
  /** Receives the table's new LaTeX (the environment only). */
  onSave: (latex: string) => void;
}

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
  /** The table in the grid editor; null = closed. */
  tableGrid: TableGridRequest | null;
  /** The CSV import assistant: the data file to start from (null:
   *  pick one); the whole value null = closed. */
  csvImport: { path: string | null } | null;
  setShortcutsOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setTableDialogOpen: (open: boolean) => void;
  setPackagesDialogOpen: (open: boolean) => void;
  setDocumentSettingsOpen: (open: boolean) => void;
  setGalleryOpen: (open: boolean) => void;
  setAiFixIssue: (issue: CompileIssue | null) => void;
  setTableGrid: (request: TableGridRequest | null) => void;
  setCsvImport: (request: { path: string | null } | null) => void;
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
  tableGrid: null,
  csvImport: null,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setAboutOpen: (open) => set({ aboutOpen: open }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setTableDialogOpen: (open) => set({ tableDialogOpen: open }),
  setPackagesDialogOpen: (open) => set({ packagesDialogOpen: open }),
  setDocumentSettingsOpen: (open) => set({ documentSettingsOpen: open }),
  setGalleryOpen: (open) => set({ galleryOpen: open }),
  setAiFixIssue: (issue) => set({ aiFixIssue: issue }),
  setTableGrid: (request) => set({ tableGrid: request }),
  setCsvImport: (request) => set({ csvImport: request }),
}));
