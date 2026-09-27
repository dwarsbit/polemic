import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CompileIssue } from "@/lib/tauri";
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

export function IssuesPanel() {
  const issues = usePreviewStore((s) => s.issues);
  const status = usePreviewStore((s) => s.status);
  const log = usePreviewStore((s) => s.log);
  const content = useEditorStore((s) => s.content);
  const activeFile = useProjectStore((s) => s.activeFile);
  const [collapsed, setCollapsed] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;

  return (
    <div className="flex h-44 shrink-0 flex-col border-t">
      <div className="flex h-8 shrink-0 items-center gap-2 px-3">
        <span className="text-xs font-medium text-muted-foreground">ISSUES</span>
        {status === "compiling" && <Loader2 className="size-3 animate-spin" />}
        {issues.length > 0 && (
          <span className="text-xs">
            <span className="font-medium text-destructive">{errors} errors</span>
            <span className="text-muted-foreground">, {warnings} warnings</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {activeFile !== null && (
            <span className="mr-1 text-xs text-muted-foreground tabular-nums">
              {wordCount(content).toLocaleString()} words
            </span>
          )}
          {log !== null && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="View full compile log"
              onClick={() => setLogOpen(true)}
            >
              <ScrollText className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title={collapsed ? "Show issues" : "Hide issues"}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {issues.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {status === "error"
                ? "Compilation failed with no parsed issues — check the full log."
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
          )}
        </div>
      )}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Compile log</DialogTitle>
          </DialogHeader>
          <pre className="max-h-96 overflow-auto rounded bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
            {log ?? ""}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
