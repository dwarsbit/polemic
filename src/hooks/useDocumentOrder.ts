import { useEffect, useState } from "react";
import { buildDocumentOrder } from "@/lib/doc-structure";
import { readProjectFile, type FileEntry } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

function collectTexPaths(entries: FileEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isDir) {
      paths.push(...collectTexPaths(entry.children));
    } else if (entry.path.endsWith(".tex")) {
      paths.push(entry.path);
    }
  }
  return paths;
}

/**
 * The project's files in document order (include walk from the main
 * file), recomputed with a debounce. The active file's content comes
 * from the live editor, other files from unsaved buffers or disk.
 * Returns null until resolved (or when there is no main file).
 */
export function useDocumentOrder(): string[] | null {
  const project = useProjectStore((s) => s.project);
  const mainFile = useProjectStore((s) => s.mainFile);
  const activeFile = useProjectStore((s) => s.activeFile);
  const files = useProjectStore((s) => s.files);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const [order, setOrder] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!project || !mainFile) {
          setOrder(null);
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
        const next = await buildDocumentOrder(
          mainFile,
          readText,
          collectTexPaths(files),
        );
        if (!cancelled) setOrder(next);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, mainFile, activeFile, files, buffers, content]);

  return order;
}
