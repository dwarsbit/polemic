import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  FolderOpen,
  Loader2,
  PanelLeft,
  PanelRight,
  Play,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TexHelpDialog } from "@/components/TexHelpDialog";
import { STOPLIGHT_WIDTH, isMac } from "@/lib/platform";
import { detectTex, revealBuildFolder } from "@/lib/tauri";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

type BadgeState = {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
};

function texBadge(tex: Awaited<ReturnType<typeof detectTex>> | undefined): BadgeState {
  if (tex === undefined) return { label: "TeX: checking", variant: "outline" };
  if (tex === null) return { label: "TeX: n/a (browser)", variant: "secondary" };
  if (tex.pdflatex.found && tex.latexmk.found)
    return { label: "TeX ready", variant: "default" };
  if (tex.pdflatex.found) return { label: "latexmk missing", variant: "destructive" };
  return { label: "TeX not found", variant: "destructive" };
}

export function TopBar({
  leftSidebarOpen,
  onToggleLeftSidebar,
  rightSidebarOpen,
  onToggleRightSidebar,
}: {
  leftSidebarOpen: boolean;
  onToggleLeftSidebar: () => void;
  rightSidebarOpen: boolean;
  onToggleRightSidebar: () => void;
}) {
  const [texHelpOpen, setTexHelpOpen] = useState(false);
  const { data: tex } = useQuery({
    queryKey: ["tex-status"],
    queryFn: detectTex,
    staleTime: Infinity,
  });
  const badge = texBadge(tex);

  const project = useProjectStore((s) => s.project);
  const status = usePreviewStore((s) => s.status);
  const compileNow = usePreviewStore((s) => s.compileNow);
  const autoCompile = usePreviewStore((s) => s.autoCompile);
  const toggleAutoCompile = usePreviewStore((s) => s.toggleAutoCompile);

  return (
    <header
      data-tauri-drag-region
      className="flex h-12 shrink-0 items-center justify-between border-b bg-background"
      style={isMac ? { paddingLeft: STOPLIGHT_WIDTH } : undefined}
    >
      <div className="flex min-w-0 items-center gap-1.5 pl-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleLeftSidebar}
          title={leftSidebarOpen ? "Hide sidebar" : "Show sidebar"}
        >
          <PanelLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            void useProjectStore
              .getState()
              .flushBuffers()
              .finally(() => useProjectStore.getState().closeProject());
          }}
          title="Back to projects"
        >
          <ArrowLeft />
        </Button>
        <span className="text-sm font-semibold tracking-tight">Polemic</span>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="truncate text-sm font-medium">{project?.name ?? ""}</span>
      </div>
      <div className="flex items-center gap-2 pr-4">
        <button
          type="button"
          onClick={() => setTexHelpOpen(true)}
          title="TeX status and install help"
        >
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </button>
        <Button
          variant={autoCompile ? "default" : "outline"}
          size="icon"
          onClick={toggleAutoCompile}
          title={`Auto-compile on save: ${autoCompile ? "on" : "off"}`}
        >
          <Zap />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (project) void revealBuildFolder(project.path);
          }}
          title="Reveal build folder in file manager"
        >
          <FolderOpen />
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
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleRightSidebar}
          title={rightSidebarOpen ? "Hide right sidebar" : "Show right sidebar"}
        >
          <PanelRight />
        </Button>
      </div>
      <TexHelpDialog open={texHelpOpen} onOpenChange={setTexHelpOpen} />
    </header>
  );
}
