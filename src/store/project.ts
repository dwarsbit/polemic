import { create } from "zustand";
import * as api from "@/lib/tauri";
import { extractCiteKeys } from "@/lib/bibtex";
import { extractLabels } from "@/lib/outline";
import { useEditorStore } from "@/store/editor";

interface ProjectState {
  project: api.ProjectInfo | null;
  files: api.FileEntry[];
  openFiles: string[];
  activeFile: string | null;
  mainFile: string | null;
  lastSavedContent: string | null;
  /** Unsaved (dirty) file contents, keyed by project-relative path. */
  buffers: Record<string, string>;
  snapshots: api.SnapshotInfo[];
  labelsByFile: Record<string, string[]>;
  allLabels: () => string[];
  citeKeysByFile: Record<string, string[]>;
  allCiteKeys: () => string[];
  markDirty: (path: string, content: string) => void;
  flushBuffers: () => Promise<void>;
  openProject: (path: string) => Promise<void>;
  closeProject: () => void;
  refreshFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => Promise<void>;
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

function collectPaths(entries: api.FileEntry[], extension: string): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isDir) {
      paths.push(...collectPaths(entry.children, extension));
    } else if (entry.path.endsWith(extension)) {
      paths.push(entry.path);
    }
  }
  return paths;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  files: [],
  openFiles: [],
  activeFile: null,
  mainFile: null,
  lastSavedContent: null,
  buffers: {},
  snapshots: [],
  labelsByFile: {},
  allLabels: () => {
    const seen = new Set<string>();
    for (const labels of Object.values(useProjectStore.getState().labelsByFile)) {
      for (const label of labels) seen.add(label);
    }
    return [...seen];
  },
  citeKeysByFile: {},
  allCiteKeys: () => {
    const seen = new Set<string>();
    for (const keys of Object.values(useProjectStore.getState().citeKeysByFile)) {
      for (const key of keys) seen.add(key);
    }
    return [...seen];
  },
  markDirty: (path, content) =>
    set((state) => ({ buffers: { ...state.buffers, [path]: content } })),
  flushBuffers: async () => {
    const { project, buffers, activeFile } = get();
    if (!project) return;
    const paths = Object.keys(buffers);
    if (paths.length === 0) return;
    for (const path of paths) {
      await api.writeProjectFile(project.path, path, buffers[path]);
    }
    const next = { ...buffers };
    for (const path of paths) delete next[path];
    const patch: Partial<ProjectState> = { buffers: next };
    if (activeFile !== null && paths.includes(activeFile)) {
      patch.lastSavedContent = useEditorStore.getState().content;
    }
    set(patch);
  },

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
    const storedOpen = (settings.openFiles[info.path] ?? []).filter((f) =>
      findFile(files, f),
    );
    const labelsByFile: Record<string, string[]> = {};
    for (const texPath of collectPaths(files, ".tex")) {
      try {
        labelsByFile[texPath] = extractLabels(
          await api.readProjectFile(info.path, texPath),
        );
      } catch {
        // unreadable file: skip its labels
      }
    }
    const citeKeysByFile: Record<string, string[]> = {};
    for (const bibPath of collectPaths(files, ".bib")) {
      try {
        citeKeysByFile[bibPath] = extractCiteKeys(
          await api.readProjectFile(info.path, bibPath),
        );
      } catch {
        // unreadable file: skip its keys
      }
    }
    set({
      project: info,
      files,
      mainFile,
      openFiles: storedOpen,
      labelsByFile,
      citeKeysByFile,
    });
    void api.setProjectMenuEnabled(true);
    const target = storedOpen.length > 0 ? storedOpen[storedOpen.length - 1] : mainFile;
    if (target) {
      await get().openFile(target);
    } else {
      useEditorStore.getState().loadContent("");
      set({ activeFile: null, lastSavedContent: null });
    }
    await get().refreshSnapshots();
  },

  closeProject: () => {
    // Dirty buffers are flushed by the caller before closing.
    void api.setProjectMenuEnabled(false);
    set({
      project: null,
      files: [],
      openFiles: [],
      activeFile: null,
      mainFile: null,
      lastSavedContent: null,
      buffers: {},
      snapshots: [],
      labelsByFile: {},
      citeKeysByFile: {},
    });
  },

  refreshFiles: async () => {
    const { project } = get();
    if (!project) return;
    set({ files: await api.listFiles(project.path) });
  },

  openFile: async (path) => {
    const { project, openFiles, buffers } = get();
    if (!project) return;
    // Prefer the unsaved buffer over disk so dirty state survives tab switches.
    const content = buffers[path] ?? (await api.readProjectFile(project.path, path));
    useEditorStore.getState().loadContent(content);
    const nextOpen = openFiles.includes(path) ? openFiles : [...openFiles, path];
    set({
      activeFile: path,
      lastSavedContent: content,
      openFiles: nextOpen,
      labelsByFile: { ...get().labelsByFile, [path]: extractLabels(content) },
      citeKeysByFile: { ...get().citeKeysByFile, [path]: extractCiteKeys(content) },
    });
    void api.setOpenFiles(project.path, nextOpen);
  },

  closeFile: async (path) => {
    const { project, activeFile, openFiles, buffers } = get();
    if (!project || !openFiles.includes(path)) return;
    // Never lose unsaved changes when a tab is closed.
    if (buffers[path] !== undefined) {
      await api.writeProjectFile(project.path, path, buffers[path]);
      const nextBuffers = { ...buffers };
      delete nextBuffers[path];
      set({ buffers: nextBuffers });
    }
    const index = openFiles.indexOf(path);
    const remaining = openFiles.filter((f) => f !== path);
    set({ openFiles: remaining });
    await api.setOpenFiles(project.path, remaining);
    if (activeFile !== path) return;
    if (remaining.length > 0) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      const nextContent =
        get().buffers[next] ?? (await api.readProjectFile(project.path, next));
      useEditorStore.getState().loadContent(nextContent);
      set({ activeFile: next, lastSavedContent: nextContent });
    } else {
      useEditorStore.getState().loadContent("");
      set({ activeFile: null, lastSavedContent: null });
    }
  },

  createEntry: async (path, isDir) => {
    const { project } = get();
    if (!project) return;
    await api.createProjectEntry(project.path, path, isDir);
    await get().refreshFiles();
    if (!isDir) await get().openFile(path);
  },

  renameEntry: async (path, newPath) => {
    const { project, buffers } = get();
    if (!project) return;
    await api.renameEntry(project.path, path, newPath);
    const remap = (file: string | null) =>
      file !== null && isInside(path, file) ? newPath + file.slice(path.length) : file;
    const activeFile = remap(get().activeFile);
    const mainFile = remap(get().mainFile);
    const nextBuffers: Record<string, string> = {};
    for (const [file, content] of Object.entries(buffers)) {
      nextBuffers[remap(file) ?? file] = content;
    }
    set({
      activeFile,
      buffers: nextBuffers,
      openFiles: get().openFiles.map((f) => remap(f) ?? f),
    });
    if (mainFile !== null && mainFile !== get().mainFile) {
      await get().setMainFile(mainFile);
    }
    await get().refreshFiles();
  },

  deleteEntry: async (path) => {
    const { project, buffers } = get();
    if (!project) return;
    await api.deleteEntry(project.path, path);
    const removeInside = (file: string | null) =>
      file !== null && isInside(path, file) ? null : file;
    const nextBuffers: Record<string, string> = {};
    for (const [file, content] of Object.entries(buffers)) {
      if (!isInside(path, file)) nextBuffers[file] = content;
    }
    if (isInside(path, get().activeFile ?? "")) {
      useEditorStore.getState().loadContent("");
    }
    set({
      activeFile: removeInside(get().activeFile),
      mainFile: removeInside(get().mainFile),
      openFiles: get().openFiles.filter((f) => !isInside(path, f)),
      buffers: nextBuffers,
      lastSavedContent: isInside(path, get().activeFile ?? "")
        ? null
        : get().lastSavedContent,
    });
    await get().refreshFiles();
  },

  setMainFile: async (path) => {
    const { project } = get();
    if (!project) return;
    await api.setMainFile(project.path, path);
    set({ mainFile: path });
  },

  saveActiveFile: async () => {
    const { project, activeFile, lastSavedContent, buffers } = get();
    if (!project || !activeFile) return false;
    const content = useEditorStore.getState().content;
    const dirty = buffers[activeFile] !== undefined || content !== lastSavedContent;
    if (!dirty) return false;
    await api.writeProjectFile(project.path, activeFile, content);
    const nextBuffers = { ...buffers };
    delete nextBuffers[activeFile];
    set({
      lastSavedContent: content,
      buffers: nextBuffers,
      labelsByFile: { ...get().labelsByFile, [activeFile]: extractLabels(content) },
      citeKeysByFile: {
        ...get().citeKeysByFile,
        [activeFile]: extractCiteKeys(content),
      },
    });
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
    // Restored files replace unsaved buffers entirely.
    set({ buffers: {} });
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
