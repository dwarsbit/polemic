import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  FolderOpen,
  Keyboard,
  Loader2,
  Play,
  Settings,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsDialog } from "@/components/SettingsDialog";
import { TexHelpDialog } from "@/components/TexHelpDialog";
import { AboutDialog, ShortcutsDialog } from "@/components/HelpDialogs";
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

export function TopBar() {
  const [texHelpOpen, setTexHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
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
    <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
      <div className="flex min-w-0 items-center gap-2">
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
      <div className="flex items-center gap-2">
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
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
        >
          <Settings />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShortcutsOpen(true)}
          title="Keyboard shortcuts"
        >
          <Keyboard />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAboutOpen(true)}
          title="About Polemic"
        >
          <Sparkles />
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
      </div>
      <TexHelpDialog open={texHelpOpen} onOpenChange={setTexHelpOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </header>
  );
}
