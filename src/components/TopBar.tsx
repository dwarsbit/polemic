import { useState } from "react";
import { Loader2, Pencil, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { STOPLIGHT_WIDTH, isMac } from "@/lib/platform";
import { isTauri } from "@/lib/tauri";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

export function TopBar() {
  const project = useProjectStore((s) => s.project);
  const status = usePreviewStore((s) => s.status);
  const compileNow = usePreviewStore((s) => s.compileNow);
  const autoCompile = usePreviewStore((s) => s.autoCompile);
  const toggleAutoCompile = usePreviewStore((s) => s.toggleAutoCompile);

  // Inline rename of the project (the folder is renamed on disk).
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  async function commitRename() {
    const trimmed = name.trim();
    setRenameError(null);
    if (!project || !trimmed || trimmed === project.name) {
      setRenaming(false);
      return;
    }
    try {
      await useProjectStore.getState().renameProject(trimmed);
      setRenaming(false);
    } catch (e) {
      setRenameError(String(e));
    }
  }

  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between bg-transparent text-foreground"
      style={isMac ? { paddingLeft: STOPLIGHT_WIDTH } : undefined}
      onPointerDown={(event) => {
        // Drag the window from the header: anywhere except its
        // interactive controls.
        if (event.button !== 0 || !isTauri()) return;
        if ((event.target as HTMLElement).closest("button, input")) return;
        void import("@tauri-apps/api/window")
          .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
          .catch(() => undefined);
      }}
    >
      <div className="flex min-w-0 items-center gap-1.5 pl-4">
        {renaming ? (
          <Input
            autoFocus
            className="h-7 w-52 text-sm"
            value={name}
            title={renameError ?? undefined}
            aria-invalid={renameError !== null}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              if (e.key === "Escape") {
                setRenameError(null);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span className="group/name flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{project?.name ?? ""}</span>
            {project && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100"
                title="Rename project"
                onClick={() => {
                  setName(project.name);
                  setRenameError(null);
                  setRenaming(true);
                }}
              >
                <Pencil className="size-3" />
              </Button>
            )}
          </span>
        )}
        {renameError && (
          <span className="truncate text-xs text-destructive" title={renameError}>
            {renameError}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 pr-4">
        <ButtonGroup title="Compile the project now">
          <Button
            variant={autoCompile ? "default" : "outline"}
            size="icon-sm"
            onClick={toggleAutoCompile}
            title={`Auto-compile on save: ${autoCompile ? "on" : "off"}`}
          >
            <Zap />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void compileNow()}
            disabled={status === "compiling"}
          >
            {status === "compiling" ? <Loader2 className="animate-spin" /> : <Play />}
            Compile
          </Button>
        </ButtonGroup>
      </div>
    </header>
  );
}
