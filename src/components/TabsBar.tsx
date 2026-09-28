import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

export function TabsBar() {
  const openFiles = useProjectStore((s) => s.openFiles);
  const activeFile = useProjectStore((s) => s.activeFile);
  const lastSavedContent = useProjectStore((s) => s.lastSavedContent);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const openFile = useProjectStore((s) => s.openFile);
  const closeFile = useProjectStore((s) => s.closeFile);

  if (openFiles.length === 0) return null;

  return (
    <div className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b bg-sidebar px-1 pt-1">
      {openFiles.map((file) => {
        const active = file === activeFile;
        const dirty =
          buffers[file] !== undefined || (active && content !== lastSavedContent);
        return (
          <div
            key={file}
            className={cn(
              "group flex shrink-0 items-center gap-1.5 rounded-t-md border px-2.5 text-xs",
              active
                ? "border-border border-b-transparent bg-background text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/50",
            )}
            onAuxClick={(e) => {
              if (e.button === 1) void closeFile(file);
            }}
          >
            <button
              type="button"
              className="max-w-40 truncate py-1.5"
              onClick={() => void openFile(file)}
            >
              {file.split("/").pop()}
            </button>
            <span
              className={cn(
                "size-1.5 rounded-full",
                dirty ? "bg-primary" : "bg-transparent",
              )}
            />
            <button
              type="button"
              className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
              title="Close tab"
              onClick={() => void closeFile(file)}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
