import { ask } from "@tauri-apps/plugin-dialog";
import { insertOrEditTable } from "@/lib/editor-table";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AiFixDialog } from "@/components/AiFixDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { ComponentGallery } from "@/components/ComponentGallery";
import { TableDialog } from "@/components/TableDialog";
import { TableGridDialog } from "@/components/TableGridDialog";
import { CsvImportDialog } from "@/components/CsvImportDialog";
import { DocumentSettingsDialog } from "@/components/DocumentSettingsDialog";
import { PackagesDialog } from "@/components/PackagesDialog";
import { EditorView } from "@/components/EditorView";
import { ProjectsView } from "@/components/ProjectsView";
import { TopBar } from "@/components/TopBar";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SettingsDialog } from "@/components/SettingsDialog";
import { AboutDialog, ShortcutsDialog } from "@/components/HelpDialogs";
import { exportPdfAs } from "@/lib/pdf-export";
import { formatDocument } from "@/lib/editor-format";
import { wrapFigure } from "@/lib/editor-figure";
import { insertTikzSnippet } from "@/lib/tikz-snippets";
import { runPanelCommand } from "@/lib/panel-commands";
import { queryClient, refetchGitState } from "@/lib/query-client";
import {
  getSettings,
  gitAvailable,
  isTauri,
  openProjectDialog,
  revealBuildFolder,
} from "@/lib/tauri";
import { addCommentAtCursor } from "@/lib/editor-comments";
import { insertWithCompletion, runEditorCommand } from "@/lib/editor-commands";
import { insertAtCursor } from "@/lib/editor-insert";
import { resyncMenuChecksSoon } from "@/lib/menu-checks";
import { useUiStore, type EditorFace } from "@/store/ui";
import { isMac } from "@/lib/platform";
import { useProjectStore } from "@/store/project";
import { usePreviewStore } from "@/store/preview";
import { applySettingsSideEffects, useSettingsStore } from "@/store/settings";
import { useDialogsStore } from "@/store/dialogs";
import { cn } from "cn";

const HELP_URL = "https://github.com/dwarsbit/polemic#readme";
const ISSUES_URL = "https://github.com/dwarsbit/polemic/issues/new";

function openExternal(url: string): Promise<void> {
  return import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url));
}

/** Leave the project for the projects view, saving open buffers first. */
function closeProjectToStart(): Promise<boolean> {
  return useProjectStore.getState().leaveProject();
}

/** Switch the active file between its Visual and Code faces. */
function setActiveFace(face: EditorFace) {
  const file = useProjectStore.getState().activeFile;
  if (file?.endsWith(".tex")) useUiStore.getState().setTexEditorMode(face);
  else if (file?.endsWith(".bib")) useUiStore.getState().setBibEditorMode(face);
}

function App() {
  const hasProject = useProjectStore((s) => s.project !== null);
  const openProject = useProjectStore((s) => s.openProject);
  const [startupDone, setStartupDone] = useState(false);
  // Keep the splash up for at least 2s so it never flashes on fast startups.
  const [splashMinElapsed, setSplashMinElapsed] = useState(false);
  // macOS fullscreen ignores the custom traffic-light position: the
  // lights sit in the auto-hiding menu bar zone above the app, so the
  // layout shifts down by that zone's height while fullscreen.
  const [fullscreen, setFullscreen] = useState(false);
  const settingsDialogOpen = useSettingsStore((s) => s.settingsDialogOpen);
  const setSettingsDialogOpen = useSettingsStore((s) => s.setSettingsDialogOpen);
  const shortcutsOpen = useDialogsStore((s) => s.shortcutsOpen);
  const setShortcutsOpen = useDialogsStore((s) => s.setShortcutsOpen);
  const aboutOpen = useDialogsStore((s) => s.aboutOpen);
  const setAboutOpen = useDialogsStore((s) => s.setAboutOpen);
  const tableDialogOpen = useDialogsStore((s) => s.tableDialogOpen);
  const setTableDialogOpen = useDialogsStore((s) => s.setTableDialogOpen);
  const packagesDialogOpen = useDialogsStore((s) => s.packagesDialogOpen);
  const setPackagesDialogOpen = useDialogsStore((s) => s.setPackagesDialogOpen);
  const documentSettingsOpen = useDialogsStore((s) => s.documentSettingsOpen);
  const setDocumentSettingsOpen = useDialogsStore((s) => s.setDocumentSettingsOpen);
  const paletteOpen = useDialogsStore((s) => s.paletteOpen);
  const galleryOpen = useDialogsStore((s) => s.galleryOpen);

  // Load preferences, apply theme/auto-compile, and reopen the last project.
  // The loading screen stays up until the startup decision is final.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        useSettingsStore.getState().hydrate(settings);
        applySettingsSideEffects(settings);
        // The Visual/Code face per file kind, from the last session.
        const face = (value: string | null, fallback: EditorFace): EditorFace =>
          value === "visual" || value === "code" ? value : fallback;
        useUiStore
          .getState()
          .hydrateEditorModes(
            face(settings.texEditorMode, "code"),
            face(settings.bibEditorMode, "visual"),
          );
        // Known before the loading screen lifts so the right column does
        // not flash the wrong version-control panel.
        useSettingsStore
          .getState()
          .setGitAvailable(await gitAvailable().catch(() => false));
        const reopen = settings.reopenLastProject ?? true;
        if (reopen && settings.lastProjectPath) {
          try {
            await openProject(settings.lastProjectPath);
          } catch {
            // Project unavailable: start at the projects view.
          }
        }
      } catch {
        // Settings unavailable: start at the projects view.
      }
      if (!cancelled) setStartupDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [openProject]);

  useEffect(() => {
    const timer = setTimeout(() => setSplashMinElapsed(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Track macOS fullscreen for the traffic-light padding (all modes).
  useEffect(() => {
    if (!isMac) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const sync = () =>
          void getCurrentWindow()
            .isFullscreen()
            .then(setFullscreen)
            .catch(() => undefined);
        sync();
        unlisten = await getCurrentWindow().listen("tauri://resize", sync);
      } catch {
        // Browser dev.
      }
    })();
    return () => unlisten?.();
  }, []);

  // Follow OS dark/light changes while theme is "system".
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (useSettingsStore.getState().theme === "system") {
        document.documentElement.classList.toggle("dark", media.matches);
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Flush unsaved buffers to disk before the window closes.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
          event.preventDefault();
          try {
            await useProjectStore.getState().flushBuffers();
          } catch (e) {
            // Never trap the user in the window, never drop edits silently.
            const quit = await ask(
              `Some changes could not be saved:\n\n${e}\n\nClose anyway and lose them?`,
              {
                title: "Unsaved changes",
                kind: "warning",
                okLabel: "Close without saving",
                cancelLabel: "Keep open",
              },
            ).catch(() => false);
            if (!quit) return;
          }
          await getCurrentWindow().destroy();
        });
      } catch {
        // Not running inside the desktop app.
      }
    })();
    return () => unlisten?.();
  }, []);

  // Refetch git state and reload the file tree and the active file when
  // the desktop window regains focus, picking up changes made outside
  // the app (git CLI, other editors). The webview does not emit the
  // browser focus events react-query listens to, and in the browser
  // refetchOnWindowFocus already covers git. Losing focus saves the
  // active file (the only auto-save; a timed one would fight the
  // format-on-save reformatting). That save is a background one: no
  // formatting, no overwriting outside changes.
  useEffect(() => {
    const saveOnBlur = () => {
      void (async () => {
        const saved = await useProjectStore
          .getState()
          .saveActiveFile({ background: true })
          .catch(() => false);
        if (saved && usePreviewStore.getState().autoCompile) {
          void usePreviewStore.getState().compileNow();
        }
      })();
    };
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) {
            void refetchGitState();
            void useProjectStore.getState().syncFromDisk();
          } else saveOnBlur();
        });
      } catch {
        // Not running inside the desktop app: fall back to blur.
        window.addEventListener("blur", saveOnBlur);
      }
    })();
    return () => {
      unlisten?.();
      window.removeEventListener("blur", saveOnBlur);
    };
  }, []);

  // Native OS menu events.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const dialogs = () => useDialogsStore.getState();
        const handlers: [string, () => void][] = [
          // File
          ["menu://new-project", () => void closeProjectToStart()],
          [
            "menu://open-project",
            () =>
              void openProjectDialog()
                .then(
                  (info) => info && useProjectStore.getState().openProject(info.path),
                )
                .catch(() => undefined),
          ],
          ["menu://save", () => void useProjectStore.getState().saveActiveFile()],
          ["menu://compile", () => void usePreviewStore.getState().compileNow()],
          ["menu://export-pdf", () => void exportPdfAs()],
          [
            "menu://reveal-build",
            () => {
              const { project } = useProjectStore.getState();
              if (project) void revealBuildFolder(project.path);
            },
          ],
          ["menu://close-project", () => void closeProjectToStart()],
          // Edit
          ["menu://find", () => runEditorCommand("find")],
          ["menu://toggle-search", () => runPanelCommand("toggle-search")],
          ["menu://format", () => formatDocument()],
          ["menu://add-comment", () => addCommentAtCursor()],
          // Insert
          ["menu://insert-table", () => insertOrEditTable()],
          ["menu://wrap-figure", () => wrapFigure()],
          ["menu://insert-tikz", () => insertTikzSnippet("scaffold")],
          ["menu://insert-csv", () => dialogs().setCsvImport({ path: null })],
          ["menu://insert-citation", () => insertWithCompletion("\\cite{}", 6)],
          ["menu://insert-reference", () => insertWithCompletion("\\ref{}", 5)],
          ["menu://insert-footnote", () => insertAtCursor("\\footnote{}", 10)],
          [
            "menu://insert-display-math",
            () => insertAtCursor("\\[\n  \n\\]", "\\[\n  ".length),
          ],
          // View
          ["menu://face-visual", () => setActiveFace("visual")],
          ["menu://face-code", () => setActiveFace("code")],
          ["menu://toggle-sidebar", () => runPanelCommand("toggle-sidebar")],
          ["menu://toggle-preview", () => runPanelCommand("toggle-preview")],
          ["menu://toggle-right", () => runPanelCommand("toggle-right")],
          ["menu://toggle-issues", () => runPanelCommand("toggle-issues")],
          ["menu://toggle-log", () => runPanelCommand("toggle-log")],
          ["menu://palette", () => dialogs().setPaletteOpen(true)],
          ["menu://zoom-reset", () => usePreviewStore.getState().resetZoom()],
          ["menu://zoom-in", () => usePreviewStore.getState().zoomIn()],
          ["menu://zoom-out", () => usePreviewStore.getState().zoomOut()],
          // Project
          ["menu://packages", () => dialogs().setPackagesDialogOpen(true)],
          ["menu://document-settings", () => dialogs().setDocumentSettingsOpen(true)],
          [
            "menu://sources",
            () => useSettingsStore.getState().openSettings("bibliography"),
          ],
          [
            "menu://take-snapshot",
            () => void useProjectStore.getState().takeSnapshot(),
          ],
          ["menu://commit", () => runPanelCommand("show-version-control")],
          // App and Help
          [
            "menu://settings",
            () => useSettingsStore.getState().setSettingsDialogOpen(true),
          ],
          ["menu://help", () => void openExternal(HELP_URL)],
          ["menu://shortcuts", () => dialogs().setShortcutsOpen(true)],
          ["menu://report-issue", () => void openExternal(ISSUES_URL)],
          ["menu://about", () => dialogs().setAboutOpen(true)],
          // Dev builds only: the Develop menu never ships in release.
          ["menu://component-gallery", () => dialogs().setGalleryOpen(true)],
        ];
        const unsubscribers = await Promise.all(
          handlers.map(([event, handler]) =>
            listen(event, () => {
              handler();
              // Check items flip themselves on click; put them back in
              // step with what the window now shows.
              resyncMenuChecksSoon();
            }),
          ),
        );
        unlisten = () => unsubscribers.forEach((u) => u());
      } catch {
        // Not running inside the desktop app.
      }
    })();
    return () => unlisten?.();
  }, []);

  // Cmd/Ctrl+P opens the palette in the browser; in the desktop app the
  // OS menu accelerator intercepts the key before the webview sees it.
  // The same applies to the Visual/Code shortcuts (Cmd/Ctrl+Alt+1, 2).
  useEffect(() => {
    if (isTauri()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        useDialogsStore.getState().setPaletteOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.altKey) {
        if (event.code === "Digit1" || event.code === "Digit2") {
          event.preventDefault();
          setActiveFace(event.code === "Digit1" ? "visual" : "code");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {!startupDone || !splashMinElapsed ? (
        <LoadingScreen />
      ) : (
        <div
          className={cn(
            "flex h-screen flex-col text-foreground",
            isMac && fullscreen && "pt-7",
          )}
        >
          <TopBar />
          <div className="relative min-h-0 flex-1">
            {hasProject ? <EditorView /> : <ProjectsView />}
            {/* Dev builds only: the import.meta.env.DEV guard lets the
                bundler drop the gallery from release builds entirely. */}
            {import.meta.env.DEV && galleryOpen && (
              <ComponentGallery
                onClose={() => useDialogsStore.getState().setGalleryOpen(false)}
              />
            )}
          </div>
        </div>
      )}
      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      <TableDialog open={tableDialogOpen} onOpenChange={setTableDialogOpen} />
      <TableGridDialog />
      <CsvImportDialog />
      <PackagesDialog open={packagesDialogOpen} onOpenChange={setPackagesDialogOpen} />
      <DocumentSettingsDialog
        open={documentSettingsOpen}
        onOpenChange={setDocumentSettingsOpen}
      />
      {paletteOpen && <CommandPalette />}
      <AiFixDialog />
    </QueryClientProvider>
  );
}

export default App;
