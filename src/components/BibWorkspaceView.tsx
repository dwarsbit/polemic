import { X } from "lucide-react";
import { BibFileEditor } from "@/components/BibFileEditor";
import { useEditorStore } from "@/store/editor";
import { isLibraryPath, libraryRelative, useProjectStore } from "@/store/project";
import { cn } from "cn";

/**
 * The editor window for library .bib files opened without a project:
 * a tab strip of the loose files plus the shared .bib editor. The
 * same store state the in-project tab bar uses.
 */
export function BibWorkspaceView() {
  const openFiles = useProjectStore((s) => s.openFiles);
  const activeFile = useProjectStore((s) => s.activeFile);
  const buffers = useProjectStore((s) => s.buffers);
  const lastSavedContent = useProjectStore((s) => s.lastSavedContent);
  const content = useEditorStore((s) => s.content);

  const libraryTabs = openFiles.filter(isLibraryPath);

  function isDirty(file: string) {
    return (
      buffers[file] !== undefined ||
      (file === activeFile && content !== lastSavedContent)
    );
  }

  return (
    <div className="flex h-full items-stretch justify-center bg-background p-3">
      <div className="flex h-full w-full min-w-0 max-w-4xl flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex shrink-0 items-stretch gap-px border-b bg-muted/40 px-1 pt-1">
          {libraryTabs.map((file) => {
            const name = libraryRelative(file).split("/").pop() ?? file;
            const active = file === activeFile;
            return (
              <div
                key={file}
                className={cn(
                  "group flex shrink-0 items-center gap-1.5 rounded-t-md border px-2.5 text-xs",
                  active
                    ? "border-border border-b-transparent bg-card text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/50",
                )}
              >
                <button
                  type="button"
                  className="max-w-40 truncate py-1.5"
                  title={`Library · ${libraryRelative(file)}`}
                  onClick={() =>
                    void useProjectStore.getState().openLibraryFile(libraryRelative(file))
                  }
                >
                  {name}
                </button>
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    isDirty(file) ? "bg-primary" : "bg-transparent",
                  )}
                />
                <button
                  type="button"
                  className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
                  title="Close tab"
                  onClick={() => void useProjectStore.getState().closeFile(file)}
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="min-h-0 flex-1">
          <BibFileEditor />
        </div>
      </div>
    </div>
  );
}
