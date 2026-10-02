import { useEffect, useState } from "react";
import { Camera, GitBranch, History, Info, MessageSquare } from "lucide-react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { CommentDialog } from "@/components/CommentDialog";
import { CommentsPanel } from "@/components/CommentsPanel";
import { IssuesPanel } from "@/components/IssuesPanel";
import type { IssuesTool } from "@/components/IssuesPanel";
import { LatexEditor } from "@/components/LatexEditor";
import { BibFileEditor } from "@/components/BibFileEditor";
import { LeftRail } from "@/components/LeftRail";
import { PreviewPane } from "@/components/PreviewPane";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { RightRail } from "@/components/RightRail";
import { SearchPanel } from "@/components/SearchPanel";
import { Sidebar } from "@/components/Sidebar";
import type { LeftTab } from "@/components/Sidebar";
import { GitPanel } from "@/components/GitPanel";
import { HistoryPanel } from "@/components/HistoryPanel";
import { SnapshotsPanel } from "@/components/SnapshotsPanel";
import { StatusBar } from "@/components/StatusBar";
import { TabsBar } from "@/components/TabsBar";
import { EditorToolbar } from "@/components/EditorToolbar";
import { VisualTexEditor } from "@/components/VisualTexEditor";
import { setPanelCommandHandler } from "@/lib/panel-commands";
import { setCommentDialogHandler, type CommentTarget } from "@/lib/editor-comments";
import { useCommentsStore } from "@/store/comments";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { resolveVersionControl, useSettingsStore } from "@/store/settings";
import { useUiStore } from "@/store/ui";
import { cn } from "cn";

const COLUMN_PANEL_IDS = ["navigator", "editor", "preview", "properties"];
const ROW_PANEL_IDS = ["columns", "issues"];

/** Panels float as white cards on the window backdrop. */
const CARD = "h-full overflow-hidden rounded-xl border bg-card shadow-sm";
/** Resize handles live in the backdrop gap between cards. */
const HANDLE_X = "w-2 rounded bg-transparent hover:bg-primary/20";
const HANDLE_Y = "h-2 w-full rounded bg-transparent hover:bg-primary/20";

type RightTab = "version-control" | "history" | "comments" | "properties";

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
  const panelLayout = useSettingsStore((s) => s.panelLayout);
  const persistPanelLayout = useSettingsStore((s) => s.persistPanelLayout);
  // The PDF preview is optional; hidden panels restore hidden.
  const previewVisible = panelLayout?.["preview-visible"] !== 0;
  const togglePreview = () =>
    useSettingsStore.getState().persistPanelLayout({
      "preview-visible": previewVisible ? 0 : 1,
    });
  const versionControl = useSettingsStore((s) => resolveVersionControl(s));

  const navigatorRef = usePanelRef();
  const propertiesRef = usePanelRef();
  const issuesRef = usePanelRef();
  const [navigatorOpen, setNavigatorOpen] = useState(true);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(true);
  const [navigatorTab, setNavigatorTab] = useState<LeftTab>("files");
  const [rightTab, setRightTab] = useState<RightTab>("version-control");
  const [issuesTool, setIssuesTool] = useState<IssuesTool>("issues");
  const activeFile = useProjectStore((s) => s.activeFile);
  // .bib files edit through their own two-faced editor.
  const activeFileIsBib = activeFile !== null && activeFile.endsWith(".bib");
  const activeFileIsTex = activeFile !== null && activeFile.endsWith(".tex");
  const texEditorMode = useUiStore((s) => s.texEditorMode);
  const texVisual = activeFileIsTex && texEditorMode === "visual";
  const jumpTarget = useEditorStore((s) => s.jumpTarget);

  // A jump request (labels, bibliography) needs the source text.
  useEffect(() => {
    if (jumpTarget !== null && activeFileIsTex) {
      useUiStore.getState().setTexEditorMode("code");
    }
  }, [jumpTarget, activeFileIsTex]);

  const rightTabs = [
    {
      id: "version-control" as const,
      label: versionControl === "git" ? "Git" : "Snapshots",
      icon: versionControl === "git" ? GitBranch : Camera,
    },
    { id: "comments" as const, label: "Comments", icon: MessageSquare },
    ...(versionControl === "git"
      ? [{ id: "history" as const, label: "History", icon: History }]
      : []),
    { id: "properties" as const, label: "Properties", icon: Info },
  ];

  // Start with the properties column collapsed unless a layout was
  // restored. The panels' onResize callbacks keep the open/closed state
  // in sync.
  useEffect(() => {
    if (useSettingsStore.getState().panelLayout?.["properties"] === undefined) {
      propertiesRef.current?.collapse();
    }
  }, [propertiesRef]);

  /** JetBrains-style rail clicks: the active icon of an open dock hides
   *  it, any other icon switches the panel and shows it. */
  function selectNavigatorTab(tab: LeftTab) {
    if (navigatorOpen && tab === navigatorTab) {
      navigatorRef.current?.collapse();
      return;
    }
    setNavigatorTab(tab);
    if (!navigatorOpen) navigatorRef.current?.expand();
  }

  function selectRightTab(tab: string) {
    const next = tab as RightTab;
    if (propertiesOpen && next === rightTab) {
      propertiesRef.current?.collapse();
      return;
    }
    setRightTab(next);
    if (!propertiesOpen) propertiesRef.current?.expand();
  }

  function selectIssuesTool(tool: IssuesTool) {
    if (issuesOpen && tool === issuesTool) {
      issuesRef.current?.collapse();
      return;
    }
    setIssuesTool(tool);
    if (!issuesOpen) issuesRef.current?.expand();
  }

  function toggleNavigator() {
    const panel = navigatorRef.current;
    if (!panel) return;
    if (navigatorOpen) {
      panel.collapse();
    } else {
      panel.expand();
    }
  }

  function toggleProperties() {
    const panel = propertiesRef.current;
    if (!panel) return;
    if (propertiesOpen) {
      panel.collapse();
    } else {
      panel.expand();
    }
  }

  function toggleIssues() {
    const panel = issuesRef.current;
    if (!panel) return;
    if (issuesOpen) {
      panel.collapse();
    } else {
      panel.expand();
    }
  }

  // Comments: load on open, host the add/edit dialog.
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null);
  useEffect(() => {
    setCommentDialogHandler(setCommentTarget);
    void useCommentsStore.getState().load();
    return () => {
      setCommentDialogHandler(null);
      useCommentsStore.setState({ comments: [], loaded: false });
    };
  }, []);

  // Serve the OS menu and the command palette while the editor is up.
  useEffect(() => {
    setPanelCommandHandler("toggle-sidebar", toggleNavigator);
    setPanelCommandHandler("toggle-preview", togglePreview);
    setPanelCommandHandler("toggle-right", toggleProperties);
    setPanelCommandHandler("toggle-search", () => selectIssuesTool("search"));
    setPanelCommandHandler("toggle-issues", () => selectIssuesTool("issues"));
    setPanelCommandHandler("toggle-log", () => selectIssuesTool("log"));
    setPanelCommandHandler("show-bibliography", () => selectNavigatorTab("bibliography"));
    return () => {
      setPanelCommandHandler("toggle-sidebar", null);
      setPanelCommandHandler("toggle-preview", null);
      setPanelCommandHandler("toggle-right", null);
      setPanelCommandHandler("toggle-search", null);
      setPanelCommandHandler("toggle-issues", null);
      setPanelCommandHandler("toggle-log", null);
      setPanelCommandHandler("show-bibliography", null);
    };
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <LeftRail
          navigatorTab={navigatorTab}
          navigatorOpen={navigatorOpen}
          onSelectNavigatorTab={selectNavigatorTab}
          issuesTool={issuesTool}
          issuesOpen={issuesOpen}
          onSelectIssuesTool={selectIssuesTool}
        />
        <div className="flex min-w-0 flex-1 flex-col p-2">
          <Group
            orientation="vertical"
            className="flex min-h-0 flex-1"
            defaultLayout={pickLayout(panelLayout, ROW_PANEL_IDS)}
            onLayoutChanged={(layout) => persistPanelLayout(layout)}
          >
            <Panel id="columns" defaultSize="72%" minSize="25%">
              <Group
                orientation="horizontal"
                className="flex h-full"
                defaultLayout={pickLayout(panelLayout, COLUMN_PANEL_IDS)}
                onLayoutChanged={(layout) => persistPanelLayout(layout)}
              >
                <Panel
                  id="navigator"
                  defaultSize="17%"
                  minSize="176px"
                  collapsible
                  collapsedSize="0px"
                  panelRef={navigatorRef}
                  onResize={(size) => setNavigatorOpen(size.inPixels > 60)}
                >
                  <div className={cn(CARD, "flex")}>
                    <Sidebar activeTab={navigatorTab} />
                  </div>
                </Panel>
                {navigatorOpen && <Separator className={HANDLE_X} />}
                <Panel id="editor" defaultSize="42%" minSize="25%">
                  <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
                    <TabsBar />
                    {!activeFileIsBib && !texVisual && <EditorToolbar />}
                    <div className="min-h-0 flex-1">
                      {activeFileIsBib ? (
                        <BibFileEditor />
                      ) : (
                        <div className="flex h-full flex-col">
                          {/* The CodeMirror view stays mounted across the
                              Visual/Code toggle so undo history survives. */}
                          <div className={cn("min-h-0 flex-1", texVisual && "hidden")}>
                            <LatexEditor visible={!texVisual} />
                          </div>
                          {texVisual && <VisualTexEditor />}
                        </div>
                      )}
                    </div>
                  </div>
                </Panel>
                {previewVisible && (
                  <>
                    <Separator className={HANDLE_X} />
                    <Panel id="preview" defaultSize="28%" minSize="15%">
                      <div className={CARD}>
                        <PreviewPane />
                      </div>
                    </Panel>
                  </>
                )}
                {propertiesOpen && <Separator className={HANDLE_X} />}
                <Panel
                  id="properties"
                  defaultSize="13%"
                  minSize="200px"
                  collapsible
                  collapsedSize="0px"
                  panelRef={propertiesRef}
                  onResize={(size) => setPropertiesOpen(size.inPixels > 60)}
                >
                  <div className={cn(CARD, "flex")}>
                    {propertiesOpen && (
                      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                        {rightTab === "comments" ? (
                          <CommentsPanel />
                        ) : rightTab === "properties" ? (
                          <PropertiesPanel />
                        ) : rightTab === "history" && versionControl === "git" ? (
                          <HistoryPanel />
                        ) : versionControl === "git" ? (
                          <GitPanel />
                        ) : (
                          <SnapshotsPanel />
                        )}
                      </div>
                    )}
                  </div>
                </Panel>
              </Group>
            </Panel>
            {issuesOpen && <Separator className={HANDLE_Y} />}
            <Panel
              id="issues"
              defaultSize="28%"
              minSize="96px"
              collapsible
              collapsedSize="0px"
              panelRef={issuesRef}
              onResize={(size) => setIssuesOpen(size.inPixels > 40)}
            >
              {issuesTool === "search" ? (
                <SearchPanel onToggle={toggleIssues} />
              ) : (
                <IssuesPanel tool={issuesTool} onToggle={toggleIssues} />
              )}
            </Panel>
          </Group>
        </div>
        <RightRail
          tabs={rightTabs}
          activeTab={rightTab}
          panelOpen={propertiesOpen}
          onSelect={selectRightTab}
        />
      </div>
      <StatusBar />
      <CommentDialog target={commentTarget} onClose={() => setCommentTarget(null)} />
    </div>
  );
}
