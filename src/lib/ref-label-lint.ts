import { linter, type Diagnostic } from "@codemirror/lint";
import { StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { collectAssetPaths } from "@/lib/assets";
import { extractCitePositions } from "@/lib/cite-refs";
import {
  extractGraphicsPaths,
  extractGraphicsRefs,
  isCheckableRef,
  resolveGraphicsRef,
} from "@/lib/graphics-refs";
import { extractLabelPositions, extractRefPositions } from "@/lib/label-refs";
import { useProjectStore } from "@/store/project";

/** Re-runs the hints without a document change, e.g. when the file
 *  tree changes and a missing graphic may now exist. */
export const refreshRefLabelLint = StateEffect.define<null>();

/**
 * Cross-reference hints: refs to labels that no file defines, labels
 * no file references, citations of keys no .bib file defines, and
 * \includegraphics paths no project file matches.
 * The active document is scanned live, so hints settle as you type
 * (the linter itself debounces).
 */
function refLabelDiagnostics(view: EditorView): Diagnostic[] {
  const {
    activeFile,
    labelsByFile,
    refsByFile,
    citeKeysByFile,
    graphicsPathsByFile,
    files,
  } = useProjectStore.getState();
  if (activeFile === null) return [];

  const source = view.state.doc.toString();
  const liveLabels = extractLabelPositions(source).map((label) => label.name);
  const liveRefs = extractRefPositions(source).map((ref) => ref.name);

  // Labels defined anywhere (last read of other files, live for this one).
  const labels = new Set([...Object.values(labelsByFile).flat(), ...liveLabels]);
  // Refs made anywhere, live for the active file.
  const refs = new Set([
    ...Object.entries(refsByFile)
      .filter(([file]) => file !== activeFile)
      .flatMap(([, names]) => names),
    ...liveRefs,
  ]);

  const diagnostics: Diagnostic[] = [];
  for (const ref of extractRefPositions(source)) {
    if (!labels.has(ref.name)) {
      diagnostics.push({
        from: ref.from,
        to: ref.to,
        severity: "warning",
        message: `Undefined label "${ref.name}"`,
        actions: [],
      });
    }
  }
  for (const label of extractLabelPositions(source)) {
    if (!refs.has(label.name)) {
      diagnostics.push({
        from: label.from,
        to: label.to,
        severity: "info",
        message: `Label "${label.name}" is not referenced`,
        actions: [],
      });
    }
  }
  // Cited keys that no .bib file defines (only when a .bib exists —
  // otherwise every citation would warn).
  const bibKeys = new Set(Object.values(citeKeysByFile).flat());
  if (bibKeys.size > 0) {
    for (const cite of extractCitePositions(source)) {
      if (!bibKeys.has(cite.key)) {
        diagnostics.push({
          from: cite.from,
          to: cite.to,
          severity: "warning",
          message: `No BibTeX entry with key "${cite.key}"`,
          actions: [],
        });
      }
    }
  }
  // Graphics that no project file matches (e.g. renamed or moved);
  // \graphicspath folders from every file count.
  const graphicsRefs = extractGraphicsRefs(source);
  if (graphicsRefs.length > 0 && files.length > 0) {
    const projectFiles = new Set(collectAssetPaths(files));
    const graphicsPaths = [
      ...Object.entries(graphicsPathsByFile)
        .filter(([file]) => file !== activeFile)
        .flatMap(([, dirs]) => dirs),
      ...extractGraphicsPaths(source),
    ];
    for (const ref of graphicsRefs) {
      if (!isCheckableRef(ref.path)) continue;
      if (resolveGraphicsRef(ref.path, projectFiles, graphicsPaths) === null) {
        diagnostics.push({
          from: ref.from,
          to: ref.to,
          severity: "warning",
          message: `No project file matches "${ref.path}"`,
          actions: [],
        });
      }
    }
  }
  return diagnostics;
}

export const refLabelLint = linter(refLabelDiagnostics, {
  needsRefresh: (update) =>
    update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(refreshRefLabelLint)),
    ),
});
