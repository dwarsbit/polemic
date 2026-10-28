import { useEffect, useRef, useState } from "react";
import { texPaths } from "@/lib/project-texts";
import { readProjectFile, type FileEntry } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

/**
 * The text of every .tex file in the project, kept current: the live
 * editor for the active file, buffers for unsaved ones, the disk for
 * the rest (cached per file tree). Null until the first read. `reload`
 * reads the disk again after the caller wrote files there.
 */
export function useProjectTexts(): {
  texts: Map<string, string> | null;
  reload: () => void;
} {
  const project = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  const activeFile = useProjectStore((s) => s.activeFile);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const [texts, setTexts] = useState<Map<string, string> | null>(null);
  const [diskTick, setDiskTick] = useState(0);
  const diskCache = useRef<{
    files: FileEntry[];
    tick: number;
    texts: Map<string, string>;
  }>({ files: [], tick: 0, texts: new Map() });

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const cache = diskCache.current;
        if (cache.files !== files || cache.tick !== diskTick) {
          cache.files = files;
          cache.tick = diskTick;
          cache.texts.clear();
        }
        const found = new Map<string, string>();
        for (const path of texPaths(files)) {
          let text: string | undefined;
          if (path === activeFile) text = content;
          else if (buffers[path] !== undefined) text = buffers[path];
          else {
            text = cache.texts.get(path);
            if (text === undefined) {
              text =
                (await readProjectFile(project.path, path).catch(() => null)) ?? "";
              cache.texts.set(path, text);
            }
          }
          found.set(path, text);
        }
        if (!cancelled) setTexts(found);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, files, activeFile, content, buffers, diskTick]);

  return { texts, reload: () => setDiskTick((tick) => tick + 1) };
}
