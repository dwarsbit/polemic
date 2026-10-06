/**
 * "Fix this" wiring: take an issue from the compile log, plan its
 * deterministic fix against the file it points at, and land it in
 * the editor — switching faces and files when needed. Pure rule
 * matching lives in latex-fixes.ts; this module owns the app state.
 */

import { collectAssetPaths } from "./assets";
import { extractCiteKeys } from "./bibtex";
import { applyEditsInView, queueEditsForView } from "./editor-edits";
import { detectFixRule, planFix, type FixContext } from "./latex-fixes";
import type { SourceEdit } from "./label-index";
import type { CompileIssue } from "./tauri";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { useSourcesStore } from "@/store/sources";
import { useUiStore } from "@/store/ui";

export type FixOutcome =
  | "fixed"
  | "recompiled"
  /** A rule matched the message but declined for this document. */
  | "declined"
  /** The issue points at no file we can open. */
  | "no-file"
  | "error";

/** All cite keys reachable through the enabled bibliography
 *  sources, for citation quickfixes. */
function bibKeysFromSources(): string[] {
  const texts = useSourcesStore.getState().bibTexts;
  return Object.values(texts).flatMap((text) => extractCiteKeys(text));
}

/** Land fix edits in the editor: apply directly when the code face
 *  is live; otherwise switch (or queue) for the editor to flush. */
export function applyFixEdits(edits: SourceEdit[]): void {
  if (useUiStore.getState().texEditorMode !== "code") {
    // The visual face hands the store copy to the code editor on
    // switch; the flush lands the edits after the swap.
    useUiStore.getState().setTexEditorMode("code");
    queueEditsForView(edits);
  } else if (!applyEditsInView(edits, "input.fixLatex")) {
    // No live view yet (a different editor was mounted); the
    // LatexEditor flushes the queue when it takes over.
    queueEditsForView(edits);
  }
}

/** Fix the issue: open its file, plan the rule's fix against the
 *  live buffer, and apply it (or recompile). */
export async function fixIssue(issue: CompileIssue): Promise<FixOutcome> {
  if (detectFixRule(issue) === null) return "declined";
  const { activeFile, files, mainFile, openFile } = useProjectStore.getState();
  const file = issue.file ?? mainFile;
  if (file === null) return "no-file";
  try {
    if (file !== activeFile) {
      await openFile(file);
    }
    const ctx: FixContext = {
      doc: useEditorStore.getState().content,
      assets: collectAssetPaths(files),
      bibKeys: bibKeysFromSources(),
    };
    const fix = planFix(issue, ctx);
    if (fix === null) return "declined";
    if (fix.action === "recompile") {
      await usePreviewStore.getState().compileNow();
      return "recompiled";
    }
    applyFixEdits(fix.edits);
    if (issue.line !== null) useEditorStore.getState().jumpTo(issue.line);
    return "fixed";
  } catch (e) {
    usePreviewStore.setState({ error: String(e) });
    return "error";
  }
}
