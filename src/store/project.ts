import { create } from "zustand";
import { ask } from "@tauri-apps/plugin-dialog";
import * as api from "@/lib/tauri";
import { extractCiteKeys } from "@/lib/bibtex";
import { loadsBiblatex } from "@/lib/citation-preview";
import { loadsNatbib } from "@/lib/cite-refs";
import { collectAssetPaths } from "@/lib/assets";
import { extractGraphicsPaths, planGraphicsRename } from "@/lib/graphics-refs";
import { applyEdits } from "@/lib/label-index";
import {
  includeSpec,
  insertInclude,
  removeInclude,
  replaceIncludeSpec,
  replaceIncludeSpecPrefix,
} from "@/lib/doc-structure";
import { finalText } from "@/lib/changes";
import { extractLabels } from "@/lib/outline";
import { extractRefPositions } from "@/lib/label-refs";
import { formatDocument } from "@/lib/editor-format";
import { flushPendingSerialize } from "@/lib/visual/pending-serialize";
import { invalidateGitState } from "@/lib/query-client";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useSettingsStore } from "@/store/settings";

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
  /** \graphicspath folders declared per .tex file. */
  graphicsPathsByFile: Record<string, string[]>;
  /** Whether each .tex file loads biblatex (the .bib backend). */
  biblatexByFile: Record<string, boolean>;
  /** Whether each .tex file loads natbib, for its cite commands. */
  natbibByFile: Record<string, boolean>;
  /** Words the spellcheck accepts in this project (lowercase). */
  ignoredWords: string[];
  /** Accept a word in this project (stored in .polemic/project.json). */
  ignoreWord: (word: string) => Promise<void>;
  allCiteKeys: () => string[];
  markDirty: (path: string, content: string) => void;
  /** Refresh a file's label/ref/cite-key metadata from its content. */
  refreshDocMeta: (path: string, content: string) => void;
  flushBuffers: () => Promise<void>;
  openProject: (path: string) => Promise<void>;
  /** Save the open project's edits, then close it. If saving fails,
   *  ask first; false when the user keeps the project open. */
  leaveProject: () => Promise<boolean>;
  closeProject: () => void;
  refreshFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string, opts?: { discard?: boolean }) => Promise<void>;
  reorderOpenFiles: (from: number, to: number) => void;
  renameProject: (name: string) => Promise<void>;
  createEntry: (path: string, isDir: boolean) => Promise<void>;
  renameEntry: (path: string, newPath: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  setMainFile: (path: string) => Promise<void>;
  /** Save the active file. A background save (window blur) neither
   *  formats nor overwrites a version changed outside the app; an
   *  interactive one asks first. */
  saveActiveFile: (opts?: { background?: boolean }) => Promise<boolean>;
  /** Pick up outside changes (git, other editors): refresh the file
   *  tree and reload the active file when it has no unsaved edits. */
  syncFromDisk: () => Promise<void>;
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

type FileMetadata = Pick<
  ProjectState,
  | "labelsByFile"
  | "refsByFile"
  | "citeKeysByFile"
  | "graphicsPathsByFile"
  | "biblatexByFile"
  | "natbibByFile"
>;

/** Per-file metadata after `path` (a file, or a folder and everything
 *  under it) was renamed to `newPath`, or deleted when `newPath` is null. */
function moveFileMetadata(
  state: FileMetadata,
  path: string,
  newPath: string | null,
): FileMetadata {
  const move = <T>(byFile: Record<string, T>): Record<string, T> => {
    const next: Record<string, T> = {};
    for (const [file, value] of Object.entries(byFile)) {
      if (!isInside(path, file)) next[file] = value;
      else if (newPath !== null) next[newPath + file.slice(path.length)] = value;
    }
    return next;
  };
  return {
    labelsByFile: move(state.labelsByFile),
    refsByFile: move(state.refsByFile),
    citeKeysByFile: move(state.citeKeysByFile),
    graphicsPathsByFile: move(state.graphicsPathsByFile),
    biblatexByFile: move(state.biblatexByFile),
    natbibByFile: move(state.natbibByFile),
  };
}

/** Drop a buffer only if it still holds what was written: an edit that
 *  landed while the write was in flight stays dirty. */
function withoutWritten(
  buffers: Record<string, string>,
  written: Record<string, string>,
): Record<string, string> {
  const next = { ...buffers };
  for (const [path, content] of Object.entries(written)) {
    if (next[path] === content) delete next[path];
  }
  return next;
}

/** Ask before a save replaces a version someone else wrote. */
async function confirmOverwrite(path: string): Promise<boolean> {
  const message = `${path} was changed outside Polemic since it was opened. Overwrite those changes with your version?`;
  try {
    return await ask(message, {
      title: "File changed on disk",
      kind: "warning",
      okLabel: "Overwrite",
      cancelLabel: "Cancel",
    });
  } catch {
    // Browser dev: no native dialog.
    return window.confirm(message);
  }
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

  /** Write unsaved edits before the project leaves the store. If that
   *  fails, ask whether to go on and lose them; true to go on. */
  async function saveBeforeLeaving(question: string, okLabel: string): Promise<boolean> {
    try {
      await get().flushBuffers();
      return true;
    } catch (e) {
      return ask(`Some changes could not be saved:\n\n${e}\n\n${question}`, {
        title: "Unsaved changes",
        kind: "warning",
        okLabel,
        cancelLabel: "Keep project open",
      }).catch(() => false);
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
    graphicsPathsByFile: {},
    biblatexByFile: {},
    natbibByFile: {},
    ignoredWords: [],
    ignoreWord: async (word) => {
      const project = get().project;
      if (!project) return;
      const config = await api.getProjectConfig(project.path);
      const words = new Set(config.ignoredWords ?? []);
      words.add(word.toLowerCase());
      const ignoredWords = [...words].sort();
      await api.saveProjectConfig(project.path, { ...config, ignoredWords });
      if (get().project?.path === project.path) set({ ignoredWords });
    },
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
        labelsByFile: {
          ...get().labelsByFile,
          [path]: extractLabels(finalText(content).text),
        },
        refsByFile: {
          ...get().refsByFile,
          [path]: extractRefPositions(finalText(content).text).map((ref) => ref.name),
        },
        citeKeysByFile: {
          ...get().citeKeysByFile,
          [path]: extractCiteKeys(content),
        },
        graphicsPathsByFile: {
          ...get().graphicsPathsByFile,
          [path]: extractGraphicsPaths(content),
        },
        biblatexByFile: { ...get().biblatexByFile, [path]: loadsBiblatex(content) },
        natbibByFile: { ...get().natbibByFile, [path]: loadsNatbib(content) },
      }),
    flushBuffers: async () => {
      // The visual face serializes on a debounce; pending edits land
      // in the store (and this buffer list) before anything writes.
      flushPendingSerialize();
      const { project, buffers, activeFile } = get();
      const paths = Object.keys(buffers);
      if (paths.length === 0 || !project) return;
      const written: Record<string, string> = {};
      for (const path of paths) {
        await api.writeProjectFile(project.path, path, buffers[path]);
        written[path] = buffers[path];
      }
      void invalidateGitState();
      const patch: Partial<ProjectState> = {
        buffers: withoutWritten(get().buffers, written),
      };
      if (
        activeFile !== null &&
        get().activeFile === activeFile &&
        activeFile in written
      ) {
        patch.lastSavedContent = written[activeFile];
      }
      set(patch);
    },

    openProject: async (path) => {
      // Buffers are keyed by relative path: write the current project's
      // edits to its own folder before another project takes the store,
      // or they would show up in (and be saved into) the new one.
      if (
        get().project &&
        !(await saveBeforeLeaving(
          "Open the other project anyway and lose them?",
          "Open without saving",
        ))
      ) {
        return;
      }
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
      set({
        project: info,
        files,
        mainFile,
        openFiles: storedOpen,
        activeFile: null,
        lastSavedContent: null,
        buffers: {},
        snapshots: [],
        labelsByFile: {},
        refsByFile: {},
        citeKeysByFile: {},
        graphicsPathsByFile: {},
        biblatexByFile: {},
        natbibByFile: {},
        ignoredWords: [],
      });
      void api
        .getProjectConfig(info.path)
        .then((config) => {
          if (get().project?.path === info.path) {
            set({ ignoredWords: config.ignoredWords ?? [] });
          }
        })
        .catch(() => {});
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
        const graphicsPathsByFile: Record<string, string[]> = {};
        const biblatexByFile: Record<string, boolean> = {};
        const natbibByFile: Record<string, boolean> = {};
        for (const texPath of collectPaths(files, ".tex")) {
          try {
            const content = await api.readProjectFile(info.path, texPath);
            labelsByFile[texPath] = extractLabels(finalText(content).text);
            refsByFile[texPath] = extractRefPositions(finalText(content).text).map(
              (ref) => ref.name,
            );
            graphicsPathsByFile[texPath] = extractGraphicsPaths(content);
            biblatexByFile[texPath] = loadsBiblatex(content);
            natbibByFile[texPath] = loadsNatbib(content);
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
          graphicsPathsByFile: { ...graphicsPathsByFile, ...state.graphicsPathsByFile },
          biblatexByFile: { ...biblatexByFile, ...state.biblatexByFile },
          natbibByFile: { ...natbibByFile, ...state.natbibByFile },
        }));
      })();
    },

    leaveProject: async () => {
      if (
        !(await saveBeforeLeaving(
          "Close the project anyway and lose them?",
          "Close without saving",
        ))
      ) {
        return false;
      }
      get().closeProject();
      return true;
    },

    closeProject: () => {
      // Dirty buffers are flushed by the caller (see leaveProject).
      void api.setProjectMenuEnabled(false);
      useEditorStore.getState().loadContent("");
      set({
        project: null,
        files: [],
        mainFile: null,
        lastSavedContent: null,
        buffers: {},
        snapshots: [],
        labelsByFile: {},
        refsByFile: {},
        citeKeysByFile: {},
        graphicsPathsByFile: {},
        biblatexByFile: {},
        natbibByFile: {},
        ignoredWords: [],
        openFiles: [],
        activeFile: null,
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
      // Prefer the unsaved buffer over disk so dirty state survives tab
      // switches; lastSavedContent is always the disk text (the save's
      // outside-change check compares against it).
      const onDisk = await api.readProjectFile(project.path, path);
      const content = buffers[path] ?? onDisk;
      useEditorStore.getState().loadContent(content);
      const nextOpen = openFiles.includes(path) ? openFiles : [...openFiles, path];
      set({
        activeFile: path,
        lastSavedContent: onDisk,
        openFiles: nextOpen,
        labelsByFile: {
          ...get().labelsByFile,
          [path]: extractLabels(finalText(content).text),
        },
        refsByFile: {
          ...get().refsByFile,
          [path]: extractRefPositions(finalText(content).text).map((ref) => ref.name),
        },
        citeKeysByFile: { ...get().citeKeysByFile, [path]: extractCiteKeys(content) },
        graphicsPathsByFile: {
          ...get().graphicsPathsByFile,
          [path]: extractGraphicsPaths(content),
        },
        biblatexByFile: { ...get().biblatexByFile, [path]: loadsBiblatex(content) },
        natbibByFile: { ...get().natbibByFile, [path]: loadsNatbib(content) },
      });
      void api.setOpenFiles(project.path, nextOpen);
    },

    closeFile: async (path) => {
      const { project, activeFile, openFiles, buffers } = get();
      if (!openFiles.includes(path)) return;
      // Never lose unsaved changes when a tab is closed.
      if (buffers[path] !== undefined) {
        if (!project) return;
        await api.writeProjectFile(project.path, path, buffers[path]);
        void invalidateGitState();
        const nextBuffers = { ...buffers };
        delete nextBuffers[path];
        set({ buffers: nextBuffers });
      }
      const index = openFiles.indexOf(path);
      const remaining = openFiles.filter((f) => f !== path);
      set({ openFiles: remaining });
      if (project) {
        await api.setOpenFiles(project.path, remaining);
      }
      if (activeFile !== path) return;
      if (remaining.length > 0) {
        const next = remaining[Math.min(index, remaining.length - 1)];
        const onDisk = project ? await api.readProjectFile(project.path, next) : null;
        if (onDisk === null) {
          useEditorStore.getState().loadContent("");
          set({ activeFile: null, lastSavedContent: null });
          return;
        }
        useEditorStore.getState().loadContent(get().buffers[next] ?? onDisk);
        set({ activeFile: next, lastSavedContent: onDisk });
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
        void api.setOpenFiles(project.path, next);
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
      // \includegraphics references resolve against the project as it
      // was before the rename.
      const assetsBefore = new Set(collectAssetPaths(get().files));
      const graphicsPaths = Object.values(get().graphicsPathsByFile).flat();
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
        ...moveFileMetadata(get(), path, newPath),
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
        // Folders and assets: includes under a folder, and graphics
        // references (and \graphicspath folders) that pointed here.
        await syncIncludes(collectPaths(get().files, ".tex"), (content) => {
          const included = replaceIncludeSpecPrefix(content, path, newPath);
          const next = applyEdits(
            included,
            planGraphicsRename(
              included,
              { from: path, to: newPath },
              assetsBefore,
              graphicsPaths,
            ),
          );
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
        ...moveFileMetadata(get(), path, null),
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

    saveActiveFile: async (opts) => {
      // The visual face serializes on a debounce; pending edits land
      // in the store before the dirty check reads it.
      flushPendingSerialize();
      const { project, activeFile, lastSavedContent, buffers } = get();
      if (!activeFile) return false;
      const current = useEditorStore.getState().content;
      const dirty = buffers[activeFile] !== undefined || current !== lastSavedContent;
      if (!dirty) return false;
      if (!project) return false;
      // Changed on disk since it was loaded or saved (git checkout,
      // another editor): never overwrite that silently.
      if (lastSavedContent !== null) {
        const onDisk = await api
          .readProjectFile(project.path, activeFile)
          .catch(() => null);
        if (onDisk !== null && onDisk !== lastSavedContent) {
          if (opts?.background) return false;
          if (!(await confirmOverwrite(activeFile))) return false;
        }
        // The user may have switched tabs meanwhile; the editor now
        // holds another file.
        if (get().activeFile !== activeFile || get().project !== project) return false;
      }
      // Format on save: the formatter itself skips non-.tex files. Not
      // on a background save, which would rewrite text behind the
      // user's back.
      if (useSettingsStore.getState().formatOnSave && !opts?.background)
        formatDocument();
      const content = useEditorStore.getState().content;
      await api.writeProjectFile(project.path, activeFile, content);
      void invalidateGitState();
      set({
        lastSavedContent:
          get().activeFile === activeFile ? content : get().lastSavedContent,
        buffers: withoutWritten(get().buffers, { [activeFile]: content }),
        labelsByFile: {
          ...get().labelsByFile,
          [activeFile]: extractLabels(finalText(content).text),
        },
        refsByFile: {
          ...get().refsByFile,
          [activeFile]: extractRefPositions(finalText(content).text).map(
            (ref) => ref.name,
          ),
        },
        citeKeysByFile: {
          ...get().citeKeysByFile,
          [activeFile]: extractCiteKeys(content),
        },
        graphicsPathsByFile: {
          ...get().graphicsPathsByFile,
          [activeFile]: extractGraphicsPaths(content),
        },
        biblatexByFile: {
          ...get().biblatexByFile,
          [activeFile]: loadsBiblatex(content),
        },
        natbibByFile: {
          ...get().natbibByFile,
          [activeFile]: loadsNatbib(content),
        },
      });
      return true;
    },

    syncFromDisk: async () => {
      const { project, activeFile, lastSavedContent } = get();
      if (!project) return;
      await get()
        .refreshFiles()
        .catch(() => undefined);
      if (!activeFile || lastSavedContent === null) return;
      const onDisk = await api
        .readProjectFile(project.path, activeFile)
        .catch(() => null);
      if (onDisk === null || onDisk === lastSavedContent) return;
      const state = get();
      if (
        state.activeFile !== activeFile ||
        state.lastSavedContent !== lastSavedContent
      )
        return;
      flushPendingSerialize();
      const dirty =
        get().buffers[activeFile] !== undefined ||
        useEditorStore.getState().content !== lastSavedContent;
      // Unsaved edits win for now; the next save asks before overwriting.
      if (dirty) return;
      useEditorStore.getState().loadContent(onDisk);
      set({ lastSavedContent: onDisk });
      get().refreshDocMeta(activeFile, onDisk);
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
      // Unsaved edits go to disk first, so the safety snapshot taken by
      // the restore holds them and they can be brought back.
      await get().flushBuffers();
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

// The preview belongs to one project: reset it when that changes.
useProjectStore.subscribe((state, prev) => {
  if (state.project?.path !== prev.project?.path) {
    usePreviewStore.getState().resetForProject();
  }
});
