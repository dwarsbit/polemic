import { useMemo } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { parseOutline } from "@/lib/outline";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

export function OutlinePanel() {
  const activeFile = useProjectStore((s) => s.activeFile);
  const content = useEditorStore((s) => s.content);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const outline = useMemo(() => parseOutline(content), [content]);

  return (
    <div className="flex h-full flex-col">
      <SectionHeader label="OUTLINE" collapsed={false} />
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {outline.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            {activeFile ? "No sections in this file." : "No file open."}
          </p>
        ) : (
          <ul>
            {outline.map((entry) => (
              <li key={`${entry.line}-${entry.title}`}>
                <button
                  type="button"
                  className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-accent"
                  style={{ paddingLeft: `${8 + entry.level * 12}px` }}
                  onClick={() => jumpTo(entry.line)}
                >
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
