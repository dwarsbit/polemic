import { create } from "zustand";
import {
  compileProject,
  getPdf,
  setPreviewZoom,
  type CompileIssue,
  type TexEngine,
} from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

export type PreviewStatus = "idle" | "compiling" | "ok" | "error";

export interface ScrollTarget {
  page: number;
  x: number;
  y: number;
}

// Bumped when the project changes: a run that started for another
// project must not apply its result.
let compileGeneration = 0;
// latexmk runs one at a time (they share the build folder); a request
// during a run queues a single follow-up run.
let inFlight: Promise<void> | null = null;
let queued: Promise<void> | null = null;

interface PreviewState {
  status: PreviewStatus;
  pdfBytes: Uint8Array | null;
  error: string | null;
  issues: CompileIssue[];
  log: string | null;
  /** The engine of the last finished compile. */
  engine: TexEngine | null;
  /** A transient message about a preview action (sync, open), shown
   *  over the PDF without replacing the compile state. */
  notice: string | null;
  setNotice: (notice: string | null) => void;
  scrollTarget: ScrollTarget | null;
  scrollVersion: number;
  zoom: number;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Back to 100%. */
  resetZoom: () => void;
  autoCompile: boolean;
  toggleAutoCompile: () => void;
  setAutoCompile: (value: boolean) => void;
  requestScroll: (target: ScrollTarget) => void;
  compileNow: () => Promise<void>;
  /** A different project (or none) is open: drop the old PDF and
   *  results, and discard any run still going for the previous one. */
  resetForProject: () => void;
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
  engine: null,
  notice: null,
  setNotice: (notice) => set({ notice }),
  scrollTarget: null,
  scrollVersion: 0,
  zoom: 1,
  setZoom: (zoom) => set({ zoom }),
  zoomIn: () => adjustZoom(set, Math.min(usePreviewStore.getState().zoom + 0.25, 3)),
  zoomOut: () => adjustZoom(set, Math.max(usePreviewStore.getState().zoom - 0.25, 0.5)),
  resetZoom: () => adjustZoom(set, 1),
  autoCompile: true,
  toggleAutoCompile: () => set((state) => ({ autoCompile: !state.autoCompile })),
  setAutoCompile: (value) => set({ autoCompile: value }),
  requestScroll: (target) =>
    set((state) => ({ scrollTarget: target, scrollVersion: state.scrollVersion + 1 })),
  resetForProject: () => {
    compileGeneration++;
    set({
      status: "idle",
      pdfBytes: null,
      error: null,
      issues: [],
      log: null,
      engine: null,
      notice: null,
      scrollTarget: null,
    });
  },
  compileNow: (): Promise<void> => {
    if (inFlight !== null) {
      queued ??= inFlight.then((): Promise<void> => {
        queued = null;
        return usePreviewStore.getState().compileNow();
      });
      return queued;
    }
    inFlight = runCompile(set).finally(() => {
      inFlight = null;
    });
    return inFlight;
  },
}));

async function runCompile(
  set: (partial: Partial<PreviewState>) => void,
): Promise<void> {
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
  const generation = compileGeneration;
  set({ status: "compiling", notice: null });
  try {
    const outcome = await compileProject(project.path, mainFile);
    if (generation !== compileGeneration) return;
    set({ engine: outcome.engine });
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
        if (generation !== compileGeneration) return;
        set({
          status: "error",
          error: String(e),
          issues: outcome.issues,
          log: outcome.log,
        });
      }
    } else {
      // Compile failed: keep the last PDF, surface issues in the panel.
      if (generation !== compileGeneration) return;
      set({ status: "error", error: null, issues: outcome.issues, log: outcome.log });
    }
  } catch (e) {
    // Infrastructure failure (e.g. latexmk missing).
    if (generation === compileGeneration) {
      set({ status: "error", error: String(e), issues: [], log: null });
    }
  }
}
