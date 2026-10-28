import { useState } from "react";
import { ChevronDown, Eye, FolderOpen, Loader2, Pencil, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { EditorFaceToggle } from "@/components/EditorFaceToggle";
import { STOPLIGHT_WIDTH, isMac, isWindows, modKey } from "@/lib/platform";
import { isTauri } from "@/lib/tauri";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";
/** "Show in Finder" and its counterparts on the other platforms. */
const REVEAL_LABEL = isMac
  ? "Show in Finder"
  : isWindows
    ? "Show in Explorer"
    : "Show in file manager";

/**
 * The persistent window header: the project menu (rename, reveal,
 * switch) on the left, the Visual/Code switch in the center, and the
 * preview, auto-compile and Compile controls on the right.
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

  function revealProject() {
    if (!project) return;
    void import("@tauri-apps/plugin-opener")
      .then(({ revealItemInDir }) => revealItemInDir(project.path))
      .catch(() => undefined);
  }

  function switchProject() {
    void useProjectStore
      .getState()
      .flushBuffers()
      .finally(() => useProjectStore.getState().closeProject());
  }

  return (
    <header
      className="relative flex h-11 shrink-0 items-center justify-between bg-transparent text-foreground"
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
      <div className="flex min-w-0 items-center gap-3 pl-3">
        {showProjectControls && (
          <div className="flex min-w-0 items-center gap-1.5">
            {renaming ? (
              <Input
                autoFocus
                className="h-7 w-56 text-sm"
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="max-w-80 gap-1.5 px-2"
                    title="Project"
                  >
                    <FolderOpen className="size-3.5 text-muted-foreground" />
                    <span className="truncate">{project?.name ?? ""}</span>
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-56"
                  // Keep focus in the rename field instead of the trigger.
                  onCloseAutoFocus={(e) => {
                    if (renaming) e.preventDefault();
                  }}
                >
                  <DropdownMenuItem
                    onSelect={() => {
                      if (!project) return;
                      setName(project.name);
                      setRenameError(null);
                      setRenaming(true);
                    }}
                  >
                    <Pencil />
                    Rename project…
                  </DropdownMenuItem>
                  {isTauri() && (
                    <DropdownMenuItem onSelect={revealProject}>
                      <FolderOpen />
                      {REVEAL_LABEL}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={switchProject}>
                    Close project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center">
        <div className="pointer-events-auto">
          <EditorFaceToggle />
        </div>
      </div>
      <div className="flex items-center gap-2 pr-3">
        {showProjectControls && (
          <Button
            variant={previewVisible ? "secondary" : "ghost"}
            size="icon-sm"
            aria-pressed={previewVisible}
            onClick={togglePreview}
            title={`${previewVisible ? "Hide" : "Show"} PDF preview (${modKey}Shift+P)`}
          >
            <Eye className={previewVisible ? undefined : "text-muted-foreground"} />
          </Button>
        )}
        {showProjectControls && (
          <ButtonGroup>
            <Button
              variant={autoCompile ? "secondary" : "outline"}
              size="icon-sm"
              aria-pressed={autoCompile}
              onClick={toggleAutoCompile}
              title={`Auto-compile on save (${autoCompile ? "on" : "off"})`}
            >
              <Zap
                className={
                  autoCompile ? "text-tint-foreground" : "text-muted-foreground"
                }
              />
            </Button>
            <Button
              size="sm"
              title={`Compile (${modKey}Shift+R)`}
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
