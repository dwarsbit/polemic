import { useEffect, useState } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { buildDocumentOrder } from "@/lib/doc-structure";
import { parseOutline, type OutlineEntry } from "@/lib/outline";
import { readProjectFile, type FileEntry } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

interface FileOutline {
  file: string;
  entries: OutlineEntry[];
}

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

export function OutlinePanel() {
  const project = useProjectStore((s) => s.project);
  const mainFile = useProjectStore((s) => s.mainFile);
  const activeFile = useProjectStore((s) => s.activeFile);
  const files = useProjectStore((s) => s.files);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const [docOutline, setDocOutline] = useState<FileOutline[] | null>(null);

  // Rebuild the document outline (debounced): walk the main file's
  // includes, use the live editor content for the active file and
  // unsaved buffers or disk for the rest.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!project || !mainFile) {
          setDocOutline(null);
          return;
        }
        const texPaths = collectTexPaths(files);
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
        const order = await buildDocumentOrder(mainFile, readText, texPaths);
        if (cancelled) return;
        const groups: FileOutline[] = [];
        for (const path of order) {
          const text = await readText(path);
          groups.push({ file: path, entries: text === null ? [] : parseOutline(text) });
        }
        if (!cancelled) setDocOutline(groups);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, mainFile, activeFile, files, buffers, content]);

  function goTo(file: string, line: number) {
    if (file === activeFile) {
      jumpTo(line);
      return;
    }
    void useProjectStore
      .getState()
      .openFile(file)
      .then(() => jumpTo(line));
  }

  const singleFile = docOutline !== null && docOutline.length === 1;

  return (
    <div className="flex h-full flex-col">
      <SectionHeader label="OUTLINE" collapsed={false} />
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {docOutline === null || docOutline.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            {activeFile ? "No sections in this document." : "No file open."}
          </p>
        ) : (
          docOutline.map((group) => (
            <div key={group.file} className="mb-1">
              {!singleFile && (
                <button
                  type="button"
                  title={`Open ${group.file}`}
                  className="block w-full truncate rounded px-2 py-1 text-left text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => goTo(group.file, 1)}
                >
                  {group.file}
                </button>
              )}
              {group.entries.map((entry) => (
                <button
                  key={`${group.file}-${entry.line}-${entry.title}`}
                  type="button"
                  className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-accent"
                  style={{ paddingLeft: `${8 + entry.level * 12}px` }}
                  onClick={() => goTo(group.file, entry.line)}
                >
                  {entry.title}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
