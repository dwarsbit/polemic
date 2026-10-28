import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { SuggestToggle } from "@/components/SuggestToggle";
import { useGrammarStatus } from "@/lib/grammar-check";
import { detectTex, type GrammarError, type ToolInfo } from "@/lib/tauri";
import { countWords, totalWords } from "@/lib/word-count";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";
import { cn } from "@/lib/utils";

/** The distribution's name from pdflatex's version line, e.g.
 *  "pdfTeX 3.14… (TeX Live 2025)" gives "TeX Live 2025". */
export function distributionName(tool: ToolInfo): string {
  const match = tool.version?.match(/\((TeX Live \d{4}|MiKTeX[^)]*)/);
  return match ? match[1].trim() : "TeX found";
}

function Dot({ className }: { className: string }) {
  return <span className={cn("size-1.5 shrink-0 rounded-full", className)} />;
}

function CompileStatus() {
  const status = usePreviewStore((s) => s.status);
  const issues = usePreviewStore((s) => s.issues);
  const engine = usePreviewStore((s) => s.engine);
  const via = engine !== null && engine !== "pdflatex" ? ` · ${engine}` : "";
  const errors = issues.filter((i) => i.severity === "error").length;

  switch (status) {
    case "compiling":
      return (
        <span className="flex items-center gap-1.5">
          <Loader2 className="size-3 animate-spin" />
          Compiling…
        </span>
      );
    case "ok":
      return (
        <span className="flex items-center gap-1.5">
          <Dot className="bg-success" />
          Compiled{via}
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1.5 text-destructive">
          <Dot className="bg-destructive" />
          {errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : "Compile failed"}
          {via}
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1.5">
          <Dot className="bg-muted-foreground/50" />
          Not compiled yet
        </span>
      );
  }
}

const GRAMMAR_PROBLEMS: Record<GrammarError["kind"], string> = {
  signedOut: "Grammar: signed out",
  planRequired: "Grammar: needs Professional",
  tooLong: "Grammar: paragraph too long",
  rateLimited: "Grammar: paused",
  unavailable: "Grammar unavailable",
  failed: "Grammar check failed",
};

/** Why grammar checking stopped, when it did; opens its settings. */
function GrammarStatus() {
  const problem = useGrammarStatus((s) => s.problem);
  const enabled = useSettingsStore((s) => s.grammar.enabled !== false);
  const openSettings = useSettingsStore((s) => s.openSettings);
  if (!problem || !enabled) return null;
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground"
      title={problem.message}
      onClick={() => openSettings("writing")}
    >
      <Dot className="bg-warning" />
      {GRAMMAR_PROBLEMS[problem.kind]}
    </button>
  );
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
    <footer className="flex h-7 shrink-0 items-center justify-between px-3 text-2xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate">{activeFile ?? "No file open"}</span>
        {activeFile !== null && (
          <span className="shrink-0 tabular-nums">
            {totalWords(countWords(content)).toLocaleString()} words
          </span>
        )}
        {activeFile?.endsWith(".tex") && <SuggestToggle compact />}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <GrammarStatus />
        <CompileStatus />
        {tex &&
          (tex.pdflatex.found ? (
            <span
              className="flex items-center gap-1"
              title={tex.pdflatex.path ?? undefined}
            >
              <Check className="size-3 text-success" />
              {distributionName(tex.pdflatex)}
            </span>
          ) : (
            <span className="text-destructive">No TeX distribution found</span>
          ))}
      </div>
    </footer>
  );
}
