import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { useDocumentOrder } from "@/hooks/useDocumentOrder";
import { parseOutline, type OutlineEntry } from "@/lib/outline";
import { readProjectFile } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { cn } from "cn";

interface FileOutline {
  file: string;
  entries: OutlineEntry[];
}

/** A section with its nested subsections. */
interface SectionNode {
  entry: OutlineEntry;
  children: SectionNode[];
}

/** Nest the flat parsed entries by their section level. */
function buildTree(entries: OutlineEntry[]): SectionNode[] {
  const roots: SectionNode[] = [];
  const stack: SectionNode[] = [];
  for (const entry of entries) {
    const node: SectionNode = { entry, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].entry.level >= entry.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

export function OutlinePanel() {
  const project = useProjectStore((s) => s.project);
  const activeFile = useProjectStore((s) => s.activeFile);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const order = useDocumentOrder();
  const [docOutline, setDocOutline] = useState<FileOutline[] | null>(null);

  // Per-session expansion state: nodes start expanded, so only the
  // collapsed keys are tracked.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

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

  function renderNode(node: SectionNode, file: string, depth: number): ReactNode {
    const key = `${file}:${node.entry.line}`;
    const isCollapsed = collapsed.has(key);
    return (
      <div key={key}>
        <div
          className="flex items-center rounded hover:bg-accent"
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          {node.children.length > 0 ? (
            <Caret expanded={!isCollapsed} onClick={() => toggle(key)} />
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <button
            type="button"
            className="min-w-0 flex-1 truncate py-1 text-left text-sm"
            title={node.entry.title}
            onClick={() => goTo(file, node.entry.line)}
            onDoubleClick={() => {
              if (node.children.length > 0) toggle(key);
            }}
          >
            {node.entry.title}
          </button>
        </div>
        {!isCollapsed &&
          node.children.map((child) => renderNode(child, file, depth + 1))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader label="OUTLINE" collapsed={false} />
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {docOutline === null || docOutline.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            {activeFile ? "No sections in this document." : "No file open."}
          </p>
        ) : (
          docOutline.map((group) => {
            const fileKey = `file:${group.file}`;
            const isCollapsed = collapsed.has(fileKey);
            const roots = buildTree(group.entries);
            return (
              <div key={group.file} className="mb-1">
                <div className="flex items-center rounded hover:bg-accent">
                  {roots.length > 0 ? (
                    <Caret expanded={!isCollapsed} onClick={() => toggle(fileKey)} />
                  ) : (
                    <span className="size-5 shrink-0" />
                  )}
                  <button
                    type="button"
                    title={`Open ${group.file}`}
                    className="min-w-0 flex-1 truncate py-1 pl-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => goTo(group.file, 1)}
                    onDoubleClick={() => {
                      if (roots.length > 0) toggle(fileKey);
                    }}
                  >
                    {group.file}
                  </button>
                </div>
                {!isCollapsed &&
                  roots.map((root) => renderNode(root, group.file, 1))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** The disclosure triangle; rotated when its node is expanded. */
function Caret({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={expanded ? "Collapse" : "Expand"}
      className="flex size-5 shrink-0 items-center justify-center"
      onClick={onClick}
    >
      <ChevronRight
        className={cn("size-3 transition-transform", expanded && "rotate-90")}
      />
    </button>
  );
}
