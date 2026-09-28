import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { EditorView } from "@/components/EditorView";
import { LibraryView } from "@/components/LibraryView";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SettingsDialog } from "@/components/SettingsDialog";
import { AboutDialog, ShortcutsDialog } from "@/components/HelpDialogs";
import { exportPdfAs } from "@/lib/pdf-export";
import { getSettings, gitAvailable, isTauri, revealBuildFolder } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";
import { applySettingsSideEffects, useSettingsStore } from "@/store/settings";
import { useDialogsStore } from "@/store/dialogs";

const queryClient = new QueryClient();

function App() {
  const hasProject = useProjectStore((s) => s.project !== null);
  const openProject = useProjectStore((s) => s.openProject);
  const [startupDone, setStartupDone] = useState(false);
  const settingsDialogOpen = useSettingsStore((s) => s.settingsDialogOpen);
  const setSettingsDialogOpen = useSettingsStore((s) => s.setSettingsDialogOpen);
  const shortcutsOpen = useDialogsStore((s) => s.shortcutsOpen);
  const setShortcutsOpen = useDialogsStore((s) => s.setShortcutsOpen);
  const aboutOpen = useDialogsStore((s) => s.aboutOpen);
  const setAboutOpen = useDialogsStore((s) => s.setAboutOpen);
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
            // Project unavailable: start at the library.
          }
        }
      } catch {
        // Settings unavailable: start at the library.
      }
      if (!cancelled) setStartupDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [openProject]);

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
  useEffect(() => {
    if (isTauri()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        useDialogsStore.getState().setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {!startupDone ? <LoadingScreen /> : hasProject ? <EditorView /> : <LibraryView />}
      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      {paletteOpen && <CommandPalette />}
    </QueryClientProvider>
  );
}

export default App;
