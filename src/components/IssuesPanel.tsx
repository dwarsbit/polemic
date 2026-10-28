import {
  ChevronDown,
  CircleAlert,
  Loader2,
  Sparkles,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CompileIssue } from "@/lib/tauri";
import { fixIssue, planIssueFixes } from "@/lib/fix-issue";
import type { TexFix } from "@/lib/latex-fixes";
import { useDialogsStore } from "@/store/dialogs";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

/** Bottom-dock tools, selected by the bottom icons of the left rail. */
export type IssuesTool = "issues" | "log" | "search";

function issueIcon(issue: CompileIssue) {
  if (issue.severity === "error") {
    return <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />;
  }
  return <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />;
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
  // The fix each issue would get, planned once per compile: Fix shows
  // only where a rule actually has something to do.
  const [planned, setPlanned] = useState<{
    issues: CompileIssue[];
    fixes: (TexFix | null)[];
  } | null>(null);
  const fixes = planned?.issues === issues ? planned.fixes : [];
  useEffect(() => {
    let cancelled = false;
    void planIssueFixes(issues)
      .then((plans) => {
        if (!cancelled) setPlanned({ issues, fixes: plans });
      })
      .catch(() => {
        // No plans: the panel simply offers no Fix buttons.
      });
    return () => {
      cancelled = true;
    };
  }, [issues]);

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;

  async function onFix(issue: CompileIssue) {
    setFixNote(null);
    const outcome = await fixIssue(issue);
    if (outcome === "declined") {
      setFixNote("No built-in fix for this error. Try Ask AI.");
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
      <SectionHeader
        label={tool === "issues" ? "Issues" : "Compile log"}
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground"
            title="Hide panel"
            onClick={onToggle}
          >
            <ChevronDown className="size-3.5" />
          </Button>
        }
      >
        {tool === "issues" && (
          <>
            {status === "compiling" && (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            )}
            {issues.length > 0 && (
              <span className="flex items-center gap-2 text-2xs">
                <span className="flex items-center gap-1 text-destructive">
                  <CircleAlert className="size-3" />
                  {errors === 1 ? "1 error" : `${errors} errors`}
                </span>
                <span className="flex items-center gap-1 text-warning">
                  <TriangleAlert className="size-3" />
                  {warnings === 1 ? "1 warning" : `${warnings} warnings`}
                </span>
              </span>
            )}
          </>
        )}
      </SectionHeader>
      <div className="flex-1 overflow-y-auto p-1.5">
        {tool === "issues" ? (
          issues.length === 0 ? (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">
              {status === "error"
                ? "The compile failed without a readable error. See the compile log."
                : "No issues."}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {issues.map((issue, index) => (
                <li key={index}>
                  <div
                    role="button"
                    tabIndex={0}
                    className="group flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
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
                    {fixes[index] && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 shrink-0 gap-1 px-1.5 text-2xs text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        title={fixes[index].title}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onFix(issue);
                        }}
                      >
                        <Wrench className="size-3" />
                        Fix
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 shrink-0 gap-1 px-1.5 text-2xs text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      title="Ask the AI assistant for a fix, with a preview"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onAiFix(issue);
                      }}
                    >
                      <Sparkles className="size-3" />
                      Ask AI
                    </Button>
                    {issue.file && (
                      <span className="shrink-0 font-mono text-2xs leading-4.5 text-muted-foreground">
                        {issue.file}
                        {issue.line !== null ? `:${issue.line}` : ""}
                      </span>
                    )}
                  </div>
                  {issue.hint && (
                    <p className="pr-2 pb-1 pl-7.5 text-2xs text-muted-foreground">
                      {issue.hint}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : log === null ? (
          <p className="px-1.5 py-1 text-xs text-muted-foreground">
            Nothing compiled yet.
          </p>
        ) : (
          <pre className="px-1.5 py-1 font-mono text-2xs leading-5 whitespace-pre-wrap text-muted-foreground">
            {log}
          </pre>
        )}
        {fixNote !== null && <p className="mt-1 text-xs text-warning">{fixNote}</p>}
      </div>
    </div>
  );
}
