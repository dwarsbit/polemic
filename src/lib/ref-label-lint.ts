import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import {
  extractLabelPositions,
  extractRefPositions,
} from "@/lib/label-refs";
import { useProjectStore } from "@/store/project";

/**
 * Cross-reference hints: refs to labels that no file defines, and
 * labels no file references. The active document is scanned live, so
 * hints settle as you type (the linter itself debounces).
 */
export const refLabelLint = linter((view: EditorView) => {
  const { activeFile, labelsByFile, refsByFile } = useProjectStore.getState();
  if (activeFile === null) return [];

  const source = view.state.doc.toString();
  const liveLabels = extractLabelPositions(source).map((label) => label.name);
  const liveRefs = extractRefPositions(source).map((ref) => ref.name);

  // Labels defined anywhere (last read of other files, live for this one).
  const labels = new Set([
    ...Object.values(labelsByFile).flat(),
    ...liveLabels,
  ]);
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
  return diagnostics;
});
