/**
 * "Fix this" wiring: take an issue from the compile log, plan its
 * deterministic fix against the file it points at, and land it in
 * the editor — switching faces and files when needed. Pure rule
 * matching lives in latex-fixes.ts; this module owns the app state.
 */

import { collectAssetPaths } from "./assets";
import { extractCiteKeys } from "./bibtex";
import { applyEditsInView, queueEditsForView } from "./editor-edits";
import { detectFixRule, planFix, type FixContext, type TexFix } from "./latex-fixes";
import type { SourceEdit } from "./label-index";
import { projectBibKeys } from "./project-bib";
import { readProjectFile, type CompileIssue } from "./tauri";
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

/** All cite keys the document can cite: the project's own .bib
 *  files plus the enabled bibliography sources. */
async function citableKeys(): Promise<string[]> {
  const texts = useSourcesStore.getState().bibTexts;
  const fromSources = Object.values(texts).flatMap((text) => extractCiteKeys(text));
  return [...(await projectBibKeys()), ...fromSources];
}

/** A failed biber or BibTeX run in the same compile (see logparse.rs):
 *  recompiling cannot resolve citations until that is fixed. */
function bibToolFailed(issues: CompileIssue[]): boolean {
  return issues.some(
    (issue) =>
      issue.severity === "error" && /^(biber|BibTeX) failed\b/.test(issue.message),
  );
}

/** The current text of a project file, without opening it. */
async function fileText(file: string): Promise<string | null> {
  const { project, activeFile, buffers } = useProjectStore.getState();
  if (!project) return null;
  if (file === activeFile) return useEditorStore.getState().content;
  if (buffers[file] !== undefined) return buffers[file];
  try {
    return await readProjectFile(project.path, file);
  } catch {
    return null;
  }
}

/**
 * The fix each issue would get right now, by index (null where no rule
 * applies or the rule declines), so the Issues panel offers Fix only
 * where clicking it does something. Planned against each file's
 * current text; fixIssue plans again at click time.
 */
export async function planIssueFixes(
  issues: CompileIssue[],
): Promise<(TexFix | null)[]> {
  if (!issues.some((issue) => detectFixRule(issue) !== null))
    return issues.map(() => null);
  const { files, mainFile } = useProjectStore.getState();
  const assets = collectAssetPaths(files);
  const bibKeys = await citableKeys();
  const bibFailed = bibToolFailed(issues);
  const texts = new Map<string, string | null>();
  const plans: (TexFix | null)[] = [];
  for (const issue of issues) {
    const rule = detectFixRule(issue);
    const file = issue.file ?? mainFile;
    if (
      rule === null ||
      file === null ||
      (rule === "undefined-citation" && bibFailed)
    ) {
      plans.push(null);
      continue;
    }
    if (!texts.has(file)) texts.set(file, await fileText(file));
    const doc = texts.get(file) ?? null;
    plans.push(doc === null ? null : planFix(issue, { doc, assets, bibKeys }));
  }
  return plans;
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
      bibKeys: await citableKeys(),
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
