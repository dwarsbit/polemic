import { create } from "zustand";
import { compileProject, getPdf, type CompileIssue } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

export type PreviewStatus = "idle" | "compiling" | "ok" | "error";

export interface ScrollTarget {
  page: number;
  x: number;
  y: number;
}

interface PreviewState {
  status: PreviewStatus;
  pdfBytes: Uint8Array | null;
  error: string | null;
  issues: CompileIssue[];
  log: string | null;
  scrollTarget: ScrollTarget | null;
  scrollVersion: number;
  autoCompile: boolean;
  toggleAutoCompile: () => void;
  requestScroll: (target: ScrollTarget) => void;
  compileNow: () => Promise<void>;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  status: "idle",
  pdfBytes: null,
  error: null,
  issues: [],
  log: null,
  scrollTarget: null,
  scrollVersion: 0,
  autoCompile: true,
  toggleAutoCompile: () =>
    set((state) => ({ autoCompile: !state.autoCompile })),
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
    set({ status: "compiling" });
    try {
      const outcome = await compileProject(project.path, mainFile);
      if (outcome.success) {
        try {
          const pdfBytes = await getPdf(project.path, mainFile);
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
      set({ status: "error", error: String(e), issues: [], log: null });
    }
  },
}));
