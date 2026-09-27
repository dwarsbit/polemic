import { useEffect } from "react";
import { IssuesPanel } from "@/components/IssuesPanel";
import { LatexEditor } from "@/components/LatexEditor";
import { PreviewPane } from "@/components/PreviewPane";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { Separator } from "@/components/ui/separator";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

const AUTO_SAVE_DELAY_MS = 1200;

export function EditorView() {
  const content = useEditorStore((s) => s.content);
  const activeFile = useProjectStore((s) => s.activeFile);

  // Debounced auto-save, then auto-compile when enabled.
  useEffect(() => {
    if (activeFile === null) return;
    const timer = setTimeout(() => {
      void (async () => {
        const saved = await useProjectStore.getState().saveActiveFile();
        if (saved && usePreviewStore.getState().autoCompile) {
          void usePreviewStore.getState().compileNow();
        }
      })();
    }, AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [content, activeFile]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <LatexEditor />
            </div>
            <IssuesPanel />
          </div>
          <Separator orientation="vertical" />
          <div className="w-[38%] shrink-0">
            <PreviewPane />
          </div>
        </div>
      </div>
    </div>
  );
}
