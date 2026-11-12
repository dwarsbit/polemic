import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Loader2,
  Sparkles,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CompileIssue } from "@/lib/tauri";
import { fixIssue, planIssueFixes } from "@/lib/fix-issue";
import { arrangeIssues, firstError, sourceSpot, type IssueRow } from "@/lib/issue-list";
import type { TexFix } from "@/lib/latex-fixes";
import { askAboutIssue } from "@/lib/assistant/entry";
import { ctanPageUrl } from "@/lib/ctan";
import type { Explanation } from "@/lib/explain-issue";
import { LATEX_ERRORS_URL } from "@/lib/links";
import { compileWithEngine, jumpToIssue } from "@/lib/show-issue";
import { cn } from "@/lib/utils";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { useCloudCompile } from "@/store/settings";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Bottom-dock tools, selected by the bottom icons of the left rail. */
export type IssuesTool = "issues" | "log" | "search";

/** How many issues an open row lists before it sums up the rest. */
const LISTED = 40;

function issueIcon(severity: CompileIssue["severity"]) {
  if (severity === "error") {
    return <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />;
  }
  return <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />;
}

function place(issue: CompileIssue): string | null {
  if (issue.file === null) return null;
  return issue.line !== null ? `${issue.file}:${issue.line}` : issue.file;
}

/** The source line of an error, with what TeX stopped at marked. */
function SourceLine({ issue }: { issue: CompileIssue }) {
  const spot = sourceSpot(issue);
  if (spot === null) {
    // Not a source line: the further reasons a bibliography tool gave.
    return issue.detail.length > 0 ? (
      <pre className="overflow-x-auto rounded-md bg-muted/60 px-2 py-1 font-mono text-2xs">
        {issue.detail.join("\n")}
      </pre>
    ) : null;
  }
  return (
    <pre className="overflow-x-auto rounded-md bg-muted/60 px-2 py-1 font-mono text-2xs">
      <span className="mr-2 text-muted-foreground select-none">{spot.line}</span>
      {spot.before}
      <span className="rounded-xs bg-destructive/15 text-destructive underline decoration-wavy underline-offset-2">
        {spot.at}
      </span>
      <span className="text-muted-foreground">{spot.after}</span>
    </pre>
  );
}

const ENGINE_NAMES = { xelatex: "XeLaTeX", lualatex: "LuaLaTeX" } as const;

/** What Polemic can do about an issue, as buttons under the advice. */
function IssueActions({
  explanation,
  fix,
  onFix,
}: {
  explanation: Explanation | null;
  fix: TexFix | undefined;
  onFix: () => void;
}) {
  const action = explanation?.action;
  const topic = explanation?.topic;
  const engine = usePreviewStore((s) => s.engine);
  const readOnly = useProjectStore((s) => s.project?.readOnly ?? null) !== null;
  const buttons = [];
  if (fix) {
    buttons.push(
      <Button key="fix" variant="outline" size="xs" onClick={onFix}>
        <Wrench className="size-3" />
        {fix.title}
      </Button>,
    );
  }
  if (action?.kind === "engine" && !readOnly) {
    for (const name of action.engines) {
      if (name === engine) continue;
      buttons.push(
        <Button
          key={name}
          variant="outline"
          size="xs"
          onClick={() => void compileWithEngine(name)}
        >
          Compile with {ENGINE_NAMES[name]}
        </Button>,
      );
    }
  }
  if (action?.kind === "ctan") {
    buttons.push(
      <Button
        key="ctan"
        variant="outline"
        size="xs"
        onClick={() => void openUrl(ctanPageUrl(action.name))}
      >
        Look up {action.name} on CTAN
        <ExternalLink className="size-3" />
      </Button>,
    );
  }
  if (topic) {
    buttons.push(
      <button
        key="guide"
        type="button"
        className="px-1 text-muted-foreground hover:text-foreground hover:underline"
        onClick={() => void openUrl(`${LATEX_ERRORS_URL}#${topic}`)}
      >
        More about this kind of error →
      </button>,
    );
  }
  return buttons.length > 0 ? (
    <div className="flex flex-wrap items-center gap-1.5">{buttons}</div>
  ) : null;
}

/** What an open row shows below its title. */
function IssueDetails({
  row,
  fix,
  onFix,
}: {
  row: IssueRow;
  fix: TexFix | undefined;
  onFix: () => void;
}) {
  const [head] = row.entries;
  const several = row.entries.length > 1;
  const sameMessage = row.entries.every(
    (entry) => entry.issue.message === head.issue.message,
  );
  return (
    <div className="space-y-1.5 pr-2 pb-2 pl-11.5 text-2xs">
      {row.advice && <p>{row.advice}</p>}
      <IssueActions explanation={head.explanation} fix={fix} onFix={onFix} />
      {!several && <SourceLine issue={head.issue} />}
      {several && (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
          {row.entries.slice(0, LISTED).map((entry, index) => {
            const where = place(entry.issue);
            const name = entry.title !== row.title && !sameMessage ? entry.title : null;
            return (
              <li key={index} className={name ? "w-full" : undefined}>
                <button
                  type="button"
                  className="flex max-w-full items-baseline gap-2 rounded-sm text-left hover:underline disabled:no-underline"
                  title={name ? entry.issue.message : undefined}
                  disabled={entry.issue.line === null}
                  onClick={() => void jumpToIssue(entry.issue)}
                >
                  {name && <span className="truncate">{name}</span>}
                  {where && (
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {where}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {row.entries.length > LISTED && (
            <li className="w-full text-muted-foreground">
              and {row.entries.length - LISTED} more
            </li>
          )}
        </ul>
      )}
      {head.explanation && sameMessage && (
        <p className="text-muted-foreground">
          TeX's message: <span className="font-mono">{head.issue.message}</span>
        </p>
      )}
    </div>
  );
}

/** The row that folds the errors after the first one. */
const FOLLOW_ON = "follow-on";

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

  const cloud = useCloudCompile();
  const list = useMemo(() => arrangeIssues(issues, { cloud }), [issues, cloud]);
  const fixFor = useMemo(() => {
    const byIssue = new Map<CompileIssue, TexFix>();
    if (planned?.issues !== issues) return byIssue;
    issues.forEach((issue, index) => {
      const fix = planned.fixes[index];
      if (fix) byIssue.set(issue, fix);
    });
    return byIssue;
  }, [issues, planned]);

  // What the reader opened or closed, by row. The error to fix first
  // is open until they close it; the errors after it stay folded.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const openByDefault = firstError(list)?.key;
  const isOpen = (key: string) => toggled.get(key) ?? key === openByDefault;
  const setOpen = (key: string, open: boolean) =>
    setToggled((before) => new Map(before).set(key, open));

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
   *  the assistant, which proposes a change to review. */
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
    askAboutIssue(issue);
  }

  function issueRow(row: IssueRow) {
    const [{ issue }] = row.entries;
    const open = isOpen(row.key);
    const fix = fixFor.get(issue);
    const where = place(issue);
    // Jump to the place and show what the row has to say.
    const select = () => {
      void jumpToIssue(issue);
      setOpen(row.key, true);
    };
    const action =
      "h-5 shrink-0 gap-1 px-1.5 text-2xs text-muted-foreground focus-visible:opacity-100";
    const quiet = !open && "opacity-0 group-hover:opacity-100";
    return (
      <li key={row.key}>
        <div
          role="button"
          tabIndex={0}
          className="group flex w-full cursor-pointer items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent"
          onClick={select}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              select();
            }
          }}
        >
          <button
            type="button"
            className="mt-0.5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
            title={open ? "Hide details" : "Show details"}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(row.key, !open);
            }}
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
          </button>
          {issueIcon(row.severity)}
          <span className={cn("min-w-0 flex-1", !open && "truncate")}>
            {row.title}
            {row.repeats !== null && (
              <span className="ml-1.5 text-2xs text-muted-foreground">
                {row.repeats} times
              </span>
            )}
          </span>
          {fix && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(action, quiet)}
              title={fix.title}
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
            className={cn(action, quiet)}
            title="Ask the assistant for a fix"
            onClick={(e) => {
              e.stopPropagation();
              void onAiFix(issue);
            }}
          >
            <Sparkles className="size-3" />
            Ask AI
          </Button>
          {where && (
            <span className="shrink-0 font-mono text-2xs leading-4.5 text-muted-foreground">
              {where}
            </span>
          )}
        </div>
        {open && <IssueDetails row={row} fix={fix} onFix={() => void onFix(issue)} />}
      </li>
    );
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
              {list.first.map(issueRow)}
              {list.followOnCount > 0 && (
                <li>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-accent"
                    aria-expanded={isOpen(FOLLOW_ON)}
                    onClick={() => setOpen(FOLLOW_ON, !isOpen(FOLLOW_ON))}
                  >
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 transition-transform",
                        isOpen(FOLLOW_ON) && "rotate-90",
                      )}
                    />
                    {list.followOnCount === 1
                      ? "1 more error"
                      : `${list.followOnCount} more errors`}
                    , most likely caused by the first
                  </button>
                  {isOpen(FOLLOW_ON) && (
                    <ul className="ml-3 space-y-0.5 border-l pl-1">
                      {list.followOn.map(issueRow)}
                    </ul>
                  )}
                </li>
              )}
              {list.tools.map(issueRow)}
              {list.warnings.map(issueRow)}
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
