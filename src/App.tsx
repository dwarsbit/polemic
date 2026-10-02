import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { TableDialog } from "@/components/TableDialog";
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
import { getSettings, gitAvailable, isTauri, revealBuildFolder } from "@/lib/tauri";
import { isMac } from "@/lib/platform";
import { useProjectStore } from "@/store/project";
import { usePreviewStore } from "@/store/preview";
import { applySettingsSideEffects, useSettingsStore } from "@/store/settings";
import { useDialogsStore } from "@/store/dialogs";
import { cn } from "cn";

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
  const setPackagesDialogOpen = useDialogsStore(
    (s) => s.setPackagesDialogOpen,
  );
  const documentSettingsOpen = useDialogsStore((s) => s.documentSettingsOpen);
  const setDocumentSettingsOpen = useDialogsStore(
    (s) => s.setDocumentSettingsOpen,
  );
  const paletteOpen = useDialogsStore((s) => s.paletteOpen);

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
          await useProjectStore.getState().flushBuffers();
          await getCurrentWindow().destroy();
        });
      } catch {
        // Not running inside the desktop app.
      }
    })();
    return () => unlisten?.();
  }, []);

  // Refetch git state when the desktop window regains focus, picking up
  // changes made outside the app (git CLI, other editors). The webview
  // does not emit the browser focus events react-query listens to, and
  // in the browser refetchOnWindowFocus already covers this. Losing
  // focus saves the active file (the only auto-save; a timed one would
  // fight the format-on-save reformatting).
  useEffect(() => {
    const saveOnBlur = () => {
      void (async () => {
        const saved = await useProjectStore.getState().saveActiveFile();
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
          if (focused) void refetchGitState();
          else saveOnBlur();
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
        const handlers: [string, () => void][] = [
          [
            "menu://save",
            () => {
              void useProjectStore.getState().saveActiveFile();
            },
          ],
          [
            "menu://format",
            () => {
              formatDocument();
            },
          ],
          ["menu://toggle-sidebar", () => runPanelCommand("toggle-sidebar")],
          ["menu://toggle-preview", () => runPanelCommand("toggle-preview")],
          ["menu://toggle-right", () => runPanelCommand("toggle-right")],
          ["menu://toggle-search", () => runPanelCommand("toggle-search")],
          ["menu://toggle-issues", () => runPanelCommand("toggle-issues")],
          ["menu://toggle-log", () => runPanelCommand("toggle-log")],
          [
            "menu://insert-table",
            () => useDialogsStore.getState().setTableDialogOpen(true),
          ],
          ["menu://wrap-figure", () => wrapFigure()],
          ["menu://insert-tikz", () => insertTikzSnippet("scaffold")],
          [
            "menu://packages",
            () => useDialogsStore.getState().setPackagesDialogOpen(true),
          ],
          [
            "menu://export-pdf",
            () => {
              void exportPdfAs();
            },
          ],
          [
            "menu://reveal-build",
            () => {
              const { project } = useProjectStore.getState();
              if (project) void revealBuildFolder(project.path);
            },
          ],
          [
            "menu://sources",
            () => {
              useSettingsStore.getState().openSettings("bibliography");
            },
          ],
          [
            "menu://new-project",
            () => {
              void useProjectStore
                .getState()
                .flushBuffers()
                .finally(() => useProjectStore.getState().closeProject());
            },
          ],
          [
            "menu://settings",
            () => {
              useSettingsStore.getState().setSettingsDialogOpen(true);
            },
          ],
          [
            "menu://palette",
            () => {
              useDialogsStore.getState().setPaletteOpen(true);
            },
          ],
          [
            "menu://shortcuts",
            () => {
              useDialogsStore.getState().setShortcutsOpen(true);
            },
          ],
          [
            "menu://about",
            () => {
              useDialogsStore.getState().setAboutOpen(true);
            },
          ],
        ];
        const unsubscribers = await Promise.all(
          handlers.map(([event, handler]) => listen(event, handler)),
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
  // The same applies to the workspace shortcuts (Cmd/Ctrl+Alt+1..3).
  useEffect(() => {
    if (isTauri()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        useDialogsStore.getState().setPaletteOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.altKey) {
        const index = Number(event.key) - 1;
        if (index === 1) {
          event.preventDefault();
          useSettingsStore.getState().openSettings("bibliography");
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
          <div className="min-h-0 flex-1">
            {hasProject ? <EditorView /> : <ProjectsView />}
          </div>
        </div>
      )}
      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      <TableDialog open={tableDialogOpen} onOpenChange={setTableDialogOpen} />
      <PackagesDialog
        open={packagesDialogOpen}
        onOpenChange={setPackagesDialogOpen}
      />
      <DocumentSettingsDialog
        open={documentSettingsOpen}
        onOpenChange={setDocumentSettingsOpen}
      />
      {paletteOpen && <CommandPalette />}
    </QueryClientProvider>
  );
}

export default App;
