import { useEffect, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { IssuesPanel } from "@/components/IssuesPanel";
import { LatexEditor } from "@/components/LatexEditor";
import { PreviewPane } from "@/components/PreviewPane";
import { Sidebar } from "@/components/Sidebar";
import { TabsBar } from "@/components/TabsBar";
import { TopBar } from "@/components/TopBar";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

const AUTO_SAVE_DELAY_MS = 1200;
const EDITOR_PANEL_IDS = ["editor-doc", "editor-issues"];

function pickLayout(
  all: Record<string, number> | null,
  ids: string[],
): Record<string, number> | undefined {
  if (!all) return undefined;
  const picked = Object.fromEntries(
    ids.filter((id) => all[id] !== undefined).map((id) => [id, all[id]]),
  );
  return Object.keys(picked).length === ids.length ? picked : undefined;
}

export function EditorView() {
  const content = useEditorStore((s) => s.content);
  const activeFile = useProjectStore((s) => s.activeFile);
  const panelLayout = useSettingsStore((s) => s.panelLayout);
  const persistPanelLayout = useSettingsStore((s) => s.persistPanelLayout);
  const issuesRef = usePanelRef();
  const [issuesCollapsed, setIssuesCollapsed] = useState(false);

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

  function toggleIssues() {
    const panel: PanelImperativeHandle | null = issuesRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
    setIssuesCollapsed(panel.isCollapsed());
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopBar />
      <div className="min-h-0 flex-1">
        <Group
          orientation="horizontal"
          className="flex h-full"
          defaultLayout={pickLayout(panelLayout, ["sidebar", "editor", "preview"])}
          onLayoutChanged={(layout) => persistPanelLayout(layout)}
        >
          <Panel id="sidebar" defaultSize={0.16} minSize={0.12}>
            <Sidebar />
          </Panel>
          <Separator className="w-px bg-border transition-colors hover:bg-primary/50" />
          <Panel id="editor" defaultSize={0.52} minSize={0.25}>
            <Group
              orientation="vertical"
              className="h-full"
              defaultLayout={pickLayout(panelLayout, EDITOR_PANEL_IDS)}
              onLayoutChanged={(layout) => persistPanelLayout(layout)}
            >
              <Panel id="editor-doc" defaultSize={0.72} minSize={0.3}>
                <div className="flex h-full flex-col">
                  <TabsBar />
                  <div className="min-h-0 flex-1">
                    <LatexEditor />
                  </div>
                </div>
              </Panel>
              <Separator className="h-px w-full bg-border transition-colors hover:bg-primary/50" />
              <Panel
                id="editor-issues"
                defaultSize={0.28}
                minSize={0.1}
                collapsible
                collapsedSize="2rem"
                panelRef={issuesRef}
              >
                <IssuesPanel collapsed={issuesCollapsed} onToggle={toggleIssues} />
              </Panel>
            </Group>
          </Panel>
          <Separator className="w-px bg-border transition-colors hover:bg-primary/50" />
          <Panel id="preview" defaultSize={0.32} minSize={0.18}>
            <PreviewPane />
          </Panel>
        </Group>
      </div>
    </div>
  );
}
