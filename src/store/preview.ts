import { create } from "zustand";
import { compileProject, getPdf, setPreviewZoom, type CompileIssue } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

export type PreviewStatus = "idle" | "compiling" | "ok" | "error";

export interface ScrollTarget {
  page: number;
  x: number;
  y: number;
}

// Guards against overlapping compiles: only the newest run may apply its result.
let compileGeneration = 0;

interface PreviewState {
  status: PreviewStatus;
  pdfBytes: Uint8Array | null;
  error: string | null;
  issues: CompileIssue[];
  log: string | null;
  scrollTarget: ScrollTarget | null;
  scrollVersion: number;
  zoom: number;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  autoCompile: boolean;
  toggleAutoCompile: () => void;
  setAutoCompile: (value: boolean) => void;
  requestScroll: (target: ScrollTarget) => void;
  compileNow: () => Promise<void>;
}

function adjustZoom(set: (partial: { zoom: number }) => void, zoom: number) {
  set({ zoom });
  void setPreviewZoom(zoom);
}

export const usePreviewStore = create<PreviewState>((set) => ({
  status: "idle",
  pdfBytes: null,
  error: null,
  issues: [],
  log: null,
  scrollTarget: null,
  scrollVersion: 0,
  zoom: 1,
  setZoom: (zoom) => set({ zoom }),
  zoomIn: () => adjustZoom(set, Math.min(usePreviewStore.getState().zoom + 0.25, 3)),
  zoomOut: () => adjustZoom(set, Math.max(usePreviewStore.getState().zoom - 0.25, 0.5)),
  autoCompile: true,
  toggleAutoCompile: () => set((state) => ({ autoCompile: !state.autoCompile })),
  setAutoCompile: (value) => set({ autoCompile: value }),
  requestScroll: (target) =>
    set((state) => ({ scrollTarget: target, scrollVersion: state.scrollVersion + 1 })),
  compileNow: async () => {
    const { project, mainFile } = useProjectStore.getState();
    if (!project || !mainFile) {
      set({
        status: "error",
        error: "No project with a main .tex file is open.",
        issues: [],
        log: null,
      });
      return;
    }
    const generation = ++compileGeneration;
    set({ status: "compiling" });
    try {
      const outcome = await compileProject(project.path, mainFile);
      if (generation !== compileGeneration) return;
      if (outcome.success) {
        try {
          const pdfBytes = await getPdf(project.path, mainFile);
          if (generation !== compileGeneration) return;
          set({
            status: "ok",
            pdfBytes,
            issues: outcome.issues,
            log: outcome.log,
            error: null,
          });
        } catch (e) {
          set({
            status: "error",
            error: String(e),
            issues: outcome.issues,
            log: outcome.log,
          });
        }
      } else {
        // Compile failed: keep the last PDF, surface issues in the panel.
        set({ status: "error", error: null, issues: outcome.issues, log: outcome.log });
      }
    } catch (e) {
      // Infrastructure failure (e.g. latexmk missing).
      if (generation === compileGeneration) {
        set({ status: "error", error: String(e), issues: [], log: null });
      }
    }
  },
}));
