import { useEffect, useState } from "react";
import { Camera, GitBranch, Info, ListTree } from "lucide-react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { IssuesPanel } from "@/components/IssuesPanel";
import { LatexEditor } from "@/components/LatexEditor";
import { OutlinePanel } from "@/components/OutlinePanel";
import { PreviewPane } from "@/components/PreviewPane";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { Sidebar } from "@/components/Sidebar";
import { GitPanel } from "@/components/GitPanel";
import { SnapshotsPanel } from "@/components/SnapshotsPanel";
import { TabsBar } from "@/components/TabsBar";
import { TopBar } from "@/components/TopBar";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { resolveVersionControl, useSettingsStore } from "@/store/settings";
import { cn } from "cn";

const AUTO_SAVE_DELAY_MS = 1200;
const EDITOR_PANEL_IDS = ["editor-doc", "editor-issues"];

type RightTab = "version-control" | "outline" | "properties";

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
  const versionControl = useSettingsStore((s) => resolveVersionControl(s));
  const issuesRef = usePanelRef();
  const [issuesCollapsed, setIssuesCollapsed] = useState(false);
  const leftSidebarRef = usePanelRef();
  const rightSidebarRef = usePanelRef();
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<RightTab>("version-control");

  const rightTabs = [
    {
      id: "version-control" as const,
      label: versionControl === "git" ? "Git" : "Snapshots",
      icon: versionControl === "git" ? GitBranch : Camera,
    },
    { id: "outline" as const, label: "Outline", icon: ListTree },
    { id: "properties" as const, label: "Properties", icon: Info },
  ];

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

  // Start with the right sidebar collapsed unless a layout was restored.
  // The panels' onResize callbacks keep the open/closed state in sync.
  useEffect(() => {
    if (useSettingsStore.getState().panelLayout?.["right"] === undefined) {
      rightSidebarRef.current?.collapse();
    }
  }, [rightSidebarRef]);

  function toggleIssues() {
    const panel: PanelImperativeHandle | null = issuesRef.current;
    if (!panel) return;
    const wasCollapsed = issuesCollapsed;
    setIssuesCollapsed(!wasCollapsed);
    if (wasCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }

  function toggleLeftSidebar() {
    const panel: PanelImperativeHandle | null = leftSidebarRef.current;
    if (!panel) return;
    const wasOpen = leftSidebarOpen;
    setLeftSidebarOpen(!wasOpen);
    if (wasOpen) {
      panel.collapse();
    } else {
      panel.expand();
    }
  }

  function toggleRightSidebar() {
    const panel: PanelImperativeHandle | null = rightSidebarRef.current;
    if (!panel) return;
    const wasOpen = rightSidebarOpen;
    setRightSidebarOpen(!wasOpen);
    if (wasOpen) {
      panel.collapse();
    } else {
      panel.expand();
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopBar
        leftSidebarOpen={leftSidebarOpen}
        onToggleLeftSidebar={toggleLeftSidebar}
        rightSidebarOpen={rightSidebarOpen}
        onToggleRightSidebar={toggleRightSidebar}
      />
      <div className="min-h-0 flex-1">
        <Group
          orientation="horizontal"
          className="flex h-full"
          defaultLayout={pickLayout(panelLayout, [
            "sidebar",
            "editor",
            "preview",
            "right",
          ])}
          onLayoutChanged={(layout) => persistPanelLayout(layout)}
        >
          <Panel
            id="sidebar"
            defaultSize={0.17}
            minSize={0.12}
            collapsible
            collapsedSize={0}
            panelRef={leftSidebarRef}
            onResize={(size) => setLeftSidebarOpen(size.inPixels > 1)}
          >
            <Sidebar />
          </Panel>
          <Separator className="w-px bg-border transition-colors hover:bg-primary/50" />
          <Panel id="editor" defaultSize={0.42} minSize={0.25}>
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
                onResize={(size) => setIssuesCollapsed(size.inPixels <= 40)}
              >
                <IssuesPanel collapsed={issuesCollapsed} onToggle={toggleIssues} />
              </Panel>
            </Group>
          </Panel>
          <Separator className="w-px bg-border transition-colors hover:bg-primary/50" />
          <Panel id="preview" defaultSize={0.28} minSize={0.15}>
            <PreviewPane />
          </Panel>
          <Separator className="w-px bg-border transition-colors hover:bg-primary/50" />
          <Panel
            id="right"
            defaultSize={0.13}
            minSize={0.1}
            collapsible
            collapsedSize="2.5rem"
            panelRef={rightSidebarRef}
            onResize={(size) => setRightSidebarOpen(size.inPixels > 60)}
          >
            <div className="flex h-full border-l bg-sidebar text-sidebar-foreground">
              {rightSidebarOpen && (
                <div className="min-w-0 flex-1 overflow-hidden">
                  {activeTab === "outline" ? (
                    <OutlinePanel />
                  ) : activeTab === "properties" ? (
                    <PropertiesPanel />
                  ) : versionControl === "git" ? (
                    <GitPanel />
                  ) : (
                    <SnapshotsPanel />
                  )}
                </div>
              )}
              <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-l py-2">
                {rightTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      title={tab.label}
                      aria-current={isActive}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg transition-colors",
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                      onClick={() => {
                        setActiveTab(tab.id);
                        if (!rightSidebarOpen) {
                          rightSidebarRef.current?.expand();
                        }
                      }}
                    >
                      <Icon className="size-4" />
                    </button>
                  );
                })}
              </div>
            </div>
          </Panel>
        </Group>
      </div>
    </div>
  );
}
