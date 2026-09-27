import { useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { IssuesPanel } from "@/components/IssuesPanel";
import { LatexEditor } from "@/components/LatexEditor";
import { PreviewPane } from "@/components/PreviewPane";
import { Sidebar } from "@/components/Sidebar";
import { TabsBar } from "@/components/TabsBar";
import { TopBar } from "@/components/TopBar";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

const AUTO_SAVE_DELAY_MS = 1200;

function ResizeHandle() {
  return <Separator className="w-px bg-border transition-colors hover:bg-primary/50" />;
}

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
      <div className="min-h-0 flex-1">
        <Group orientation="horizontal" className="flex h-full">
          <Panel defaultSize={0.16} minSize={0.12}>
            <Sidebar />
          </Panel>
          <ResizeHandle />
          <Panel defaultSize={0.52} minSize={0.25}>
            <div className="flex h-full flex-col">
              <TabsBar />
              <div className="min-h-0 flex-1">
                <LatexEditor />
              </div>
              <IssuesPanel />
            </div>
          </Panel>
          <ResizeHandle />
          <Panel defaultSize={0.32} minSize={0.18}>
            <PreviewPane />
          </Panel>
        </Group>
      </div>
    </div>
  );
}
