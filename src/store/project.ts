import { create } from "zustand";
import * as api from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";

interface ProjectState {
  project: api.ProjectInfo | null;
  files: api.FileEntry[];
  activeFile: string | null;
  mainFile: string | null;
  lastSavedContent: string | null;
  snapshots: api.SnapshotInfo[];
  openProject: (path: string) => Promise<void>;
  closeProject: () => void;
  refreshFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  createEntry: (path: string, isDir: boolean) => Promise<void>;
  renameEntry: (path: string, newPath: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  setMainFile: (path: string) => Promise<void>;
  saveActiveFile: () => Promise<boolean>;
  refreshSnapshots: () => Promise<void>;
  takeSnapshot: () => Promise<void>;
  restoreSnapshot: (id: string) => Promise<void>;
}

function findFile(entries: api.FileEntry[], path: string): boolean {
  return entries.some(
    (entry) => (!entry.isDir && entry.path === path) || findFile(entry.children, path),
  );
}

function firstTex(entries: api.FileEntry[]): string | null {
  for (const entry of entries) {
    if (!entry.isDir && entry.path.endsWith(".tex")) return entry.path;
    const nested = firstTex(entry.children);
    if (nested) return nested;
  }
  return null;
}

function isInside(parentPath: string, childPath: string): boolean {
  return childPath === parentPath || childPath.startsWith(parentPath + "/");
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  files: [],
  activeFile: null,
  mainFile: null,
  lastSavedContent: null,
  snapshots: [],

  openProject: async (path) => {
    const info = await api.openProject(path);
    const files = await api.listFiles(info.path);
    const settings = await api.getSettings();
    const storedMain = settings.mainFiles[info.path];
    const mainFile: string | null =
      storedMain && findFile(files, storedMain)
        ? storedMain
        : findFile(files, "main.tex")
          ? "main.tex"
          : firstTex(files);
    set({ project: info, files, mainFile });
    if (mainFile) await get().openFile(mainFile);
    await get().refreshSnapshots();
  },

  closeProject: () =>
    set({
      project: null,
      files: [],
      activeFile: null,
      mainFile: null,
      lastSavedContent: null,
      snapshots: [],
    }),

  refreshFiles: async () => {
    const { project } = get();
    if (!project) return;
    set({ files: await api.listFiles(project.path) });
  },

  openFile: async (path) => {
    await get().saveActiveFile();
    const { project } = get();
    if (!project) return;
    const content = await api.readProjectFile(project.path, path);
    useEditorStore.getState().loadContent(content);
    set({ activeFile: path, lastSavedContent: content });
  },

  createEntry: async (path, isDir) => {
    const { project } = get();
    if (!project) return;
    await api.createProjectEntry(project.path, path, isDir);
    await get().refreshFiles();
    if (!isDir) await get().openFile(path);
  },

  renameEntry: async (path, newPath) => {
    const { project } = get();
    if (!project) return;
    await api.renameEntry(project.path, path, newPath);
    if (get().activeFile !== null && isInside(path, get().activeFile!)) {
      const suffix = get().activeFile!.slice(path.length);
      set({ activeFile: newPath + suffix });
    }
    if (get().mainFile !== null && isInside(path, get().mainFile!)) {
      const suffix = get().mainFile!.slice(path.length);
      await get().setMainFile(newPath + suffix);
    }
    await get().refreshFiles();
  },

  deleteEntry: async (path) => {
    const { project } = get();
    if (!project) return;
    await api.deleteEntry(project.path, path);
    if (get().activeFile !== null && isInside(path, get().activeFile!)) {
      useEditorStore.getState().loadContent("");
      set({ activeFile: null, lastSavedContent: null });
    }
    if (get().mainFile !== null && isInside(path, get().mainFile!)) {
      set({ mainFile: null });
    }
    await get().refreshFiles();
  },

  setMainFile: async (path) => {
    const { project } = get();
    if (!project) return;
    await api.setMainFile(project.path, path);
    set({ mainFile: path });
  },

  saveActiveFile: async () => {
    const { project, activeFile, lastSavedContent } = get();
    if (!project || !activeFile) return false;
    const content = useEditorStore.getState().content;
    if (content === lastSavedContent) return false;
    await api.writeProjectFile(project.path, activeFile, content);
    set({ lastSavedContent: content });
    return true;
  },

  refreshSnapshots: async () => {
    const { project } = get();
    if (!project) return;
    set({ snapshots: await api.listSnapshots(project.path) });
  },

  takeSnapshot: async () => {
    const { project } = get();
    if (!project) return;
    await api.createSnapshot(project.path);
    await get().refreshSnapshots();
  },

  restoreSnapshot: async (id) => {
    const { project, mainFile, activeFile } = get();
    if (!project) return;
    await api.restoreSnapshot(project.path, id);
    await get().refreshFiles();
    await get().refreshSnapshots();
    // Reload from disk without saving, so restored content is not clobbered.
    const target = activeFile ?? mainFile;
    if (target) {
      const content = await api.readProjectFile(project.path, target);
      useEditorStore.getState().loadContent(content);
      set({ activeFile: target, lastSavedContent: content });
    }
  },
}));
