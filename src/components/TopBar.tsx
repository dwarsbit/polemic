import { useState } from "react";
import { Eye, FolderOpen, Loader2, Pencil, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { EditorFaceToggle } from "@/components/EditorFaceToggle";
import { STOPLIGHT_WIDTH, isMac } from "@/lib/platform";
import { isTauri } from "@/lib/tauri";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";
/**
 * The persistent window header: the project controls (name, rename,
 * switch, compile) when a project is open.
 */
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

  const showProjectControls = project !== null;
  const panelLayout = useSettingsStore((s) => s.panelLayout);
  const previewVisible = panelLayout?.["preview-visible"] !== 0;
  const togglePreview = () =>
    useSettingsStore.getState().persistPanelLayout({
      "preview-visible": previewVisible ? 0 : 1,
    });

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

  function switchProject() {
    void useProjectStore
      .getState()
      .flushBuffers()
      .finally(() => useProjectStore.getState().closeProject());
  }

  return (
    <header
      className="relative flex h-12 shrink-0 items-center justify-between bg-transparent text-foreground"
      style={isMac ? { paddingLeft: STOPLIGHT_WIDTH } : undefined}
      onPointerDown={(event) => {
        // Drag the window from the header: anywhere except its
        // interactive controls.
        if (event.button !== 0 || !isTauri()) return;
        if ((event.target as HTMLElement).closest("button, input")) return;
      }}
    >
      <div className="flex min-w-0 items-center gap-3 pl-4">
        {showProjectControls && (
          <div className="flex min-w-0 items-center gap-1.5">
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
                <span className="truncate text-sm font-medium">
                  {project?.name ?? ""}
                </span>
                {project && (
                  <>
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
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100"
                      title="Switch project"
                      onClick={switchProject}
                    >
                      <FolderOpen className="size-3" />
                    </Button>
                  </>
                )}
              </span>
            )}
            {renameError && (
              <span className="truncate text-xs text-destructive" title={renameError}>
                {renameError}
              </span>
            )}
          </div>
        )}
      </div>
      {/* The Visual/Code switch sits in the window's center; the
          pointer-events wrapper keeps empty space clickable. */}
      {/* The Visual/Code switch sits in the window's center; the
          pointer-events wrapper keeps empty space clickable. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center">
        <div className="pointer-events-auto">
          <EditorFaceToggle />
        </div>
      </div>
      <div className="flex items-center gap-2 pr-4">
          {showProjectControls && (
            <Button
              variant={previewVisible ? "default" : "outline"}
              size="icon-sm"
              onClick={togglePreview}
              title={`PDF preview: ${previewVisible ? "visible" : "hidden"}`}
            >
              <Eye />
            </Button>
          )}
          {showProjectControls && (
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
          )}
      </div>
    </header>
  );
}
