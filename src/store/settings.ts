import { create } from "zustand";
import {
  setPanelLayout,
  setSpellcheckLanguage as persistSpellcheckLanguage,
  updatePreferences,
  type Settings,
} from "@/lib/tauri";
import { applyTheme, type ThemePreference } from "@/lib/theme";
import { usePreviewStore } from "@/store/preview";

interface SettingsState {
  loaded: boolean;
  theme: ThemePreference;
  fontSize: number;
  spellcheckEnabled: boolean;
  spellcheckLanguage: string;
  projectsRoot: string | null;
  panelLayout: Record<string, number> | null;
  hydrate: (settings: Settings) => void;
  setTheme: (theme: ThemePreference) => Promise<void>;
  setFontSize: (fontSize: number) => Promise<void>;
  setSpellcheck: (enabled: boolean) => Promise<void>;
  setSpellcheckLanguage: (lang: string) => Promise<void>;
  setProjectsRoot: (root: string | null) => void;
  persistPanelLayout: (layout: Record<string, number>) => void;
}

const DEFAULT_THEME: ThemePreference = "system";
const DEFAULT_FONT_SIZE = 14;

export const useSettingsStore = create<SettingsState>((set) => ({
  loaded: false,
  theme: DEFAULT_THEME,
  fontSize: DEFAULT_FONT_SIZE,
  spellcheckEnabled: true,
  spellcheckLanguage: "en",
  projectsRoot: null,
  panelLayout: null,
  hydrate: (settings) =>
    set({
      loaded: true,
      theme: (settings.theme as ThemePreference | null) ?? DEFAULT_THEME,
      fontSize: settings.fontSize ?? DEFAULT_FONT_SIZE,
      spellcheckEnabled: settings.spellcheck ?? true,
      spellcheckLanguage: settings.spellcheckLanguage ?? "en",
      projectsRoot: settings.projectsRoot,
      panelLayout: settings.panelLayout,
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
  setSpellcheck: async (enabled) => {
    set({ spellcheckEnabled: enabled });
    await updatePreferences(undefined, undefined, undefined, enabled);
  },
  setSpellcheckLanguage: async (lang) => {
    set({ spellcheckLanguage: lang });
    await persistSpellcheckLanguage(lang);
  },
  setProjectsRoot: (root) => set({ projectsRoot: root }),
  persistPanelLayout: (layout) => {
    const merged = {
      ...(useSettingsStore.getState().panelLayout ?? {}),
      ...layout,
    };
    set({ panelLayout: merged });
    void setPanelLayout(merged);
  },
}));

/** Apply the persisted preferences to other stores and the document. */
export function applySettingsSideEffects(settings: Settings) {
  applyTheme(settings.theme ?? DEFAULT_THEME);
  if (settings.autoCompile !== null) {
    usePreviewStore.getState().setAutoCompile(settings.autoCompile);
  }
  if (settings.previewZoom !== null) {
    usePreviewStore.getState().setZoom(settings.previewZoom);
  }
}
