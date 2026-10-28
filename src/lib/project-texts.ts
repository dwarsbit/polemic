/**
 * The current text of a project's .tex files and writing edits back:
 * the live editor for the active file, the unsaved buffer for a dirty
 * one, the disk for the rest (written right away).
 */

import { applyEdits, type SourceEdit } from "@/lib/changes";
import { applyEditsInView, type ApplyEditsOptions } from "@/lib/editor-edits";
import { invalidateGitState } from "@/lib/query-client";
import { readProjectFile, writeProjectFile, type FileEntry } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

/** Project-relative paths of all .tex files in the tree, depth first. */
export function texPaths(entries: FileEntry[], out: string[] = []): string[] {
  for (const entry of entries) {
    if (entry.isDir) texPaths(entry.children, out);
    else if (entry.path.toLowerCase().endsWith(".tex")) out.push(entry.path);
  }
  return out;
}

/** The file's text as the user sees it now, or null when unreadable. */
export async function currentText(path: string): Promise<string | null> {
  const store = useProjectStore.getState();
  if (path === store.activeFile) return useEditorStore.getState().content;
  if (store.buffers[path] !== undefined) return store.buffers[path];
  if (!store.project) return null;
  return readProjectFile(store.project.path, path).catch(() => null);
}

/**
 * Applies edits planned against `text` (the file's current text): in
 * the editor for the active file (one undo step), else to the buffer
 * or the file on disk. True when something changed.
 */
export async function writeFileEdits(
  path: string,
  text: string,
  edits: SourceEdit[],
  userEvent: string,
  options?: ApplyEditsOptions,
): Promise<boolean> {
  if (edits.length === 0) return false;
  const store = useProjectStore.getState();
  if (path === store.activeFile) return applyEditsInView(edits, userEvent, options);
  const next = applyEdits(text, edits);
  if (store.buffers[path] !== undefined) {
    store.markDirty(path, next);
    return true;
  }
  if (!store.project) return false;
  await writeProjectFile(store.project.path, path, next);
  void invalidateGitState();
  return true;
}
