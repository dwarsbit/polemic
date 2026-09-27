import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { EditorView } from "@/components/EditorView";
import { LibraryView } from "@/components/LibraryView";
import { getSettings } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";
import { applySettingsSideEffects, useSettingsStore } from "@/store/settings";

const queryClient = new QueryClient();

function App() {
  const hasProject = useProjectStore((s) => s.project !== null);
  const openProject = useProjectStore((s) => s.openProject);
  const loaded = useSettingsStore((s) => s.loaded);

  // Load preferences, apply theme/auto-compile, and reopen the last project.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        useSettingsStore.getState().hydrate(settings);
        applySettingsSideEffects(settings);
        if (settings.lastProjectPath) {
          await openProject(settings.lastProjectPath);
        }
      } catch {
        // Settings or project unavailable: start at the library.
      }
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

  return (
    <QueryClientProvider client={queryClient}>
      {loaded ? hasProject ? <EditorView /> : <LibraryView /> : null}
    </QueryClientProvider>
  );
}

export default App;
