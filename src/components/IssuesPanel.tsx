import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CompileIssue } from "@/lib/tauri";
import { fixIssue } from "@/lib/fix-issue";
import { detectFixRule } from "@/lib/latex-fixes";
import { useDialogsStore } from "@/store/dialogs";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

/** Bottom-dock tools, selected by the bottom icons of the left rail. */
export type IssuesTool = "issues" | "log" | "search";

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
  tool: "issues" | "log";
  onToggle: () => void;
}) {
  const issues = usePreviewStore((s) => s.issues);
  const status = usePreviewStore((s) => s.status);
  const log = usePreviewStore((s) => s.log);
  const [fixNote, setFixNote] = useState<string | null>(null);

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;

  async function onFix(issue: CompileIssue) {
    setFixNote(null);
    const outcome = await fixIssue(issue);
    if (outcome === "declined") {
      setFixNote("No automatic fix for this one — try Fix with AI.");
    } else if (outcome === "no-file") {
      setFixNote("This issue does not point at an openable file.");
    } else if (outcome === "error") {
      setFixNote("The fix could not be applied.");
    }
  }

  /** The AI fallback: open the issue's file and hand the issue to
   *  the fix dialog, which previews the proposed change. */
  async function onAiFix(issue: CompileIssue) {
    setFixNote(null);
    const { activeFile, mainFile, openFile } = useProjectStore.getState();
    const file = issue.file ?? mainFile;
    try {
      if (file !== null && file !== activeFile) await openFile(file);
    } catch (e) {
      usePreviewStore.setState({ error: String(e) });
      return;
    }
    useDialogsStore.getState().setAiFixIssue(issue);
  }

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
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex w-full cursor-pointer items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
                    onClick={() => void jumpToIssue(issue)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void jumpToIssue(issue);
                      }
                    }}
                  >
                    {issueIcon(issue)}
                    <span className="min-w-0 flex-1 truncate">{issue.message}</span>
                    {detectFixRule(issue) !== null && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-4 shrink-0 gap-1 px-1 text-[11px] text-muted-foreground"
                        title="Apply the automatic fix"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onFix(issue);
                        }}
                      >
                        <Wrench className="size-2.5" />
                        Fix
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 shrink-0 gap-1 px-1 text-[11px] text-muted-foreground"
                      title="Ask the configured AI provider for a fix, with a preview"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onAiFix(issue);
                      }}
                    >
                      <Sparkles className="size-2.5" />
                      AI
                    </Button>
                    {issue.file && (
                      <span className="shrink-0 text-muted-foreground">
                        {issue.file}
                        {issue.line !== null ? `:${issue.line}` : ""}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : log === null ? (
          <p className="text-xs text-muted-foreground">Nothing compiled yet.</p>
        ) : (
          <pre className="font-mono text-xs whitespace-pre-wrap">{log}</pre>
        )}
        {fixNote !== null && (
          <p className="mt-1 text-xs text-amber-600">{fixNote}</p>
        )}
      </div>
    </div>
  );
}
