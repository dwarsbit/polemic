import { useEffect, useState } from "react";
import { buildDocumentOrder, texPathsOf } from "@/lib/doc-structure";
import { readProjectFile } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

export interface DocumentStructure {
  /** Files in document order, main file first. */
  order: string[];
  /** Each included file's including file. */
  parents: ReadonlyMap<string, string>;
}

/** The last computed structure per project, so reopening the files
 * panel does not flash the tree in its unsorted order first. */
const structureCache = new Map<string, DocumentStructure>();

/**
 * The project's files in document order (include walk from the main
 * file), recomputed with a debounce. The active file's content comes
 * from the live editor, other files from unsaved buffers or disk.
 * Returns null until resolved (or when there is no main file).
 */
export function useDocumentOrder(): string[] | null {
  return useDocumentStructure()?.order ?? null;
}

/** The document order plus the include parents (see useDocumentOrder). */
export function useDocumentStructure(): DocumentStructure | null {
  const project = useProjectStore((s) => s.project);
  const mainFile = useProjectStore((s) => s.mainFile);
  const activeFile = useProjectStore((s) => s.activeFile);
  const files = useProjectStore((s) => s.files);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const [structure, setStructure] = useState<DocumentStructure | null>(() =>
    project ? (structureCache.get(project.path) ?? null) : null,
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!project || !mainFile) {
          setStructure(null);
          return;
        }
        const readText = async (path: string): Promise<string | null> => {
          if (path === activeFile) return content;
          const buffer = buffers[path];
          if (buffer !== undefined) return buffer;
          try {
            return await readProjectFile(project.path, path);
          } catch {
            return null;
          }
        };
        const parents = new Map<string, string>();
        const order = await buildDocumentOrder(
          mainFile,
          readText,
          texPathsOf(files),
          parents,
        );
        if (!cancelled) {
          const next = { order, parents };
          structureCache.set(project.path, next);
          setStructure(next);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, mainFile, activeFile, files, buffers, content]);

  return structure;
}
