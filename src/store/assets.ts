import { create } from "zustand";
import { listAssetMeta, saveAssetMeta, type AssetTags } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

interface AssetsState {
  /** Tags per project-relative asset path. */
  tags: AssetTags;
  loaded: boolean;
  load: () => Promise<void>;
  setTags: (path: string, tags: string[]) => void;
}

/**
 * Asset tags for the open project, persisted to `.polemic/assets.json`
 * (project-local, so tags travel with the folder and git).
 */
export const useAssetsStore = create<AssetsState>((set, get) => ({
  tags: {},
  loaded: false,
  load: async () => {
    const { project } = useProjectStore.getState();
    if (!project) {
      set({ tags: {}, loaded: false });
      return;
    }
    try {
      set({ tags: await listAssetMeta(project.path), loaded: true });
    } catch {
      set({ tags: {}, loaded: true });
    }
  },
  setTags: (path, tags) => {
    const { project } = useProjectStore.getState();
    const next = { ...get().tags };
    if (tags.length === 0) {
      delete next[path];
    } else {
      next[path] = tags;
    }
    set({ tags: next });
    if (project) {
      void saveAssetMeta(project.path, next).catch(() => undefined);
    }
  },
}));
