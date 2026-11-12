/**
 * Going to a compile issue: its place in the source, and the Issues
 * panel from elsewhere in the window (the preview names the first
 * error and links to it).
 */

import { useMemo } from "react";
import { arrangeIssues, firstError, type IssueRow } from "@/lib/issue-list";
import { runPanelCommand } from "@/lib/panel-commands";
import type { CompileIssue } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { useCloudCompile } from "@/store/settings";

/** Open the issue's file at its line. Issues without a line stay put. */
export async function jumpToIssue(issue: CompileIssue): Promise<void> {
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

/** Bring up the Issues panel and go to the issue's place. */
export function showIssue(issue: CompileIssue): void {
  runPanelCommand("show-issues");
  void jumpToIssue(issue);
}

/** The error to fix first in the last compile, in plain words. */
export function useFirstError(): IssueRow | null {
  const issues = usePreviewStore((s) => s.issues);
  const cloud = useCloudCompile();
  return useMemo(() => firstError(arrangeIssues(issues, { cloud })), [issues, cloud]);
}

/** `main.tex, line 12`, for a sentence. */
export function placeInWords(issue: CompileIssue): string | null {
  if (issue.file === null) return issue.line === null ? null : `line ${issue.line}`;
  return issue.line === null ? issue.file : `${issue.file}, line ${issue.line}`;
}

/**
 * Calls `onFailure` when a compile fails with errors to show, once per
 * run of failures: after it has fired, it waits for a compile that
 * succeeds. So Issues can come up by itself on the first failure and
 * stay closed when the reader closes it while they work on the error.
 * Returns the function that stops watching.
 */
export function watchCompileFailures(onFailure: () => void): () => void {
  let waiting = true;
  return usePreviewStore.subscribe((state, before) => {
    if (state.status === before.status) return;
    if (state.status === "ok" || state.status === "idle") {
      waiting = true;
    } else if (
      state.status === "error" &&
      waiting &&
      state.issues.some((issue) => issue.severity === "error")
    ) {
      waiting = false;
      onFailure();
    }
  });
}
