/**
 * Settings in the browser build: the desktop app keeps them in a JSON
 * file through Rust (src-tauri/src/settings.rs); the browser keeps the
 * same shape in local storage. The commands below answer the settings
 * commands of src/lib/tauri.ts with the same arguments and results.
 */

import type { Settings } from "@/lib/tauri";

const STORAGE_KEY = "polemic.settings";

export function defaultSettings(): Settings {
  return {
    projectsRoot: "",
    sources: [],
    recentProjects: [],
    mainFiles: {},
    openFiles: {},
    pinnedProjects: [],
    lastProjectPath: null,
    theme: null,
    autoCompile: null,
    fontSize: null,
    editorFont: null,
    syntaxTheme: null,
    panelLayout: null,
    previewZoom: null,
    // Spelling and grammar run through Rust on the desktop; off until
    // the browser has its own.
    spellcheck: false,
    spellcheckLanguage: null,
    supsubBraces: null,
    convertDoubleDollar: null,
    formatOnSave: null,
    mathPreviewEngine: null,
    caretStyle: null,
    caretColor: null,
    caretCustomColor: null,
    reopenLastProject: null,
    autoIncludeNewFiles: null,
    versionControl: null,
    texEditorMode: null,
    bibEditorMode: null,
    onlineLookup: null,
    ai: null,
    assistantCompileProjects: [],
    assistantMode: null,
    grammar: {
      enabled: false,
      provider: "polemic",
      languageToolUrl: null,
      englishVariant: null,
      disabledRules: [],
    },
    accountServer: null,
    authorName: null,
    authorInitials: null,
    gitAccounts: [],
    // Online, every compile runs on the server.
    compileProvider: "polemic",
  };
}

/** The stored settings over the defaults; the defaults when storage is
 *  unavailable (private windows) or holds something else. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored: unknown = JSON.parse(raw);
      if (typeof stored === "object" && stored !== null && !Array.isArray(stored)) {
        return { ...defaultSettings(), ...(stored as Partial<Settings>) };
      }
    }
  } catch {
    // Unreadable: start from the defaults.
  }
  return defaultSettings();
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked: the change holds until the page reloads.
  }
}

/** Load, change and store the settings, as settings::update does. */
function update(change: (s: Settings) => void): Settings {
  const settings = loadSettings();
  change(settings);
  saveSettings(settings);
  return settings;
}

/** The preference keys update_preferences accepts (EditorPreferences). */
const PREFERENCE_KEYS = [
  "theme",
  "autoCompile",
  "fontSize",
  "editorFont",
  "syntaxTheme",
  "spellcheck",
  "supsubBraces",
  "convertDoubleDollar",
  "formatOnSave",
  "mathPreviewEngine",
  "caretStyle",
  "caretColor",
  "caretCustomColor",
  "reopenLastProject",
  "autoIncludeNewFiles",
  "texEditorMode",
  "bibEditorMode",
  "onlineLookup",
  "sources",
  "assistantMode",
] as const;

type Args = Record<string, unknown>;

export const settingsCommands: Record<string, (args: Args) => unknown> = {
  get_settings: () => loadSettings(),

  update_preferences: (args) =>
    update((s) => {
      const target = s as unknown as Record<string, unknown>;
      for (const key of PREFERENCE_KEYS) {
        if (args[key] !== undefined) target[key] = args[key];
      }
      // An empty name or initials clears them.
      if (typeof args.authorName === "string") {
        s.authorName = args.authorName === "" ? null : args.authorName;
      }
      if (typeof args.authorInitials === "string") {
        s.authorInitials = args.authorInitials === "" ? null : args.authorInitials;
      }
    }),

  update_grammar_settings: (args) =>
    update((s) => {
      s.grammar = args.grammar as Settings["grammar"];
    }),

  remove_recent_project: (args) =>
    update((s) => {
      s.recentProjects = s.recentProjects.filter((r) => r.path !== args.path);
    }),

  set_pinned_project: (args) =>
    update((s) => {
      const path = String(args.path);
      s.pinnedProjects = s.pinnedProjects.filter((p) => p !== path);
      if (args.pinned) s.pinnedProjects.unshift(path);
    }),

  set_panel_layout: (args) => {
    update((s) => {
      s.panelLayout = args.layout as Record<string, number>;
    });
  },

  set_preview_zoom: (args) => {
    update((s) => {
      s.previewZoom = Number(args.zoom);
    });
  },
};
