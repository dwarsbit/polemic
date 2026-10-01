import { create } from "zustand";
import * as api from "@/lib/tauri";
import { extractCiteKeys } from "@/lib/bibtex";
import {
  includeSpec,
  insertInclude,
  removeInclude,
  replaceIncludeSpec,
  replaceIncludeSpecPrefix,
} from "@/lib/doc-structure";
import { extractLabels } from "@/lib/outline";
import { extractRefPositions } from "@/lib/label-refs";
import { formatDocument } from "@/lib/editor-format";
import { invalidateGitState } from "@/lib/query-client";
import { useEditorStore } from "@/store/editor";
import { useSettingsStore } from "@/store/settings";
import { useSourcesStore } from "@/store/sources";

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
  refsByFile: Record<string, string[]>;
  allLabels: () => string[];
  allRefs: () => string[];
  citeKeysByFile: Record<string, string[]>;
  allCiteKeys: () => string[];
  markDirty: (path: string, content: string) => void;
  /** Refresh a file's label/ref/cite-key metadata from its content. */
  refreshDocMeta: (path: string, content: string) => void;
  flushBuffers: () => Promise<void>;
  openProject: (path: string) => Promise<void>;
  closeProject: () => void;
  refreshFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  /** Open a library .bib file as a loose tab (works without a project). */
  openLibraryFile: (path: string) => Promise<void>;
  closeFile: (path: string, opts?: { discard?: boolean }) => Promise<void>;
  reorderOpenFiles: (from: number, to: number) => void;
  renameProject: (name: string) => Promise<void>;
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

/** Loose library tabs carry this prefix in the open-files list. */
const LIBRARY_PREFIX = "library:";

export function isLibraryPath(path: string | null): boolean {
  return path !== null && path.startsWith(LIBRARY_PREFIX);
}

/** The library-relative path of a loose library tab. */
export function libraryRelative(path: string): string {
  return path.slice(LIBRARY_PREFIX.length);
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

export const useProjectStore = create<ProjectState>((set, get) => {
  /** The file's current content: editor for the active file, else buffer, else disk. */
  async function currentContent(path: string): Promise<string | null> {
    const { project, activeFile, buffers } = get();
    if (!project) return null;
    if (path === activeFile) return useEditorStore.getState().content;
    if (buffers[path] !== undefined) return buffers[path];
    try {
      return await api.readProjectFile(project.path, path);
    } catch {
      return null;
    }
  }

  /**
   * Write new content for a file: buffer cleanup, disk write, and editor
   * refresh when it is the active file. (The editor's undo history for a
   * programmatically edited file resets; acceptable for sync edits.)
   */
  async function applyContentUpdate(path: string, content: string): Promise<void> {
    const { project, activeFile, buffers } = get();
    if (!project) return;
    await api.writeProjectFile(project.path, path, content);
    void invalidateGitState();
    const nextBuffers = { ...buffers };
    delete nextBuffers[path];
    set({ buffers: nextBuffers });
    if (path === activeFile) {
      useEditorStore.getState().loadContent(content);
      set({ lastSavedContent: content });
    }
  }

  /**
   * Keep include directives across all .tex files in sync (rename/delete).
   * The transform returns null when nothing changed.
   */
  async function syncIncludes(
    texPaths: string[],
    transform: (content: string) => string | null,
  ): Promise<void> {
    for (const path of texPaths) {
      const content = await currentContent(path);
      if (content === null) continue;
      const next = transform(content);
      if (next !== null && next !== content) {
        await applyContentUpdate(path, next);
      }
    }
  }

  return {
    project: null,
    files: [],
    openFiles: [],
    activeFile: null,
    mainFile: null,
    lastSavedContent: null,
    buffers: {},
    snapshots: [],
    labelsByFile: {},
    refsByFile: {},
    allLabels: () => {
      const seen = new Set<string>();
      for (const labels of Object.values(useProjectStore.getState().labelsByFile)) {
        for (const label of labels) seen.add(label);
      }
      return [...seen];
    },
    allRefs: () => {
      const seen = new Set<string>();
      for (const refs of Object.values(useProjectStore.getState().refsByFile)) {
        for (const ref of refs) seen.add(ref);
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
    refreshDocMeta: (path, content) =>
      set({
        labelsByFile: { ...get().labelsByFile, [path]: extractLabels(content) },
        refsByFile: {
          ...get().refsByFile,
          [path]: extractRefPositions(content).map((ref) => ref.name),
        },
        citeKeysByFile: {
          ...get().citeKeysByFile,
          [path]: extractCiteKeys(content),
        },
      }),
    flushBuffers: async () => {
      const { project, buffers, activeFile } = get();
      const paths = Object.keys(buffers);
      if (paths.length === 0) return;
      let projectWrite = false;
      for (const path of paths) {
        if (isLibraryPath(path)) {
          await api.writeLibraryFile(libraryRelative(path), buffers[path]);
        } else if (project) {
          await api.writeProjectFile(project.path, path, buffers[path]);
          projectWrite = true;
        }
      }
      if (projectWrite) void invalidateGitState();
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
      // Loose library tabs outlive the project switch.
      const carry = get().openFiles.filter(isLibraryPath);
      set({
        project: info,
        files,
        mainFile,
        openFiles: [...storedOpen, ...carry],
        labelsByFile: {},
        refsByFile: {},
        citeKeysByFile: {},
      });
      void api.setProjectMenuEnabled(true);
      const target =
        storedOpen.length > 0 ? storedOpen[storedOpen.length - 1] : mainFile;
      if (target) {
        await get().openFile(target);
      } else {
        useEditorStore.getState().loadContent("");
        set({ activeFile: null, lastSavedContent: null });
      }
      await get().refreshSnapshots();
      // Backfill cross-file metadata in the background, so opening a
      // project stays fast. Entries collected meanwhile (the opened
      // file, live edits) win.
      void (async () => {
        const labelsByFile: Record<string, string[]> = {};
        const refsByFile: Record<string, string[]> = {};
        for (const texPath of collectPaths(files, ".tex")) {
          try {
            const content = await api.readProjectFile(info.path, texPath);
            labelsByFile[texPath] = extractLabels(content);
            refsByFile[texPath] = extractRefPositions(content).map((ref) => ref.name);
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
        if (get().project?.path !== info.path) return;
        set((state) => ({
          labelsByFile: { ...labelsByFile, ...state.labelsByFile },
          refsByFile: { ...refsByFile, ...state.refsByFile },
          citeKeysByFile: { ...citeKeysByFile, ...state.citeKeysByFile },
        }));
      })();
    },

    closeProject: () => {
      // Dirty buffers are flushed by the caller before closing.
      void api.setProjectMenuEnabled(false);
      const libraryTabs = get().openFiles.filter(isLibraryPath);
      const active = get().activeFile;
      const keepActive = isLibraryPath(active);
      const nextBuffers: Record<string, string> = {};
      for (const [file, content] of Object.entries(get().buffers)) {
        if (isLibraryPath(file)) nextBuffers[file] = content;
      }
      if (!keepActive) useEditorStore.getState().loadContent("");
      set({
        project: null,
        files: [],
        mainFile: null,
        lastSavedContent: null,
        buffers: nextBuffers,
        snapshots: [],
        labelsByFile: {},
        refsByFile: {},
        citeKeysByFile: {},
        openFiles: libraryTabs,
        activeFile: keepActive ? active : null,
      });
      // Focus the first remaining library tab so its content loads.
      if (!keepActive && libraryTabs.length > 0) {
        void get().openLibraryFile(libraryRelative(libraryTabs[0]));
      }
    },

    refreshFiles: async () => {
      const { project } = get();
      if (!project) return;
      set({ files: await api.listFiles(project.path) });
    },

    openFile: async (path) => {
      if (isLibraryPath(path)) return get().openLibraryFile(libraryRelative(path));
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
        refsByFile: {
          ...get().refsByFile,
          [path]: extractRefPositions(content).map((ref) => ref.name),
        },
        citeKeysByFile: { ...get().citeKeysByFile, [path]: extractCiteKeys(content) },
      });
      void api.setOpenFiles(project.path, nextOpen);
    },

    openLibraryFile: async (path) => {
      const { openFiles, buffers } = get();
      const key = LIBRARY_PREFIX + path;
      // Prefer the unsaved buffer over disk so dirty state survives switches.
      const content = buffers[key] ?? (await api.readLibraryFile(path));
      useEditorStore.getState().loadContent(content);
      const projectFiles = openFiles.filter((f) => !isLibraryPath(f));
      const libraryFiles = openFiles.filter(isLibraryPath);
      const nextLibrary = libraryFiles.includes(key)
        ? libraryFiles
        : [...libraryFiles, key];
      set({
        activeFile: key,
        lastSavedContent: content,
        openFiles: [...projectFiles, ...nextLibrary],
      });
    },

    closeFile: async (path) => {
      const { project, activeFile, openFiles, buffers } = get();
      if (!openFiles.includes(path)) return;
      // Never lose unsaved changes when a tab is closed.
      if (buffers[path] !== undefined) {
        if (isLibraryPath(path)) {
          await api.writeLibraryFile(libraryRelative(path), buffers[path]);
        } else {
          if (!project) return;
          await api.writeProjectFile(project.path, path, buffers[path]);
          void invalidateGitState();
        }
        const nextBuffers = { ...buffers };
        delete nextBuffers[path];
        set({ buffers: nextBuffers });
      }
      const index = openFiles.indexOf(path);
      const remaining = openFiles.filter((f) => f !== path);
      set({ openFiles: remaining });
      if (project) {
        await api.setOpenFiles(
          project.path,
          remaining.filter((f) => !isLibraryPath(f)),
        );
      }
      if (activeFile !== path) return;
      if (remaining.length > 0) {
        const next = remaining[Math.min(index, remaining.length - 1)];
        const nextContent = isLibraryPath(next)
          ? get().buffers[next] ?? (await api.readLibraryFile(libraryRelative(next)))
          : project
            ? get().buffers[next] ?? (await api.readProjectFile(project.path, next))
            : null;
        if (nextContent === null) {
          useEditorStore.getState().loadContent("");
          set({ activeFile: null, lastSavedContent: null });
          return;
        }
        useEditorStore.getState().loadContent(nextContent);
        set({ activeFile: next, lastSavedContent: nextContent });
      } else {
        useEditorStore.getState().loadContent("");
        set({ activeFile: null, lastSavedContent: null });
      }
    },

    /** Move an open file's tab to a new position. */
    reorderOpenFiles: (from, to) => {
      const { project, openFiles } = get();
      if (from === to || from < 0 || to < 0) return;
      if (from >= openFiles.length || to >= openFiles.length) return;
      const next = [...openFiles];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      set({ openFiles: next });
      if (project) {
        void api.setOpenFiles(
          project.path,
          next.filter((f) => !isLibraryPath(f)),
        );
      }
    },

    /** Rename the project folder; the open project switches paths. */
    renameProject: async (name) => {
      const { project } = get();
      if (!project || name === project.name) return;
      const info = await api.renameProject(project.path, name);
      set({ project: info });
    },

    createEntry: async (path, isDir) => {
      const { project, mainFile } = get();
      if (!project) return;
      await api.createProjectEntry(project.path, path, isDir);
      void invalidateGitState();
      await get().refreshFiles();
      // New .tex files join the document: add an \input to the main file.
      if (
        !isDir &&
        path.endsWith(".tex") &&
        mainFile &&
        mainFile !== path &&
        useSettingsStore.getState().autoIncludeNewFiles
      ) {
        const content = await currentContent(mainFile);
        if (content !== null) {
          await applyContentUpdate(mainFile, insertInclude(content, includeSpec(path)));
        }
      }
      if (!isDir) await get().openFile(path);
    },

    renameEntry: async (path, newPath) => {
      const { project, buffers } = get();
      if (!project) return;
      await api.renameEntry(project.path, path, newPath);
      void invalidateGitState();
      const remap = (file: string | null) =>
        file !== null && isInside(path, file)
          ? newPath + file.slice(path.length)
          : file;
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
      // Keep \input/\include specs in sync everywhere: renamed files
      // rewrite their exact spec, renamed directories rewrite the specs
      // of everything under them.
      if (path.endsWith(".tex")) {
        await syncIncludes(collectPaths(get().files, ".tex"), (content) => {
          const next = replaceIncludeSpec(content, path, newPath);
          return next === content ? null : next;
        });
      } else {
        await syncIncludes(collectPaths(get().files, ".tex"), (content) => {
          const next = replaceIncludeSpecPrefix(content, path, newPath);
          return next === content ? null : next;
        });
      }
    },

    deleteEntry: async (path) => {
      const { project, buffers } = get();
      if (!project) return;
      await api.deleteEntry(project.path, path);
      void invalidateGitState();
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
      // Deleted .tex files: drop their \input/\include lines everywhere.
      if (path.endsWith(".tex")) {
        await syncIncludes(collectPaths(get().files, ".tex"), (content) => {
          const next = removeInclude(content, path);
          return next === content ? null : next;
        });
      }
    },

    setMainFile: async (path) => {
      const { project } = get();
      if (!project) return;
      await api.setMainFile(project.path, path);
      set({ mainFile: path });
    },

    saveActiveFile: async () => {
      const { project, activeFile, lastSavedContent, buffers } = get();
      if (!activeFile) return false;
      const current = useEditorStore.getState().content;
      const dirty = buffers[activeFile] !== undefined || current !== lastSavedContent;
      if (!dirty) return false;
      // Library files save through the library commands; saving one
      // also refreshes the cached source texts it may back.
      if (isLibraryPath(activeFile)) {
        await api.writeLibraryFile(libraryRelative(activeFile), current);
        const nextBuffers = { ...buffers };
        delete nextBuffers[activeFile];
        set({ lastSavedContent: current, buffers: nextBuffers });
        void useSourcesStore.getState().refresh();
        return true;
      }
      if (!project) return false;
      // Format on save: the formatter itself skips non-.tex files.
      if (useSettingsStore.getState().formatOnSave) formatDocument();
      const content = useEditorStore.getState().content;
      await api.writeProjectFile(project.path, activeFile, content);
      void invalidateGitState();
      const nextBuffers = { ...buffers };
      delete nextBuffers[activeFile];
      set({
        lastSavedContent: content,
        buffers: nextBuffers,
        labelsByFile: { ...get().labelsByFile, [activeFile]: extractLabels(content) },
        refsByFile: {
          ...get().refsByFile,
          [activeFile]: extractRefPositions(content).map((ref) => ref.name),
        },
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
      void invalidateGitState();
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
  };
});
