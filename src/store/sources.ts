import { create } from "zustand";
import {
  getSettings,
  listBibFiles,
  readExternalFile,
  updatePreferences,
  type SourceDef,
} from "@/lib/tauri";

export type { SourceDef };
/** The source kinds: .bib files/folders on the filesystem, or Zotero
 *  connections. At most one Zotero app connection. */
export type SourceKind = SourceDef["kind"];

/** A new source's data; the store assigns the id. */
export type SourceDraft = Omit<SourceDef, "id">;

/** The source's display name: the user's label or a kind default. */
export function sourceName(source: SourceDef): string {
  if (source.name !== null && source.name.length > 0) return source.name;
  if (source.kind === "zotero-app") return "Zotero app";
  if (source.kind === "zotero-cloud") return "Zotero cloud";
  const path = source.path;
  if (path === null || path.length === 0) return "Bib source";
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

/**
 * The user's reference sources: any number of .bib files/folders
 * anywhere on the filesystem (referenced in place, never copied) plus
 * Zotero connections — at most one of the local Zotero app. The list
 * is a global preference, managed in the settings dialog's
 * Bibliography section; "Add from Sources…" searches the enabled
 * sources. Bib texts are cached here so the search dialog stays
 * instant.
 */
interface SourcesState {
  sources: SourceDef[];
  /** The .bib files each enabled bib source covers, by source id. */
  sourceFiles: Record<string, string[]>;
  /** Raw text of every .bib file under enabled bib sources, keyed by
   *  absolute path. */
  bibTexts: Record<string, string>;
  error: string | null;
  /** True while a refresh is in flight. */
  loading: boolean;
  refresh: () => Promise<void>;
  addSource: (draft: SourceDraft) => Promise<void>;
  updateSource: (id: string, patch: Partial<SourceDraft>) => Promise<void>;
  removeSource: (id: string) => Promise<void>;
  setSourceEnabled: (id: string, on: boolean) => Promise<void>;
}

async function persist(sources: SourceDef[]): Promise<SourceDef[]> {
  const settings = await updatePreferences({ sources });
  return settings.sources;
}

/** A second local Zotero connection is never meaningful. */
function wouldDuplicateZoteroApp(sources: SourceDef[], id: string | null): boolean {
  return sources.some((s) => s.kind === "zotero-app" && s.id !== id);
}

export const useSourcesStore = create<SourcesState>((set, get) => ({
  sources: [],
  sourceFiles: {},
  bibTexts: {},
  error: null,
  loading: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const settings = await getSettings();
      const sourceFiles: Record<string, string[]> = {};
      const bibTexts: Record<string, string> = {};
      for (const source of settings.sources) {
        if (source.kind !== "bib" || !source.enabled) continue;
        const path = source.path;
        if (path === null || path.length === 0) continue;
        let files: string[] = [];
        try {
          files = await listBibFiles(path);
        } catch {
          continue; // moved or deleted: the source stays but finds nothing
        }
        sourceFiles[source.id] = files;
        for (const file of files) {
          if (bibTexts[file] !== undefined) continue;
          try {
            bibTexts[file] = await readExternalFile(file);
          } catch {
            // unreadable file: skip it
          }
        }
      }
      set({ sources: settings.sources, sourceFiles, bibTexts, error: null, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  addSource: async (draft) => {
    if (draft.kind === "zotero-app" && wouldDuplicateZoteroApp(get().sources, null)) {
      set({ error: "There is already a Zotero app connection." });
      return;
    }
    const sources = await persist([
      ...get().sources,
      { ...draft, id: crypto.randomUUID() },
    ]);
    set({ sources, error: null });
    await get().refresh();
  },
  updateSource: async (id, patch) => {
    const next = get().sources.map((source) =>
      source.id === id ? { ...source, ...patch } : source,
    );
    if (next.some((s) => s.id === id && s.kind === "zotero-app")) {
      if (wouldDuplicateZoteroApp(next, id)) {
        set({ error: "There is already a Zotero app connection." });
        return;
      }
    }
    const sources = await persist(next);
    set({ sources, error: null });
    await get().refresh();
  },
  removeSource: async (id) => {
    const sources = await persist(get().sources.filter((source) => source.id !== id));
    set({ sources });
    await get().refresh();
  },
  setSourceEnabled: async (id, on) => {
    await get().updateSource(id, { enabled: on });
  },
}));
