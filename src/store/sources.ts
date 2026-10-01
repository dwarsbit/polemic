import { create } from "zustand";
import {
  getSettings,
  listLibraryFiles,
  readLibraryFile,
  updatePreferences,
  type SourceDef,
} from "@/lib/tauri";
import { flattenBibPaths } from "@/lib/bib-entries";

export type { SourceDef };
/** The source kinds: bib files in the library, or Zotero connections. */
export type SourceKind = SourceDef["kind"];

/** A new source's data; the store assigns the id. */
export type SourceDraft = Omit<SourceDef, "id">;

/** The .bib files one bib source covers, from a library file listing. */
export function bibSourceFiles(source: SourceDef, allBib: string[]): string[] {
  if (source.kind !== "bib") return [];
  const path = source.path;
  if (path === null || path.length === 0) return allBib;
  if (path.endsWith(".bib")) return allBib.filter((file) => file === path);
  const prefix = path.endsWith("/") ? path : `${path}/`;
  return allBib.filter((file) => file.startsWith(prefix));
}

/** The source's display name: the user's label or a kind default. */
export function sourceName(source: SourceDef): string {
  if (source.name !== null && source.name.length > 0) return source.name;
  if (source.kind === "zotero-app") return "Zotero app";
  if (source.kind === "zotero-cloud") return "Zotero cloud";
  const path = source.path;
  if (path === null || path.length === 0) return "Polemic Library";
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

/**
 * The user's reference sources: any number of .bib files/folders in
 * the library plus Zotero connections. The list is configured in the
 * settings dialog's Bibliography section; "Add from Sources…"
 * searches the enabled sources. Bib texts are cached here so the
 * search dialog stays instant.
 */
interface SourcesState {
  sources: SourceDef[];
  /** Raw text of every .bib file under enabled bib sources,
   *  keyed by library-relative path. */
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

export const useSourcesStore = create<SourcesState>((set, get) => ({
  sources: [],
  bibTexts: {},
  error: null,
  loading: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const settings = await getSettings();
      const bibSources = settings.sources.filter((s) => s.kind === "bib" && s.enabled);
      let allBib: string[] = [];
      if (bibSources.length > 0) {
        try {
          allBib = flattenBibPaths(await listLibraryFiles());
        } catch {
          allBib = [];
        }
      }
      const files = [...new Set(bibSources.flatMap((s) => bibSourceFiles(s, allBib)))];
      const bibTexts: Record<string, string> = {};
      for (const file of files) {
        try {
          bibTexts[file] = await readLibraryFile(file);
        } catch {
          // unreadable file: skip
        }
      }
      set({ sources: settings.sources, bibTexts, error: null, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  addSource: async (draft) => {
    const sources = await persist([
      ...get().sources,
      { ...draft, id: crypto.randomUUID() },
    ]);
    set({ sources });
    await get().refresh();
  },
  updateSource: async (id, patch) => {
    const sources = await persist(
      get().sources.map((source) => (source.id === id ? { ...source, ...patch } : source)),
    );
    set({ sources });
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
