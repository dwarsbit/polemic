import { create } from "zustand";
import { updatePreferences, type Settings } from "@/lib/tauri";
import { applyTheme, type ThemePreference } from "@/lib/theme";
import { usePreviewStore } from "@/store/preview";

interface SettingsState {
  loaded: boolean;
  theme: ThemePreference;
  fontSize: number;
  projectsRoot: string | null;
  hydrate: (settings: Settings) => void;
  setTheme: (theme: ThemePreference) => Promise<void>;
  setFontSize: (fontSize: number) => Promise<void>;
  setProjectsRoot: (root: string | null) => void;
}

const DEFAULT_THEME: ThemePreference = "system";
const DEFAULT_FONT_SIZE = 14;

export const useSettingsStore = create<SettingsState>((set) => ({
  loaded: false,
  theme: DEFAULT_THEME,
  fontSize: DEFAULT_FONT_SIZE,
  projectsRoot: null,
  hydrate: (settings) =>
    set({
      loaded: true,
      theme: (settings.theme as ThemePreference | null) ?? DEFAULT_THEME,
      fontSize: settings.fontSize ?? DEFAULT_FONT_SIZE,
      projectsRoot: settings.projectsRoot,
    }),
  setTheme: async (theme) => {
    set({ theme });
    applyTheme(theme);
    await updatePreferences(theme);
  },
  setFontSize: async (fontSize) => {
    set({ fontSize });
    await updatePreferences(undefined, undefined, fontSize);
  },
  setProjectsRoot: (root) => set({ projectsRoot: root }),
}));

/** Apply the persisted preferences to other stores and the document. */
export function applySettingsSideEffects(settings: Settings) {
  applyTheme(settings.theme ?? DEFAULT_THEME);
  if (settings.autoCompile !== null) {
    usePreviewStore.getState().setAutoCompile(settings.autoCompile);
  }
}
