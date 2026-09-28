import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import { GutterMarker, gutterLineClass } from "@codemirror/view";

/** Set the changed lines (current line numbers) for the gutter bars. */
export const setGitLines = StateEffect.define<Map<number, "added" | "modified">>();

class GitLineMarker extends GutterMarker {
  constructor(public override elementClass: string) {
    super();
  }
}

const addedMarker = new GitLineMarker("cm-git-line-added");
const modifiedMarker = new GitLineMarker("cm-git-line-modified");

const gitLinesField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    // Follow edits so bars stay on the right lines between recomputes.
    const mapped = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setGitLines)) {
        const ranges = [...effect.value.entries()]
          .filter(([line]) => line >= 1 && line <= tr.state.doc.lines)
          .map(([line, kind]) =>
            (kind === "added" ? addedMarker : modifiedMarker).range(
              tr.state.doc.line(line).from,
            ),
          );
        ranges.sort((a, b) => a.from - b.from);
        return RangeSet.of(ranges);
      }
    }
    return mapped;
  },
});

/**
 * Git change bars in the gutter (emerald = added, sky = modified vs
 * HEAD). Feed it with `setGitLines` effects.
 */
export const gitLineGutter = [
  gitLinesField,
  gutterLineClass.compute([gitLinesField], (state) => state.field(gitLinesField)),
];
