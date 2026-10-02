import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { detectTex } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

function wordCount(source: string): number {
  const stripped = source
    .replace(/%[^\n]*/g, " ")
    .replace(/\\[a-zA-Z]+(\[[^\]]*\])?(\{[^}]*\})?/g, " ")
    .replace(/[{}]/g, " ");
  return stripped.split(/\s+/).filter((w) => w.length > 0).length;
}

function CompileStatus() {
  const status = usePreviewStore((s) => s.status);
  const issues = usePreviewStore((s) => s.issues);
  const errors = issues.filter((i) => i.severity === "error").length;

  switch (status) {
    case "compiling":
      return (
        <span className="flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" />
          Compiling…
        </span>
      );
    case "ok":
      return (
        <span className="flex items-center gap-1">
          <Check className="size-3 text-green-600" />
          Compiled
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1 text-destructive">
          <TriangleAlert className="size-3" />
          {errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : "Compile failed"}
        </span>
      );
    default:
      return <span>Not compiled</span>;
  }
}

/** The transparent strip along the bottom window edge. */
export function StatusBar() {
  const activeFile = useProjectStore((s) => s.activeFile);
  const content = useEditorStore((s) => s.content);
  const { data: tex } = useQuery({
    queryKey: ["tex-status"],
    queryFn: detectTex,
    staleTime: Infinity,
  });

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between px-4 text-[11px] text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate">
          {activeFile === null ? "No file open" : activeFile}
        </span>
        {activeFile !== null && (
          <span className="shrink-0 tabular-nums">
            {wordCount(content).toLocaleString()} words
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <CompileStatus />
        {tex && (
          <span className={tex.pdflatex.found ? undefined : "text-destructive"}>
            {tex.pdflatex.found ? "TeX ready" : "TeX distribution not found"}
          </span>
        )}
      </div>
    </footer>
  );
}
