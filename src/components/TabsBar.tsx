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
    <div className="flex h-8 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b bg-muted/30">
      {openFiles.map((file) => {
        const active = file === activeFile;
        const dirty =
          buffers[file] !== undefined || (active && content !== lastSavedContent);
        return (
          <div
            key={file}
            className={cn(
              "group flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs",
              active ? "border-primary bg-background" : "border-transparent",
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
