/**
 * Copying a reference into the open project's bibliography: the one
 * operation every source (local .bib, later Zotero, lookup) shares.
 * The target is the chosen .bib or the project default
 * (bibliography.bib, the first .bib, or a new file at the root).
 */

import { flattenBibPaths, parseBibEntries } from "./bib-entries";
import { applyEditsInView } from "./editor-edits";
import { invalidateGitState } from "./query-client";
import { readProjectFile, writeProjectFile } from "./tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

export interface BibAppendResult {
  /** The project .bib the entry landed in. */
  target: string;
  /** True when the key already existed and nothing was written. */
  alreadyPresent: boolean;
}

/** The keys already defined in the project's .bib files. */
export async function projectBibKeys(): Promise<string[]> {
  const store = useProjectStore.getState();
  if (!store.project) return [];
  const keys: string[] = [];
  for (const path of flattenBibPaths(store.files)) {
    let text: string | undefined =
      path === store.activeFile
        ? useEditorStore.getState().content
        : store.buffers[path];
    if (text === undefined) {
      try {
        text = await readProjectFile(store.project.path, path);
      } catch {
        text = "";
      }
    }
    keys.push(...parseBibEntries(text).entries.map((entry) => entry.key));
  }
  return keys;
}

/**
 * Append one entry's raw BibTeX text to the project's bibliography.
 * Respects unsaved buffers and the active file (one undoable edit);
 * a brand-new bibliography.bib is created and the file tree
 * refreshed. Returns null when no project is open.
 */
export async function appendBibEntryToProject(
  raw: string,
  key: string,
  preferredTarget?: string,
): Promise<BibAppendResult | null> {
  const store = useProjectStore.getState();
  if (!store.project) return null;
  const projectBibs = flattenBibPaths(store.files);
  const target =
    (preferredTarget !== undefined && projectBibs.includes(preferredTarget)
      ? preferredTarget
      : undefined) ??
    projectBibs.find((path) => path === "bibliography.bib") ??
    projectBibs[0] ??
    "bibliography.bib";
  let base: string;
  if (target === store.activeFile) {
    base = useEditorStore.getState().content;
  } else if (store.buffers[target] !== undefined) {
    base = store.buffers[target];
  } else {
    try {
      base = await readProjectFile(store.project.path, target);
    } catch {
      base = "";
    }
  }
  if (parseBibEntries(base).entries.some((entry) => entry.key === key)) {
    return { target, alreadyPresent: true };
  }
  const insert = (base.length > 0 && !base.endsWith("\n") ? "\n\n" : "") + raw + "\n";
  if (target === store.activeFile) {
    applyEditsInView([{ from: base.length, to: base.length, insert }]);
  } else if (store.buffers[target] !== undefined) {
    store.markDirty(target, base + insert);
  } else {
    await writeProjectFile(store.project.path, target, base + insert);
    void invalidateGitState();
    if (!projectBibs.includes(target)) {
      await useProjectStore.getState().refreshFiles();
    }
  }
  store.refreshDocMeta(target, base + insert);
  return { target, alreadyPresent: false };
}
