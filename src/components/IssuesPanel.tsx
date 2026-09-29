import {
  AlertTriangle,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CompileIssue } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

/** Bottom-dock tools, selected by the bottom icons of the left rail. */
export type IssuesTool = "issues" | "log";

function issueIcon(issue: CompileIssue) {
  if (issue.severity === "error") {
    return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />;
  }
  return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />;
}

async function jumpToIssue(issue: CompileIssue) {
  const { project, mainFile } = useProjectStore.getState();
  if (!project) return;
  const file = issue.file ?? mainFile;
  if (!file || issue.line === null) return;
  try {
    await useProjectStore.getState().openFile(file);
    useEditorStore.getState().jumpTo(issue.line);
  } catch (e) {
    usePreviewStore.setState({ error: String(e) });
  }
}

/** The bottom dock, spanning the width of the center stack. Shows the
 *  issues list or the full compile log, depending on the left rail. */
export function IssuesPanel({
  tool,
  onToggle,
}: {
  tool: IssuesTool;
  onToggle: () => void;
}) {
  const issues = usePreviewStore((s) => s.issues);
  const status = usePreviewStore((s) => s.status);
  const log = usePreviewStore((s) => s.log);

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex h-8 shrink-0 items-center gap-2 px-3">
        <span className="text-xs font-medium text-muted-foreground">
          {tool === "issues" ? "ISSUES" : "COMPILE LOG"}
        </span>
        {tool === "issues" && (
          <>
            {status === "compiling" && <Loader2 className="size-3 animate-spin" />}
            {issues.length > 0 && (
              <span className="text-xs">
                <span className="font-medium text-destructive">{errors} errors</span>
                <span className="text-muted-foreground">, {warnings} warnings</span>
              </span>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="Hide panel"
            onClick={onToggle}
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {tool === "issues" ? (
          issues.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {status === "error"
                ? "Compilation failed with no parsed issues — check the compile log."
                : "No issues."}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {issues.map((issue, index) => (
                <li key={index}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
                    onClick={() => void jumpToIssue(issue)}
                  >
                    {issueIcon(issue)}
                    <span className="min-w-0 flex-1 truncate">{issue.message}</span>
                    {issue.file && (
                      <span className="shrink-0 text-muted-foreground">
                        {issue.file}
                        {issue.line !== null ? `:${issue.line}` : ""}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : log === null ? (
          <p className="text-xs text-muted-foreground">Nothing compiled yet.</p>
        ) : (
          <pre className="font-mono text-xs whitespace-pre-wrap">{log}</pre>
        )}
      </div>
    </div>
  );
}
