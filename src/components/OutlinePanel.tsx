import { useEffect, useState } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { useDocumentOrder } from "@/hooks/useDocumentOrder";
import { parseOutline, type OutlineEntry } from "@/lib/outline";
import { readProjectFile } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

interface FileOutline {
  file: string;
  entries: OutlineEntry[];
}

export function OutlinePanel() {
  const project = useProjectStore((s) => s.project);
  const activeFile = useProjectStore((s) => s.activeFile);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const order = useDocumentOrder();
  const [docOutline, setDocOutline] = useState<FileOutline[] | null>(null);

  // Parse sections per ordered file (debounced): the active file from
  // the live editor content, other files from buffers or disk.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!project || order === null) {
          setDocOutline(null);
          return;
        }
        const groups: FileOutline[] = [];
        for (const path of order) {
          let text: string | null;
          if (path === activeFile) {
            text = content;
          } else if (buffers[path] !== undefined) {
            text = buffers[path];
          } else {
            try {
              text = await readProjectFile(project.path, path);
            } catch {
              text = null;
            }
          }
          groups.push({ file: path, entries: text === null ? [] : parseOutline(text) });
        }
        if (!cancelled) setDocOutline(groups);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, order, activeFile, buffers, content]);

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
