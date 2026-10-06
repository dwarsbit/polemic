import { create } from "zustand";
import {
  setPanelLayout,
  setSpellcheckLanguage as persistSpellcheckLanguage,
  setVersionControl as persistVersionControl,
  updateAiSettings,
  updatePreferences,
  type AiSettings,
  type Settings,
} from "@/lib/tauri";
import { applyTheme, type ThemePreference } from "@/lib/theme";
import { usePreviewStore } from "@/store/preview";

interface SettingsState {
  loaded: boolean;
  theme: ThemePreference;
  fontSize: number;
  editorFont: string;
  syntaxTheme: string;
  spellcheckEnabled: boolean;
  spellcheckLanguage: string;
  supsubBraces: boolean;
  convertDoubleDollar: boolean;
  formatOnSave: boolean;
  mathPreviewEngine: "katex" | "off";
  caretStyle: "line" | "block";
  caretColor: "primary" | "custom";
  caretCustomColor: string;
  reopenLastProject: boolean;
  autoIncludeNewFiles: boolean;
  /** Explicit version-control choice; null means auto. */
  versionControl: "git" | "snapshots" | null;
  /** Whether the git binary is on PATH (part of startup gating). */
  gitAvailable: boolean;
  settingsDialogOpen: boolean;
  /** The section the settings dialog opens on; null = last used. */
  settingsSection: string | null;
  projectsRoot: string | null;
  panelLayout: Record<string, number> | null;
  /** The AI quickfix provider; null until configured. */
  ai: AiSettings | null;
  hydrate: (settings: Settings) => void;
  setTheme: (theme: ThemePreference) => Promise<void>;
  setFontSize: (fontSize: number) => Promise<void>;
  setEditorFont: (font: string) => Promise<void>;
  setSyntaxTheme: (theme: string) => Promise<void>;
  setSpellcheck: (enabled: boolean) => Promise<void>;
  setSpellcheckLanguage: (lang: string) => Promise<void>;
  setSupsubBraces: (enabled: boolean) => Promise<void>;
  setConvertDoubleDollar: (enabled: boolean) => Promise<void>;
  setFormatOnSave: (enabled: boolean) => Promise<void>;
  setMathPreviewEngine: (engine: "katex" | "off") => Promise<void>;
  setCaretStyle: (style: "line" | "block") => Promise<void>;
  setCaretColor: (color: "primary" | "custom") => Promise<void>;
  setCaretCustomColor: (color: string) => Promise<void>;
  setReopenLastProject: (enabled: boolean) => Promise<void>;
  setAutoIncludeNewFiles: (enabled: boolean) => Promise<void>;
  setVersionControl: (value: "git" | "snapshots") => Promise<void>;
  setGitAvailable: (available: boolean) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  /** Open the settings dialog, optionally on a specific section. */
  openSettings: (section: string | null) => void;
  /** Drop a targeted-open section (the user navigated away). */
  clearSettingsSection: () => void;
  setProjectsRoot: (root: string | null) => void;
  persistPanelLayout: (layout: Record<string, number>) => void;
  /** Save the AI quickfix provider settings. */
  setAi: (ai: AiSettings) => Promise<void>;
}

const DEFAULT_THEME: ThemePreference = "system";
const DEFAULT_FONT_SIZE = 14;
export const DEFAULT_EDITOR_FONT = "system";
export const DEFAULT_SYNTAX_THEME = "default";
export const DEFAULT_MATH_PREVIEW_ENGINE = "katex";
export const DEFAULT_CARET_CUSTOM_COLOR = "#e11d48";

export const useSettingsStore = create<SettingsState>((set) => ({
  loaded: false,
  theme: DEFAULT_THEME,
  fontSize: DEFAULT_FONT_SIZE,
  editorFont: DEFAULT_EDITOR_FONT,
  syntaxTheme: DEFAULT_SYNTAX_THEME,
  spellcheckEnabled: true,
  spellcheckLanguage: "en",
  supsubBraces: false,
  convertDoubleDollar: true,
  formatOnSave: true,
  mathPreviewEngine: DEFAULT_MATH_PREVIEW_ENGINE,
  caretStyle: "line",
  caretColor: "primary",
  caretCustomColor: DEFAULT_CARET_CUSTOM_COLOR,
  reopenLastProject: true,
  autoIncludeNewFiles: true,
  versionControl: null,
  gitAvailable: false,
  settingsDialogOpen: false,
  settingsSection: null,
  projectsRoot: null,
  panelLayout: null,
  ai: null,
  hydrate: (settings) =>
    set({
      loaded: true,
      theme: (settings.theme as ThemePreference | null) ?? DEFAULT_THEME,
      fontSize: settings.fontSize ?? DEFAULT_FONT_SIZE,
      editorFont: settings.editorFont ?? DEFAULT_EDITOR_FONT,
      syntaxTheme: settings.syntaxTheme ?? DEFAULT_SYNTAX_THEME,
      spellcheckEnabled: settings.spellcheck ?? true,
      spellcheckLanguage: settings.spellcheckLanguage ?? "en",
      supsubBraces: settings.supsubBraces ?? false,
      convertDoubleDollar: settings.convertDoubleDollar ?? true,
      formatOnSave: settings.formatOnSave ?? true,
      mathPreviewEngine:
        settings.mathPreviewEngine === "off" ? "off" : DEFAULT_MATH_PREVIEW_ENGINE,
      // Older builds stored "pulse"/"highlight"/"accent"; those map
      // onto the current options.
      caretStyle:
        settings.caretStyle === "block" || settings.caretStyle === "highlight"
          ? "block"
          : "line",
      caretColor: settings.caretColor === "custom" ? "custom" : "primary",
      caretCustomColor:
        settings.caretCustomColor ?? DEFAULT_CARET_CUSTOM_COLOR,
      reopenLastProject: settings.reopenLastProject ?? true,
      autoIncludeNewFiles: settings.autoIncludeNewFiles ?? true,
      versionControl:
        settings.versionControl === "git" || settings.versionControl === "snapshots"
          ? settings.versionControl
          : null,
      projectsRoot: settings.projectsRoot,
      panelLayout: settings.panelLayout,
      ai: settings.ai,
    }),
  setTheme: async (theme) => {
    set({ theme });
    applyTheme(theme);
    await updatePreferences({ theme });
  },
  setFontSize: async (fontSize) => {
    set({ fontSize });
    await updatePreferences({ fontSize });
  },
  setEditorFont: async (font) => {
    set({ editorFont: font });
    await updatePreferences({ editorFont: font });
  },
  setSyntaxTheme: async (theme) => {
    set({ syntaxTheme: theme });
    await updatePreferences({ syntaxTheme: theme });
  },
  setSpellcheck: async (enabled) => {
    set({ spellcheckEnabled: enabled });
    await updatePreferences({ spellcheck: enabled });
  },
  setSupsubBraces: async (enabled) => {
    set({ supsubBraces: enabled });
    await updatePreferences({ supsubBraces: enabled });
  },
  setConvertDoubleDollar: async (enabled) => {
    set({ convertDoubleDollar: enabled });
    await updatePreferences({ convertDoubleDollar: enabled });
  },
  setFormatOnSave: async (enabled) => {
    set({ formatOnSave: enabled });
    await updatePreferences({ formatOnSave: enabled });
  },
  setMathPreviewEngine: async (engine) => {
    set({ mathPreviewEngine: engine });
    await updatePreferences({ mathPreviewEngine: engine });
  },
  setCaretStyle: async (style) => {
    set({ caretStyle: style });
    await updatePreferences({ caretStyle: style });
  },
  setCaretColor: async (color) => {
    set({ caretColor: color });
    await updatePreferences({ caretColor: color });
  },
  setCaretCustomColor: async (color) => {
    set({ caretCustomColor: color });
    await updatePreferences({ caretCustomColor: color });
  },
  setReopenLastProject: async (enabled) => {
    set({ reopenLastProject: enabled });
    await updatePreferences({ reopenLastProject: enabled });
  },
  setAutoIncludeNewFiles: async (enabled) => {
    set({ autoIncludeNewFiles: enabled });
    await updatePreferences({ autoIncludeNewFiles: enabled });
  },
  setVersionControl: async (value) => {
    set({ versionControl: value });
    await persistVersionControl(value);
  },
  setGitAvailable: (available) => set({ gitAvailable: available }),
  setSpellcheckLanguage: async (lang) => {
    set({ spellcheckLanguage: lang });
    await persistSpellcheckLanguage(lang);
  },
  setSettingsDialogOpen: (open) =>
    set(
      open
        ? { settingsDialogOpen: true }
        : { settingsDialogOpen: false, settingsSection: null },
    ),
  openSettings: (section) => set({ settingsDialogOpen: true, settingsSection: section }),
  clearSettingsSection: () => set({ settingsSection: null }),
  setProjectsRoot: (root) => set({ projectsRoot: root }),
  persistPanelLayout: (layout) => {
    const merged = {
      ...(useSettingsStore.getState().panelLayout ?? {}),
      ...layout,
    };
    set({ panelLayout: merged });
    void setPanelLayout(merged);
  },
  setAi: async (ai) => {
    set({ ai });
    await updateAiSettings(ai.baseUrl, ai.apiKey, ai.model);
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

/** The version-control mode in effect: git only when it is installed. */
export function resolveVersionControl(state: {
  versionControl: "git" | "snapshots" | null;
  gitAvailable: boolean;
}): "git" | "snapshots" {
  if (state.versionControl === "snapshots") return "snapshots";
  if (state.versionControl === "git" && state.gitAvailable) return "git";
  return state.gitAvailable ? "git" : "snapshots";
}
